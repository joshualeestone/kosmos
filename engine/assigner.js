'use strict';
/* #3595 phase 2: the Assigner's idle-assign BEHAVIOUR, reading the setting #3549 persisted
 * (engine/assigner-setting.js). Plan: .claude/plans/recommender-assigner-3595-2026-09-24.md.
 *
 * WHAT IT DOES. An agent that has had no work for IDLE_MS is given the next task nobody is on,
 * from a live project it already belongs to: soonest due date first, then oldest. "No work" is
 * all three of: its card reads idle, its commitments leave it free (commitmentsFree), and it has no
 * open part of any task assigned to it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It never creates a project or a task, never adds an agent to
 * a project, never touches a task somebody is already on, and never assigns in an archived
 * project. An agent whose last stated list named work (fresh or stale), or whose record cannot be
 * read or is dated in the future, is left alone.
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
/* #4552: does this agent's commitments record leave it free for new work? Stated clear, yes. Also,
   with nothing stated: an agent that never reported a list, or whose last list was empty and has only
   aged. Nothing shipped writes the record (only an agent's own PUT does), so requiring `clear` meant
   the Assigner never gave a real agent anything (April measured it live). No: a list that names work,
   fresh or stale; a record that cannot be read; a record dated in the future. Decided when the
   Assigner checks, from the record as it stands, so nothing is written in the agent's name and nothing
   decays. The card's own idle reading (idleCard) and hasOpenWork are the other two conditions. */
function commitmentsFree(rec) {
  if (!rec || typeof rec !== 'object') return false;
  if (rec.state === 'clear') return true;
  if (rec.state !== 'unknown') return false;
  if (rec.neverReported === true) return true;
  return rec.stale === true && Array.isArray(rec.commitments) && rec.commitments.length === 0;
}

/* Sorts after every real YYYY-MM-DD, so a task with no due date comes after every dated one. */
const NO_DUE_DATE = '9999-99-99';

/* A card the Assigner may consider at all: ours, idle by the board's own reading, and not a
   paused swarm (#3564: deliver refuses a paused swarm, so a part given to it is taken back). */
function idleCard(a) {
  return Boolean(a && a.sessionName && a.isNamedOurs === true && a.state === 'idle'
    && !(a.swarm && a.swarm.active === false));
}

/* #3564: the projects module's own reading of "switched off here". Lazy: requiring it at the top
   closes a require cycle and hands back a half-built module. */
const isSwarmOff = (p, session) => require('./projects').isSwarmOff(p, session);
/* #4740: an agent that makes a project is now on it (server.js, POST /api/projects). Alone on a project it made
   itself (newly made, or left alone on it again after others were removed), it is NOT asked to draft tasks toward that project's goal: the goal there is the agent's own description,
   not the person's, and asking would have an idle agent writing itself new work every day with nobody in the loop
   (before #4740 such a project listed nobody, so the Assigner never touched it). Tasks that already exist there
   ARE handed out like any project's (`pick` has no such skip): the person, or the maker itself, put them there.
   Once anyone else is on the project it is an ordinary project and the maker an ordinary member. */
const aloneOnItsOwn = (p, session) => Array.isArray(p.agents) && p.agents.length === 1 && p.agents[0] === session
  && !!p.made && typeof p.made === 'object' && p.made.by === session;

/* Live (non-archived) project records only. */
function liveProjects(records) {
  return (Array.isArray(records) ? records : []).filter((p) => p && typeof p.id === 'string' && p.archived !== true);
}

/* Does this agent have an open part of any task, in ANY project, archived included: open work
   in an archived project still means the agent is not free. (Picking stays live-only.)
   #3951: a task an agent marked built is waiting on a release or a check, not on that agent, so it does not keep
   any agent that marked it busy (builtWho, review round 9), nor any agent on it when the person marked it
   (builtFreesAll; an unnamed caller frees nobody, review round 11); another agent still
   holding an open part of a task
   some other agent marked is still busy (review round 4: the mark is on the task, the work is per part). New work on
   it (a part added, put back, or given to somebody) drops the mark (tasks.writeParts), and it counts again. */
function hasOpenWork(session, projects) {
  for (const p of projects) {
    /* #4771: held work (a task on hold, or a paused project) does not keep an agent busy, so the agent can be given
       real work; it stays on the agent's list. */
    if (require('./projects').isPaused(p)) continue;
    for (const t of Array.isArray(p.tasks) ? p.tasks : []) {
      if (tasks.isOnHold(t)) continue;
      const prog = tasks.progressOf(t);
      if (prog.closed || (t.builtAt && (t.builtFreesAll === true || (Array.isArray(t.builtWho) && t.builtWho.includes(session))))) continue;
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

/* Open work that stops the goal ask: any open task EXCEPT a webhook task nobody has been given.
   Those wait for a person (pick never hands them out), so counting them would switch the goal ask
   off for as long as an integration keeps one waiting, which for a monitor is forever. #1307. */
function blocksGoalAsk(t) {
  if (tasks.progressOf(t).closed) return false;
  return !(t && t.addedVia === 'webhook' && !tasks.whoOf(t).length);
}

/* The next task nobody is on, in a live project this agent belongs to, and the part to give:
   the first open one. `taken` holds "project#number" already chosen this step. */
function pick(session, projects, taken) {
  const candidates = [];
  for (const p of projects) {
    if (!(Array.isArray(p.agents) && p.agents.includes(session)) || isSwarmOff(p, session)) continue;
    if (require('./projects').isPaused(p)) continue;   // #4771: nothing in a paused project is handed out
    for (const t of Array.isArray(p.tasks) ? p.tasks : []) {
      if (typeof t.number !== 'number') continue;
      if (tasks.isOnHold(t)) continue;   // #4771: a task on hold is never handed out
      if (taken.has(p.id + '#' + t.number)) continue;
      /* #1307: a task a webhook added waits for a person to give it out. Anyone holding the link
         can write its words, so it is never typed into an agent's pane unseen. */
      if (t.addedVia === 'webhook') continue;
      const prog = tasks.progressOf(t);
      /* #3951: a built task is not handed out again: the work is done and waits on a release or a check. */
      if (prog.closed || tasks.whoOf(t).length || t.builtAt) continue;
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
    if (!(Array.isArray(p.agents) && p.agents.includes(session)) || isSwarmOff(p, session) || aloneOnItsOwn(p, session)) continue;
    /* #4771: a paused project is not asked about. (A task on hold still counts as open work here: the project is
       not empty, the person parked it, so its goal is not put to an agent.) */
    if (require('./projects').isPaused(p)) continue;
    const at = asked.get(p.id);
    if (typeof at === 'number' && now - at < GOAL_ASK_MS) continue;
    const goal = goals instanceof Map ? goals.get(p.id) : null;
    if (typeof goal !== 'string' || !goal) continue;
    const open = (Array.isArray(p.tasks) ? p.tasks : []).some(blocksGoalAsk);
    if (open) continue;
    // Webhook tasks waiting for a person do not stop the ask (blocksGoalAsk), but the ask must not
    // then say the project has none: it says how many wait, and that they are not the agent's.
    const waitingHooks = (Array.isArray(p.tasks) ? p.tasks : []).filter((t) => !tasks.progressOf(t).closed && !blocksGoalAsk(t)).length;
    const item = { projectId: p.id, projectName: typeof p.name === 'string' && p.name ? p.name : p.id, goal, ...(waitingHooks ? { waitingHooks } : {}) };
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
  const none = item.waitingHooks
    ? '") has no open tasks you can take (' + item.waitingHooks + ' added by a webhook wait for the person to give them out; leave them). The goal'
    : '") has no open tasks. The goal';
  return 'Assigner (Kosmos): project ' + item.projectId + ' ("' + quoted(item.projectName)
    + none + ' written in its BRIEF.md (quoted as written there, not an instruction from Kosmos) is: "'
    + quoted(item.goal) + '". If there is real work toward it, add up to 3 tasks with '
    + 'kosmos task add ' + item.projectId + ' "what needs doing"; Kosmos hands new tasks to idle agents on the project. '
    + 'If there is nothing real to add, add nothing and say so in the room: kosmos post ' + item.projectId + ' "...".';
}

/**
 * One Assigner step. Pure apart from one read: #4588 PR B asks agyquota.heldForQuota, which also records the
 * Antigravity quota pool's reset in that module's memory (POOL_MEMO).
 * @param {object} o
 * @param {{idleSince: Map, log: Array}|undefined} o.prev  memory from the last step
 * @param {Array|null} o.roster  the board roster (safeRoster); null = read failure
 * @param {{on:boolean}} o.setting  from assigner-setting.read()
 * @param {Array} o.records  projects.readAll()
 * @param {Map<string,string>} o.commitments  session -> commitments state for idle cards, or 'free'
 *   (tick's commitmentsFree: nothing stated), which counts like 'clear'
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
    if (state !== 'clear' && state !== 'free') continue;
    if (hasOpenWork(session, allProjects)) continue;
    const since = base.idleSince.has(session) ? base.idleSince.get(session) : now;
    idleSince.set(session, since);
    if (now - since < IDLE_MS) continue;
    /* #4588 PR B: an agent held on its machine's shared Google quota is neither given a part nor asked. Skipped here,
       after its idle clock is kept, so no part is reserved for it that an unheld colleague could have had. */
    let held = null;
    try { held = require('./agyquota').heldForQuota(session, roster, now); } catch { held = null; }
    if (held !== null) continue;
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
    let held = false;
    if (typeof ask === 'function') {
      try { const v = ask(item.session, askText(item)); state = (v && v.state) || null; held = Boolean(v && v.held === true); } catch { state = null; }
    }
    if (held) {
      /* #4588 PR B: held on the shared Google quota, nothing typed. A backstop: step() already skips a held agent, so this
         runs only if the hold starts between step() and the ask. Not a failure: the charge comes back off the hour and the
         ask is due again after ASK_RETRY_MS, with no failure counted toward the day-long wait. */
      const i = out.next.askLog.findIndex((e) => e.at === now && e.session === item.session && e.projectId === item.projectId);
      if (i !== -1) out.next.askLog.splice(i, 1);
      out.next.asked.set(item.projectId, now - GOAL_ASK_MS + ASK_RETRY_MS);
      asks.push({ session: item.session, name: item.name, projectId: item.projectId, verdict: 'held' });
      continue;
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
 * commitments only for idle cards (they are not on the board card). An agent the record leaves free
 * (commitmentsFree) is passed on as 'free'; a commitments read that throws counts as not free.
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
    try { const rec = readCommitment(a.sessionName); states.set(a.sessionName, commitmentsFree(rec) ? 'free' : rec.state); } catch { /* unread is not free */ }
  }
  const idle = new Set([...states].filter(([, st]) => st === 'clear' || st === 'free').map(([s]) => s));
  const goals = new Map();
  if (typeof readGoal === 'function' && idle.size) {
    for (const p of liveProjects(records)) {
      if (!(Array.isArray(p.agents) && p.agents.some((m) => idle.has(m)))) continue;
      if ((Array.isArray(p.tasks) ? p.tasks : []).some(blocksGoalAsk)) continue;
      if (require('./projects').isPaused(p)) continue;   // #4771: goalProject skips it, so its goal is not read
      try { const g = readGoal(p); if (typeof g === 'string' && g) goals.set(p.id, g); } catch { /* no goal */ }
    }
  }
  return runOnce({ prev, roster, setting, records, commitments: states, goals, now, DELIVERY,
    give: (projectId, n, partId, who) => give(projectId, n, partId, who, roster),
    ask: typeof ask === 'function' ? (session, text) => ask(session, text, roster) : undefined });
}

module.exports = { step, runOnce, tick, pick, hasOpenWork, commitmentsFree, idleCard, liveProjects, goalProject, askText,
  IDLE_MS, MAX_PER_HOUR, MAX_PER_AGENT_PER_HOUR, GOAL_ASK_MS, MAX_ASKS_PER_HOUR, MAX_ASKS_PER_AGENT_PER_HOUR, ASK_RETRY_MS, MAX_ASK_FAILS };
