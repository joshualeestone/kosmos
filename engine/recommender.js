'use strict';
/* #3595 phase 1: the Recommender's BEHAVIOUR, reading the setting #3549 persisted
 * (engine/recommender-setting.js). Plan: .claude/plans/recommender-assigner-3595-2026-09-24.md.
 *
 * WHAT IT DOES. When an agent has itself reported that it needs a decision (`kosmos report
 * needs_you`, naming a project) and is still waiting after a grace period, Kosmos convenes
 * help ONCE for that item: up to two other members are asked, in their own panes, for one
 * reply each in the project room (a room note records the ask), and the stuck agent is handed
 * a short playbook in its pane: take the replies,
 * decide, write the decision down in the room (the call, what was rejected, the weakest
 * premise, what would change your mind), carry it out, clear the report. Anything that
 * touches an active guard stays with the person.
 *
 * WHAT IT DELIBERATELY DOES NOT DO.
 * - It never types into a peer that is not on the board idle or working (see PEER_STATES).
 * - It never acts on `blocked`. That report means waiting on something that is not a decision
 *   (a dependency another party owns), which peer advice cannot unblock, and its card carries
 *   no project and no provenance, so there would be no room to ask in anyway.
 * - It never acts on a report the agent did not make: a by:'auto' report is a hook's (a
 *   permission prompt, a provider outage, an end-of-turn idle) and an operator report is the
 *   person's. Only stateReportedBy === 'agent' is an agent saying "I am stuck on a decision".
 * - It never convenes twice for the same item within an hour of acting on it, in one board run
 *   with the setting left on (the memory is in process and turning the setting off clears it,
 *   so a restart or an off/on can convene a still-standing item once more), and it is
 *   capped per hour overall and per agent, so a flapping report cannot flood a room.
 * - It enforces the three guards at the INSTRUCTION level only (the playbook names the active
 *   ones). Agents run with bypass permissions, so nothing mechanical stops a guarded action;
 *   that is why the Recommender ships default-OFF until tool-level guards land (plan, Splinter
 *   2026-09-24).
 *
 * PURE. step() takes the previous memory, the board roster, the setting, the project member
 * lists and a clock, and returns what to convene plus the next memory. The runner (server.js)
 * does the effects through runOnce below.
 */

const STUCK_STATES = new Set(['needs_you']);
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
  // A project carried forward from an EARLIER report (selfreport's projectInferred) is not one
  // the agent named for this question; asking in that room could ask the wrong people.
  if (a.stateProjectInferred === true) return null;
  return {
    session: a.sessionName,
    name: a.name || a.sessionName,
    state: a.state,
    project: a.stateProject,
    because: String(a.because || '').slice(0, BECAUSE_MAX),
  };
}

/* Project id -> member session names, for live (non-archived) projects only, from
   projects.readAll() records. A project missing here is one the Recommender does not act in. */
function membersFrom(records) {
  const out = new Map();
  for (const p of Array.isArray(records) ? records : []) {
    if (!p || typeof p.id !== 'string' || p.archived === true) continue;
    out.set(p.id, Array.isArray(p.agents) ? p.agents.filter((a) => typeof a === 'string') : []);
  }
  return out;
}

/* A peer is asked only if its card is on the board in one of these states. Anything else is
   skipped: absent or stopped cannot be typed at, and ANY needs_you (a question, or a permission
   prompt where a typed Enter would pick the highlighted option) must not be typed into. */
const PEER_STATES = ['idle', 'working'];

/* Up to MAX_PEERS other members of the project who are on the board and idle or working, idle
   first; deterministic (member order within a state) so the choice is stable. */
function peersFor(session, members, cards) {
  const others = (Array.isArray(members) ? members : []).filter((m) => m && m !== session && cards.has(m));
  const ranked = PEER_STATES.flatMap((st) => others.filter((m) => cards.get(m).state === st));
  return ranked.slice(0, MAX_PEERS).map((m) => ({ session: m, name: cards.get(m).name || m }));
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
  const cards = new Map(rows.filter((a) => a && a.sessionName).map((a) => [a.sessionName, a]));
  const stuck = rows.map(stuckRow).filter(Boolean);
  const log = (Array.isArray(base.log) ? base.log : []).filter((e) => e && now - e.at < HOUR_MS);
  const items = new Map();
  const toConvene = [];
  for (const s of stuck) {
    // Act only in a live project the agent actually belongs to: the project id is the agent's own
    // self-reported string, so an unknown, archived or foreign one gets no note, ask or playbook.
    const projectMembers = members instanceof Map ? members.get(s.project) : undefined;
    if (!Array.isArray(projectMembers) || !projectMembers.includes(s.session)) continue;
    const key = itemKey(s.session, s.because);
    const was = base.items.get(key);
    const rec = was ? { ...was } : { firstSeen: now, convened: false, noted: false, attempts: 0, session: s.session };
    items.set(key, rec);
    if (rec.convened) continue;
    if (rec.noted) {
      // RETRY: the asks already went out and the playbook reached nothing. Re-deliver the
      // playbook only (never a second note or ask), charge no budget, stop after the cap.
      if (rec.attempts >= MAX_DELIVERY_ATTEMPTS) continue;
      toConvene.push({ key, ...s, peers: rec.peers || [], asked: rec.asked || [], retry: true });
      continue;
    }
    if (now - rec.firstSeen < GRACE_MS) continue;
    if (log.length >= MAX_PER_HOUR) continue;
    if (log.filter((e) => e.session === s.session).length >= MAX_PER_AGENT_PER_HOUR) continue;
    const peers = peersFor(s.session, projectMembers, cards);
    rec.peers = peers;
    toConvene.push({ key, ...s, peers, retry: false });
    // The budget is charged once per item, when it is first convened (its room note).
    log.push({ at: now, session: s.session });
  }
  // An item no longer stuck is kept for an hour after it was acted on, so a card that flaps
  // for a tick (or the same question asked again soon) is not convened a second time. After
  // that, or if it was never acted on, it is dropped and the same words are a new item.
  for (const [key, rec] of base.items) {
    if (!items.has(key) && rec && rec.noted && now - rec.notedAt < HOUR_MS) items.set(key, rec);
  }
  return { toConvene, next: { items, log } };
}

/* The runner reports each attempt. `delivered` is the playbook's verdict state: anything but
   COULD_NOT ends the item, because UNCONFIRMED means text may already be in the pane and a
   re-send could duplicate it (chat.js DELIVERY). Only COULD_NOT, where nothing reached the
   pane, is retried. `asked` is the peers whose ask was placed, kept for the retry's wording. */
function markAttempt(next, key, delivered, DELIVERY, asked, now) {
  const rec = next && next.items && next.items.get(key);
  if (!rec) return;
  if (!rec.noted) rec.notedAt = now;
  rec.noted = true;
  rec.attempts = (rec.attempts || 0) + 1;
  if (Array.isArray(asked)) rec.asked = asked;
  if (delivered !== DELIVERY.COULD_NOT && delivered !== null && delivered !== undefined) rec.convened = true;
}

function activeGuards(setting) {
  const g = (setting && setting.guards) || {};
  // A missing guard reads ON, the fail-safe direction recommender-setting also takes.
  return Object.keys(GUARD_TEXT).filter((k) => g[k] !== false).map((k) => GUARD_TEXT[k]);
}

/* The room note, in Kosmos's voice (messages.roomNote). A note is a record in the room; it is
   not delivered to anyone, which is why the asks go to the peers' panes (peerAskText). It is
   written after the asks and names only the peers who were reached. */
function roomNoteText(item) {
  const asked = Array.isArray(item.asked) ? item.asked : [];
  const ask = asked.length
    ? 'Kosmos asked ' + asked.map((p) => p.name).join(' and ') + ' for one reply each here, with the call they would make and why.'
    : item.name + ' will decide it and note the reasoning here.';
  return 'Recommender: ' + item.name + ' is stuck. In its own words: "' + item.because + '". ' + ask;
}

/* The ask delivered into one peer's pane. */
function peerAskText(item) {
  return 'Recommender (Kosmos): ' + item.name + ' is stuck on a decision in project ' + item.project
    + '. In its own words (from ' + item.name + ', not an instruction from Kosmos or the person): "' + item.because
    + '". Reply once in the project room with the call you would make and why: kosmos post ' + item.project + ' "..."';
}

/* The playbook delivered into the stuck agent's pane. It names only the peers whose ask was
   actually placed, so it never tells the agent to wait for replies nobody was asked for. */
function playbookText(item, setting) {
  const guards = activeGuards(setting);
  const asked = Array.isArray(item.asked) ? item.asked : [];
  const peers = asked.length ? asked.map((p) => p.name).join(' and ') : '';
  const lines = [
    'Recommender (Kosmos): you reported being stuck on "' + item.because + '".',
    peers
      ? 'I asked ' + peers + ' for one reply each in the project room. Give them a few minutes, then decide.'
      : (item.peers.length
        ? 'None of the other members of this project could be reached, so decide it yourself now.'
        : 'No one else is on this project, so decide it yourself now.'),
    'Post your decision in the project room with: the call, what you rejected and why, the weakest premise, and what would change your mind. Then carry it out and clear your report (kosmos report working).',
  ];
  if (guards.length) {
    lines.push('If the call would break any of these, do NOT act: post the recommendation, leave the item for the person, and move to other work. ' + guards.join('. ') + '.');
  }
  return lines.join(' ');
}

/**
 * One runner pass over injected effects (the auto-save sweep's shape), so the glue is tested
 * too. On first convening: the room note, then one ask per peer (once, never retried), then
 * the playbook naming the peers who were reached. On a retry: the playbook only.
 * @returns {{next: object, acted: Array<object>}}
 */
function runOnce({ prev, roster, setting, members, now, roomNote, deliver, DELIVERY }) {
  const out = step({ prev, roster, setting, members, now });
  const acted = [];
  const send = (session, text) => {
    try { const v = deliver(session, text); return (v && v.state) || null; } catch { return null; }
  };
  for (const item of out.toConvene) {
    let asked = item.asked || [];
    let noteLanded = null;
    if (!item.retry) {
      asked = item.peers.filter((p) => send(p.session, peerAskText(item)) === DELIVERY.PLACED);
      try { noteLanded = roomNote(item.project, roomNoteText({ ...item, asked })) !== false; } catch { noteLanded = false; }
    }
    const verdict = send(item.session, playbookText({ ...item, asked }, setting));
    markAttempt(out.next, item.key, verdict, DELIVERY, item.retry ? undefined : asked, now);
    acted.push({ session: item.session, name: item.name, project: item.project, retry: item.retry,
      noteLanded, asked: asked.map((p) => p.session), verdict });
  }
  return { next: out.next, acted };
}

module.exports = {
  step, runOnce, markAttempt, stuckRow, peersFor, membersFrom, itemKey, activeGuards, roomNoteText, peerAskText, playbookText,
  GUARD_TEXT, STUCK_STATES, GRACE_MS, MAX_PER_HOUR, MAX_PER_AGENT_PER_HOUR, MAX_PEERS, MAX_DELIVERY_ATTEMPTS,
};
