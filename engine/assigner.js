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

const IDLE_MS = 20 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_PER_HOUR = 10;
const MAX_PER_AGENT_PER_HOUR = 1;

/* A card the Assigner may consider at all: ours, and idle by the board's own reading. */
function idleCard(a) {
  return Boolean(a && a.sessionName && a.isNamedOurs === true && a.state === 'idle');
}

/* Live (non-archived) project records only. */
function liveProjects(records) {
  return (Array.isArray(records) ? records : []).filter((p) => p && typeof p.id === 'string' && p.archived !== true);
}

/* Does this agent have an open part of any task, in any live project? */
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
  return typeof t.dueDate === 'string' && t.dueDate ? t.dueDate : '9999-99-99';
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
    if (!(Array.isArray(p.agents) && p.agents.includes(session))) continue;
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

/**
 * One Assigner step. Pure.
 * @param {object} o
 * @param {{idleSince: Map, log: Array}|undefined} o.prev  memory from the last step
 * @param {Array|null} o.roster  the board roster (safeRoster); null = read failure
 * @param {{on:boolean}} o.setting  from assigner-setting.read()
 * @param {Array} o.records  projects.readAll()
 * @param {Map<string,string>} o.commitments  session -> commitments state, for idle cards
 * @param {number} o.now  ms clock
 * @returns {{toAssign: Array<object>, next: {idleSince: Map, log: Array}}}
 */
function step({ prev, roster, setting, records, commitments, now }) {
  const base = prev && prev.idleSince instanceof Map ? prev : { idleSince: new Map(), log: [] };
  if (!setting || setting.on !== true) return { toAssign: [], next: { idleSince: new Map(), log: [] } };
  // A null roster is a READ FAILURE, not an empty fleet: keep the memory, do nothing.
  if (roster === null || roster === undefined) return { toAssign: [], next: base };
  const projects = liveProjects(records);
  const log = (Array.isArray(base.log) ? base.log : []).filter((e) => e && now - e.at < HOUR_MS);
  const idleSince = new Map();
  const toAssign = [];
  const taken = new Set();
  for (const a of Array.isArray(roster) ? roster : []) {
    if (!idleCard(a)) continue;
    const session = a.sessionName;
    const state = commitments instanceof Map ? commitments.get(session) : undefined;
    if (state !== 'clear') continue;
    if (hasOpenWork(session, projects)) continue;
    const since = base.idleSince.has(session) ? base.idleSince.get(session) : now;
    idleSince.set(session, since);
    if (now - since < IDLE_MS) continue;
    if (log.length >= MAX_PER_HOUR) continue;
    if (log.filter((e) => e.session === session).length >= MAX_PER_AGENT_PER_HOUR) continue;
    const choice = pick(session, projects, taken);
    if (!choice) continue;
    taken.add(choice.projectId + '#' + choice.n);
    toAssign.push({ session, name: a.name || session, ...choice });
    log.push({ at: now, session });
  }
  return { toAssign, next: { idleSince, log } };
}

/**
 * One runner pass over an injected `give` (the part-assign path). A refused give takes its
 * charge back off the budget, so a refusal does not spend an hour's allowance.
 * @returns {{next: object, acted: Array<object>}}
 */
function runOnce({ prev, roster, setting, records, commitments, now, give }) {
  const out = step({ prev, roster, setting, records, commitments, now });
  const acted = [];
  for (const item of out.toAssign) {
    let res;
    try { res = give(item.projectId, item.n, item.partId, item.session); } catch (err) { res = { ok: false, because: String((err && err.message) || err) }; }
    const ok = Boolean(res && res.ok);
    if (!ok) {
      const i = out.next.log.findIndex((e) => e.at === now && e.session === item.session);
      if (i !== -1) out.next.log.splice(i, 1);
    }
    acted.push({ session: item.session, name: item.name, projectId: item.projectId, n: item.n, ok,
      because: ok ? null : (res && res.because) || 'refused', heard: (res && res.heard) || null });
  }
  return { next: out.next, acted };
}

module.exports = { step, runOnce, pick, hasOpenWork, idleCard, liveProjects, IDLE_MS, MAX_PER_HOUR, MAX_PER_AGENT_PER_HOUR };
