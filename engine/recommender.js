'use strict';
/* #3595 phase 1: the Recommender's BEHAVIOUR, reading the setting #3549 persisted
 * (engine/recommender-setting.js). Plan: .claude/plans/recommender-assigner-3595-2026-09-24.md.
 *
 * WHAT IT DOES. When an agent has itself reported that it is stuck (`kosmos report blocked`
 * or `needs_you`, naming a project) and is still stuck after a grace period, Kosmos convenes
 * help ONCE for that item: a room note in the project asks up to two other members for one
 * reply each, and the stuck agent is handed a short playbook in its pane: take the replies,
 * decide, write the decision down in the room (the call, what was rejected, the weakest
 * premise, what would change your mind), carry it out, clear the report. Anything that
 * touches an active guard stays with the person.
 *
 * WHAT IT DELIBERATELY DOES NOT DO.
 * - It never acts on a report the agent did not make: a by:'auto' report is a hook's (a
 *   permission prompt, a provider outage, an end-of-turn idle) and an operator report is the
 *   person's. Only stateReportedBy === 'agent' is an agent saying "I am stuck on a decision".
 * - It never convenes twice for the same item, and it is capped per hour overall and per
 *   agent, so a flapping report cannot flood a room.
 * - It enforces the three guards at the INSTRUCTION level only (the playbook names the active
 *   ones). Agents run with bypass permissions, so nothing mechanical stops a guarded action;
 *   that is why the Recommender ships default-OFF until tool-level guards land (plan, Splinter
 *   2026-09-24).
 *
 * PURE. step() takes the previous memory, the board roster, the setting, the project member
 * lists and a clock, and returns what to convene plus the next memory. The runner (server.js)
 * does the room note and the pane delivery, and marks an item convened ONLY when the pane
 * delivery is PLACED, the same deliver-then-advance rule as the auto-save sweep.
 */

const STUCK_STATES = new Set(['blocked', 'needs_you']);
const GRACE_MS = 10 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_PER_HOUR = 6;
const MAX_PER_AGENT_PER_HOUR = 2;
const MAX_PEERS = 2;
const BECAUSE_MAX = 300;
/* Pane-delivery retries for an item whose room note already went out. Bounded, so an agent
   whose pane cannot be reached is not typed at forever. */
const MAX_DELIVERY_ATTEMPTS = 5;

/* The three guards, in the words Josh chose for the Settings screen (#2619). Keyed like
   recommender-setting's GUARD_KEYS so the playbook names exactly the switches that are on. */
const GUARD_TEXT = Object.freeze({
  money: 'Do not act on anything that spends money',
  public: 'Do not post anything publicly under my name',
  delete: 'Do not delete anything that has no other copy',
});

function itemKey(session, because) {
  return String(session) + '\u0000' + String(because || '');
}

/* An agent that is stuck in a way the Recommender may help with, or null. */
function stuckRow(a) {
  if (!a || !a.sessionName) return null;
  if (!STUCK_STATES.has(a.state)) return null;
  if (a.stateReportedBy !== 'agent') return null;
  if (typeof a.stateProject !== 'string' || !a.stateProject) return null;
  return {
    session: a.sessionName,
    name: a.name || a.sessionName,
    state: a.state,
    project: a.stateProject,
    because: String(a.because || '').slice(0, BECAUSE_MAX),
  };
}

/* Up to MAX_PEERS other members of the project, preferring members who are not themselves
   stuck; deterministic (member order) so a retry asks the same people. */
function peersFor(session, members, stuckSessions, names) {
  const others = (Array.isArray(members) ? members : []).filter((m) => m && m !== session);
  const free = others.filter((m) => !stuckSessions.has(m));
  const busy = others.filter((m) => stuckSessions.has(m));
  return free.concat(busy).slice(0, MAX_PEERS).map((m) => ({ session: m, name: (names && names.get(m)) || m }));
}

/**
 * One Recommender step. Pure.
 * @param {object} o
 * @param {{items: Map, log: number[]}|undefined} o.prev  memory from the last step
 * @param {Array|null} o.roster  the board roster (safeRoster); null = read failure
 * @param {{on:boolean}} o.setting  from recommender-setting.read()
 * @param {Map<string,string[]>} o.members  project id -> member session names
 * @param {number} o.now  ms clock
 * @returns {{toConvene: Array<object>, next: {items: Map, log: number[]}}}
 */
function step({ prev, roster, setting, members, now }) {
  const base = prev && prev.items instanceof Map ? prev : { items: new Map(), log: [] };
  if (!setting || setting.on !== true) return { toConvene: [], next: { items: new Map(), log: [] } };
  // A null roster is a READ FAILURE, not an empty fleet: keep the memory, do nothing
  // (the Prompter's rule, engine/heartbeat.js step()).
  if (roster === null || roster === undefined) return { toConvene: [], next: base };
  const rows = Array.isArray(roster) ? roster : [];
  const names = new Map(rows.filter((a) => a && a.sessionName).map((a) => [a.sessionName, a.name || a.sessionName]));
  const stuck = rows.map(stuckRow).filter(Boolean);
  const stuckSessions = new Set(stuck.map((s) => s.session));
  const log = (Array.isArray(base.log) ? base.log : []).filter((e) => e && now - e.at < HOUR_MS);
  const items = new Map();
  const toConvene = [];
  for (const s of stuck) {
    const key = itemKey(s.session, s.because);
    const was = base.items.get(key);
    const rec = was ? { ...was } : { firstSeen: now, convened: false, noted: false, attempts: 0, session: s.session };
    items.set(key, rec);
    if (rec.convened) continue;
    if (rec.noted) {
      // RETRY: the room note already went out and the pane delivery did not land. Re-deliver
      // the playbook only (never a second room note), charge no budget, stop after the cap.
      if (rec.attempts >= MAX_DELIVERY_ATTEMPTS) continue;
      toConvene.push({ key, ...s, peers: rec.peers || [], retry: true });
      continue;
    }
    if (now - rec.firstSeen < GRACE_MS) continue;
    if (log.length >= MAX_PER_HOUR) continue;
    if (log.filter((e) => e.session === s.session).length >= MAX_PER_AGENT_PER_HOUR) continue;
    const peers = peersFor(s.session, members && members.get(s.project), stuckSessions, names);
    rec.peers = peers;
    toConvene.push({ key, ...s, peers, retry: false });
    // The budget is charged once per item, when it is first convened (its room note).
    log.push({ at: now, session: s.session });
  }
  // Items no longer stuck are dropped, so a later report of the same text is a new item.
  return { toConvene, next: { items, log } };
}

/* The runner reports each attempt: the room note is out (noted) whatever the pane did, and the
   item is convened only when the pane delivery was PLACED. */
function markAttempt(next, key, placed) {
  const rec = next && next.items && next.items.get(key);
  if (!rec) return;
  rec.noted = true;
  rec.attempts = (rec.attempts || 0) + 1;
  if (placed) rec.convened = true;
}
/* Kept for callers that only know about success. */
function markConvened(next, key) { markAttempt(next, key, true); }

function activeGuards(setting) {
  const g = (setting && setting.guards) || {};
  // A missing guard reads ON, the fail-safe direction recommender-setting also takes.
  return Object.keys(GUARD_TEXT).filter((k) => g[k] !== false).map((k) => GUARD_TEXT[k]);
}

/* The room note, in Kosmos's voice (messages.roomNote). */
function roomNoteText(item) {
  const who = item.peers.length ? item.peers.map((p) => '@' + p.name).join(' ') + ': ' : '';
  const ask = item.peers.length
    ? 'one reply each, please, with the call you would make and why.'
    : 'no one else is on this project, so ' + item.name + ' will decide it and note the reasoning here.';
  return 'Recommender: ' + item.name + ' is stuck on: "' + item.because + '". ' + who + ask;
}

/* The playbook delivered into the stuck agent's pane. */
function playbookText(item, setting) {
  const guards = activeGuards(setting);
  const peers = item.peers.length ? item.peers.map((p) => p.name).join(' and ') : '';
  const lines = [
    'Recommender (Kosmos): you reported being stuck on "' + item.because + '".',
    peers
      ? 'I asked ' + peers + ' in the project room for one reply each. Give them a few minutes, then decide.'
      : 'No one else is on this project, so decide it yourself now.',
    'Post your decision in the project room with: the call, what you rejected and why, the weakest premise, and what would change your mind. Then carry it out and clear your report (kosmos report working).',
  ];
  if (guards.length) {
    lines.push('If the call would break any of these, do NOT act: post the recommendation, leave the item for the person, and move to other work. ' + guards.join('. ') + '.');
  }
  return lines.join(' ');
}

module.exports = {
  step, markConvened, markAttempt, stuckRow, peersFor, itemKey, activeGuards, roomNoteText, playbookText,
  GUARD_TEXT, STUCK_STATES, GRACE_MS, MAX_PER_HOUR, MAX_PER_AGENT_PER_HOUR, MAX_PEERS, MAX_DELIVERY_ATTEMPTS,
};
