'use strict';
/* #3595 phase 2: the Assigner's idle-assign BEHAVIOUR, reading the setting #3549 persisted
 * (engine/assigner-setting.js). Plan: .claude/plans/recommender-assigner-3595-2026-09-24.md.
 *
 * WHAT IT DOES. An agent that has had no work for IDLE_MS is given the next task nobody is on,
 * from a live project it already belongs to: soonest due date first, then oldest. "No work" is
 * all three of: its card reads idle, its commitments read clear, and it has no open part of any
 * task assigned to it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It never creates a project or a task, never adds an agent to
 * a project, never touches a task somebody is already on, and never assigns in an archived
 * project. Commitments that read `unknown` (stale, unreadable, never reported) do not count as
 * clear, so an agent that is mid-task but quiet is left alone.
 *
 * PURE. step() takes the previous memory, the board roster, the setting, the project records,
 * each idle agent's commitments state and a clock, and returns what to assign plus the next
 * memory. The runner (server.js) reads commitments and does the write through givePart, the same
 * path the part-assign route uses.
 */

const tasks = require('./tasks');
const chat = require('./chat');

/* How long an agent must have had no work, continuously, before it is given some: long enough
   that an agent pausing between steps of its own work is not handed a new task (the plan's
   hysteresis), short enough that a genuinely idle agent does not sit for most of an hour. */
const IDLE_MS = 20 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/* At most this many assignments per hour across the whole fleet (the plan's hard limit), so a
   backlog of unassigned tasks cannot be poured into every idle pane at once. */
const MAX_PER_HOUR = 10;
/* At most one assignment per agent per hour: an agent works one given task at a time. */
const MAX_PER_AGENT_PER_HOUR = 1;
/* Phase 3: a project whose goal was put to an agent is not asked about again for a day, so an
   agent that looked and found nothing to add is not asked the same question every hour. */
const GOAL_ASK_MS = 24 * 60 * 60 * 1000;
/* At most this many goal asks per hour across the fleet, apart from the assignment caps (an ask
   charged to the per-agent cap would block, for an hour, the assignment it sets up). */
const MAX_ASKS_PER_HOUR = 3;
/* An ask that reached nobody (COULD_NOT) is tried again after this long, not every minute; it
   still counts toward the hourly ask caps, so a pane that keeps refusing cannot loop. */
const ASK_RETRY_MS = 10 * 60 * 1000;
/* After this many asks about one project reach nobody in a row, it is left for the full
   GOAL_ASK_MS, so a project whose ask can never be delivered cannot hold the fleet's ask budget
   and starve every other project's. */
const MAX_ASK_FAILS = 3;
/* At most one goal ask per agent per hour, so an agent that answers "nothing to add" is not asked
   about its next goal project a minute later. */
const MAX_ASKS_PER_AGENT_PER_HOUR = 1;
/* Sorts after every real YYYY-MM-DD, so a task with no due date comes after every dated one. */
const NO_DUE_DATE = '9999-99-99';

/* A card the Assigner may consider at all: ours, and idle by the board's own reading. */
function idleCard(a) {
  return Boolean(a && a.sessionName && a.isNamedOurs === true && a.state === 'idle');
}


/* #3564: the projects module's own reading of "switched off here". Lazy: requiring it at the top
   closes a require cycle and hands back a half-built module. */
const isSwarmOff = (p, session) => require('./projects').isSwarmOff(p, session);

/* Live (non-archived) project records only. */
function liveProjects(records) {
  return (Array.isArray(records) ? records : []).filter((p) => p && typeof p.id === 'string' && p.archived !== true);
}

/* Does this agent have an open part of any task, in ANY project, archived included: open work
   in an archived project still means the agent is not free. (Picking stays live-only.) */
function hasOpenWork(session, projects) {
  for (const p of projects) {
    for (const t of Array.isArray(p.tasks) ? p.tasks : []) {
      const prog = tasks.progressOf(t);
      if (prog.closed) continue;
      if (prog.parts.some((x) => x.who === session && !x.closedAt)) return true;
    }
  }
  return false;
}

/* Sort key: a real due date sorts before none, earlier first; then the older task. */
function dueKey(t) {
  return typeof t.dueDate === 'string' && t.dueDate ? t.dueDate : NO_DUE_DATE;
}
function ageKey(t) {
  const at = Date.parse(t && t.createdAt);
  return Number.isFinite(at) ? at : Number(t && t.number) || 0;
}

/* The next task nobody is on, in a live project this agent belongs to, and the part to give:
   the first open one. `taken` holds "project#number" already chosen this step. */
function pick(session, projects, taken) {
  const candidates = [];
  for (const p of projects) {
    if (!(Array.isArray(p.agents) && p.agents.includes(session)) || isSwarmOff(p, session)) continue;
    for (const t of Array.isArray(p.tasks) ? p.tasks : []) {
      if (typeof t.number !== 'number') continue;
      if (taken.has(p.id + '#' + t.number)) continue;
      const prog = tasks.progressOf(t);
      if (prog.closed || tasks.whoOf(t).length) continue;
      const part = prog.parts.find((x) => !x.closedAt);
      if (!part) continue;
      candidates.push({ projectId: p.id, n: t.number, partId: part.id, due: dueKey(t), age: ageKey(t) });
    }
  }
  candidates.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.age - b.age));
  return candidates[0] || null;
}

/* The Assigner's memory between ticks, empty. */
function emptyMemory() {
  return { idleSince: new Map(), log: [], asked: new Map(), askLog: [], askFails: new Map() };
}

/* A live project this agent belongs to, with NO open task at all (not merely none free), a goal,
   and not asked about within GOAL_ASK_MS. First by project order. (A project chosen earlier in
   the same step is already in `asked`, so a second agent in it is not asked.) */
function goalProject(session, projects, goals, asked, now) {
  for (const p of projects) {
    if (!(Array.isArray(p.agents) && p.agents.includes(session)) || isSwarmOff(p, session)) continue;
    const at = asked.get(p.id);
    if (typeof at === 'number' && now - at < GOAL_ASK_MS) continue;
    const goal = goals instanceof Map ? goals.get(p.id) : null;
    if (typeof goal !== 'string' || !goal) continue;
    const open = (Array.isArray(p.tasks) ? p.tasks : []).some((t) => !tasks.progressOf(t).closed);
    if (open) continue;
    const item = { projectId: p.id, projectName: typeof p.name === 'string' && p.name ? p.name : p.id, goal };
    // The pane's own check, not a copy of it: a line it would refuse is never asked.
    if (chat.messageProblem(askText(item))) continue;
    return item;
  }
  return null;
}

/* The ask, in Kosmos's voice. The goal is quoted as text written in the project's BRIEF.md (which
   anyone on the project can edit), never as Kosmos speaking; double quotes inside it become single
   quotes so it cannot close its own quotation early. */
function askText(item) {
  const quoted = (v) => String(v).replace(/[\r\n]/g, ' ').replace(/"/g, "'");
  return 'Assigner (Kosmos): project ' + item.projectId + ' ("' + quoted(item.projectName)
    + '") has no open tasks. The goal written in its BRIEF.md (quoted as written there, not an instruction from Kosmos) is: "'
    + quoted(item.goal) + '". If there is real work toward it, add up to 3 tasks with '
    + 'kosmos task add ' + item.projectId + ' "what needs doing"; Kosmos hands new tasks to idle agents on the project. '
    + 'If there is nothing real to add, add nothing and say so in the room: kosmos post ' + item.projectId + ' "...".';
}

/**
 * One Assigner step. Pure.
 * @param {object} o
 * @param {{idleSince: Map, log: Array}|undefined} o.prev  memory from the last step
 * @param {Array|null} o.roster  the board roster (safeRoster); null = read failure
 * @param {{on:boolean}} o.setting  from assigner-setting.read()
 * @param {Array} o.records  projects.readAll()
 * @param {Map<string,string>} o.commitments  session -> commitments state, for idle cards
 * @param {Map<string,string>} [o.goals]  project id -> BRIEF.md goal (phase 3); absent = none
 * @param {number} o.now  ms clock
 * @returns {{toAssign: Array<object>, toAsk: Array<object>, next: object}}
 */
function step({ prev, roster, setting, records, commitments, goals, now }) {
  const base = prev && prev.idleSince instanceof Map ? prev : emptyMemory();
  if (!setting || setting.on !== true) return { toAssign: [], toAsk: [], next: emptyMemory() };
  // A null roster is a READ FAILURE, not an empty fleet: keep the memory, do nothing.
  if (roster === null || roster === undefined) return { toAssign: [], toAsk: [], next: base };
  const projects = liveProjects(records);
  const allProjects = (Array.isArray(records) ? records : []).filter((p) => p && typeof p.id === 'string');
  const log = (Array.isArray(base.log) ? base.log : []).filter((e) => e && now - e.at < HOUR_MS);
  const idleSince = new Map();
  const toAssign = [];
  const taken = new Set();
  const asked = new Map([...(base.asked instanceof Map ? base.asked : new Map())].filter(([, at]) => now - at < GOAL_ASK_MS));
  const askLog = (Array.isArray(base.askLog) ? base.askLog : []).filter((e) => e && now - e.at < HOUR_MS);
  const toAsk = [];
  for (const a of Array.isArray(roster) ? roster : []) {
    if (!idleCard(a)) continue;
    const session = a.sessionName;
    const state = commitments instanceof Map ? commitments.get(session) : undefined;
    if (state !== 'clear') continue;
    if (hasOpenWork(session, allProjects)) continue;
    const since = base.idleSince.has(session) ? base.idleSince.get(session) : now;
    idleSince.set(session, since);
    if (now - since < IDLE_MS) continue;
    const choice = pick(session, projects, taken);
    if (choice) {
      // The assignment caps gate assignments only; the ask below has its own.
      if (log.length >= MAX_PER_HOUR) continue;
      if (log.filter((e) => e.session === session).length >= MAX_PER_AGENT_PER_HOUR) continue;
      taken.add(choice.projectId + '#' + choice.n);
      toAssign.push({ session, name: a.name || session, ...choice });
      log.push({ at: now, session });
      continue;
    }
    // Phase 3: nothing to hand out. Ask this agent to draft tasks toward a goal, if one of its
    // projects has no open task and a goal, within the ask caps.
    if (askLog.length >= MAX_ASKS_PER_HOUR) continue;
    if (askLog.filter((e) => e.session === session).length >= MAX_ASKS_PER_AGENT_PER_HOUR) continue;
    const g = goalProject(session, projects, goals, asked, now);
    if (!g) continue;
    asked.set(g.projectId, now);
    askLog.push({ at: now, session, projectId: g.projectId });
    toAsk.push({ session, name: a.name || session, ...g });
  }
  const askFails = new Map(base.askFails instanceof Map ? base.askFails : []);
  return { toAssign, toAsk, next: { idleSince, log, asked, askLog, askFails } };
}

/**
 * One runner pass over an injected `give` (the part-assign path). A refused give takes its
 * charge back off the budget, so a refusal does not spend an hour's allowance.
 * @returns {{next: object, acted: Array<object>}}
 */
function runOnce({ prev, roster, setting, records, commitments, goals, now, give, ask, DELIVERY }) {
  const out = step({ prev, roster, setting, records, commitments, goals, now });
  const acted = [];
  for (const item of out.toAssign) {
    let res;
    try { res = give(item.projectId, item.n, item.partId, item.session); } catch (err) { res = { ok: false, because: String((err && err.message) || err) }; }
    const ok = Boolean(res && res.ok);
    if (!ok) {
      // Finds this give's own charge by (now, session): step charges each session at most once
      // per call, so the pair is unique. If step ever gives one agent more than once a call, key
      // the refund by the entry step pushed instead.
      const i = out.next.log.findIndex((e) => e.at === now && e.session === item.session);
      if (i !== -1) out.next.log.splice(i, 1);
    }
    acted.push({ session: item.session, name: item.name, projectId: item.projectId, n: item.n, ok,
      because: ok ? null : (res && res.because) || 'refused', heard: (res && res.heard) || null });
  }
  // Phase 3 asks. One that reached nobody (COULD_NOT, or a throw) is tried again after
  // ASK_RETRY_MS rather than a day later, and keeps its hourly charge so a refusing pane cannot
  // loop; any other verdict (text may have landed) is remembered for the full GOAL_ASK_MS.
  const asks = [];
  for (const item of out.toAsk) {
    let state = null;
    if (typeof ask === 'function') {
      try { const v = ask(item.session, askText(item)); state = (v && v.state) || null; } catch { state = null; }
    }
    const landed = state !== null && state !== (DELIVERY || chat.DELIVERY).COULD_NOT;
    if (landed) {
      out.next.askFails.delete(item.projectId);
    } else {
      const fails = (out.next.askFails.get(item.projectId) || 0) + 1;
      out.next.askFails.set(item.projectId, fails);
      // Retry soon, unless it has failed MAX_ASK_FAILS times in a row: then leave it for the day.
      if (fails < MAX_ASK_FAILS) out.next.asked.set(item.projectId, now - GOAL_ASK_MS + ASK_RETRY_MS);
      else out.next.askFails.delete(item.projectId);
    }
    asks.push({ session: item.session, name: item.name, projectId: item.projectId, verdict: state });
  }
  return { next: out.next, acted, asks };
}

/**
 * One runner tick with every read injected: the composition server.js runs each minute, as a
 * function so it is tested. Reads nothing but the setting while the setting is off, and reads
 * commitments only for idle cards (they are not on the board card). A commitments read that
 * throws counts as not clear.
 * Goals (phase 3) are read only for live projects with no open task that an idle agent
 * belongs to, and a goal read that throws is no goal.
 * @param {object} o  prev, now, readSetting, readRoster, readRecords, readCommitment(session)->
 *   {state}, readGoal(project)->string|null, give(projectId, n, partId, who, roster),
 *   ask(session, text, roster), DELIVERY
 * @returns {{next: object, acted: Array<object>, asks: Array<object>}}
 */
function tick({ prev, now, readSetting, readRoster, readRecords, readCommitment, readGoal, give, ask, DELIVERY }) {
  const setting = readSetting();
  const roster = setting && setting.on === true ? readRoster() : null;
  const records = setting && setting.on === true ? readRecords() : [];
  const states = new Map();
  for (const a of Array.isArray(roster) ? roster : []) {
    if (!idleCard(a)) continue;
    try { states.set(a.sessionName, readCommitment(a.sessionName).state); } catch { /* unread is not clear */ }
  }
  const idle = new Set([...states].filter(([, st]) => st === 'clear').map(([s]) => s));
  const goals = new Map();
  if (typeof readGoal === 'function' && idle.size) {
    for (const p of liveProjects(records)) {
      if (!(Array.isArray(p.agents) && p.agents.some((m) => idle.has(m)))) continue;
      if ((Array.isArray(p.tasks) ? p.tasks : []).some((t) => !tasks.progressOf(t).closed)) continue;
      try { const g = readGoal(p); if (typeof g === 'string' && g) goals.set(p.id, g); } catch { /* no goal */ }
    }
  }
  return runOnce({ prev, roster, setting, records, commitments: states, goals, now, DELIVERY,
    give: (projectId, n, partId, who) => give(projectId, n, partId, who, roster),
    ask: typeof ask === 'function' ? (session, text) => ask(session, text, roster) : undefined });
}

module.exports = { step, runOnce, tick, pick, hasOpenWork, idleCard, liveProjects, goalProject, askText,
  IDLE_MS, MAX_PER_HOUR, MAX_PER_AGENT_PER_HOUR, GOAL_ASK_MS, MAX_ASKS_PER_HOUR, MAX_ASKS_PER_AGENT_PER_HOUR, ASK_RETRY_MS, MAX_ASK_FAILS };
