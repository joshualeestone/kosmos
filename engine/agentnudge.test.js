'use strict';
/* #4544: the Prompter's nudge to the AGENT. Real inputs throughout: board cards from
 * test-support/fleet + status.snapshot(), projects and tasks made by engine/projects + engine/tasks,
 * and toAsk produced by the real heartbeat.step. deliver is injected, so no real agent is typed into.
 * Every rule is tested with the arm that must fire AND the arm that must not.
 *
 *   node --test engine/agentnudge.test.js
 */

require('../test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Sandbox every root BEFORE requiring status/fleet/projects (they resolve roots at require time).
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'agentnudge-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');

const test = require('node:test');
const assert = require('node:assert/strict');

const fleet = require('../test-support/fleet');
const status = require('./status');
const projects = require('./projects');
const tasks = require('./tasks');
const heartbeat = require('./heartbeat');
const nudge = require('./agentnudge');
const { DELIVERY } = require('./chat');
require('../test-support/data-root-sandbox').assertSandboxedDataRoot(SANDBOX, [require('./store').ROOT]);

test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const INTERVAL = 15 * 60 * 1000;
let seq = 0;

/* A board of agents (idle unless paneState says otherwise) and a fresh project they all belong to. */
function world(specs) {
  const board = fleet.install(specs.map((s) => fleet.agent(s.name, { state: s.paneState || 'idle' })));
  const key = {};
  for (const s of specs) {
    const card = board.agents.find((c) => c.sessionName === s.name) || board.agents.find((c) => (c.sessionName || '').startsWith(s.name));
    key[s.name] = card ? card.sessionName : s.name;
  }
  const p = projects.create({ name: 'Nudge Test ' + (++seq) });
  for (const s of specs) projects.addAgent(p.id, key[s.name], board.agents);
  const cards = status.snapshot().agents;
  return { cards, key, pid: p.id, restore: board.restore };
}

/* A task in the project with its one part on `who`. */
function taskOn(w, who, sentence) {
  const t = tasks.create(w.pid, { sentence, made: { via: 'screen' } });
  const r = tasks.assignPart(w.pid, t.number, 1, who, { via: 'screen' });
  assert.ok(r && r.ok, 'fixture: assignPart refused: ' + JSON.stringify(r));
  return t.number;
}

/* The Prompter's own record after enough ticks for a never-worked idle agent to open a stall. */
function stalled(cards) {
  let prev = new Map();
  let out;
  for (let i = 0; i < heartbeat.STARTUP_STALL_TICKS; i += 1) { out = heartbeat.step(prev, cards, true); prev = out.next; }
  return out;
}

/* One pass with a delivery spy. Past the interval by default, so a part given at fixture time is not fresh. */
function pass(w, o = {}) {
  const calls = [];
  const hb = o.hb || stalled(w.cards);
  const res = nudge.sweepOnce({
    toAsk: hb.toAsk, next: hb.next, roster: w.cards, projects: projects.readAll(),
    book: o.book || new Map(), sent: o.sent || [], now: o.now || (Date.now() + INTERVAL + 1000), intervalMs: INTERVAL,
    limit: o.limit || { on: false },
    deliver: (session, text) => { calls.push({ session, text }); return { state: o.state || DELIVERY.PLACED }; },
    DELIVERY,
  });
  return { calls, res, hb };
}

test('fixture control: the real Prompter opens a stall for an idle agent (toAsk names it)', () => {
  const w = world([{ name: 'fxidle' }]);
  try {
    assert.deepEqual(stalled(w.cards).toAsk.map((x) => x.session), [w.key.fxidle]);
    assert.ok(nudge.nudgeableCard(w.cards.find((c) => c.sessionName === w.key.fxidle)), 'fixture: the card does not read idle and ours');
  } finally { w.restore(); }
});

test('an idle agent with an open task gets exactly one nudge naming it; one with nothing gets none', () => {
  const w = world([{ name: 'hastask' }, { name: 'notask' }]);
  try {
    const n = taskOn(w, w.key.hastask, 'write the release notes');
    const book = new Map();
    const first = pass(w, { book });
    assert.deepEqual(first.calls.map((c) => c.session), [w.key.hastask]);
    assert.deepEqual(first.res.results.map((r) => r.session + ':' + r.act), [w.key.hastask + ':nudge'], 'the agent with nothing must leave no result at all');
    assert.match(first.calls[0].text, new RegExp('task #' + n + ' "write the release notes"'));
    assert.match(first.calls[0].text, /kosmos report blocked --on <what> --owner <who>/);
    // The same stall, the next interval: no second nudge.
    const again = pass(w, { book, hb: first.hb });
    assert.equal(again.calls.length, 0, 'nudged twice in one stall');
  } finally { w.restore(); }
});

test('control: without the agent nudge the Prompter tick types nothing (the person-only behaviour)', () => {
  const w = world([{ name: 'ctlonly' }]);
  try {
    taskOn(w, w.key.ctlonly, 'a task');
    const hb = stalled(w.cards);
    assert.equal(hb.toAsk.length, 1, 'fixture: the Prompter must have a stall to report');
    // heartbeat.step and prompternudge.write are the whole of the tick before #4544: neither takes a
    // deliver, so the only way an agent is typed into is agentnudge. The brake turns it off.
    assert.equal(nudge.nudgeEnabled(true, { AGENT_WORKFORCE_AGENT_NUDGE_OFF: '1' }), false);
    assert.equal(nudge.nudgeEnabled(false, {}), false, 'must be inert before the live-execution opt-in');
    assert.equal(nudge.nudgeEnabled(true, {}), true);
  } finally { w.restore(); }
});

test('a new stall after the agent worked again gets a new nudge (the episode ends on work)', () => {
  const w = world([{ name: 'backagain' }]);
  try {
    taskOn(w, w.key.backagain, 'a task');
    const book = new Map();
    const first = pass(w, { book });
    assert.equal(first.calls.length, 1);
    // It worked: the Prompter's record closes the episode, and the book lets it go.
    const worked = heartbeat.step(first.hb.next, w.cards.map((c) => c.sessionName === w.key.backagain ? { ...c, state: 'working', stateConfidence: 'high' } : c), true);
    nudge.sweepOnce({ toAsk: worked.toAsk, next: worked.next, roster: w.cards, projects: projects.readAll(), book, sent: [], now: Date.now() + INTERVAL + 1000, intervalMs: INTERVAL, limit: { on: false }, deliver: () => ({ state: DELIVERY.PLACED }), DELIVERY });
    assert.equal(book.has(w.key.backagain), false, 'the book kept a closed episode');
    // It stopped again (working -> idle is the Prompter's edge): one fresh nudge.
    const stoppedAgain = heartbeat.step(worked.next, w.cards, true);
    const second = pass(w, { book, hb: stoppedAgain });
    assert.equal(second.calls.length, 1, 'a fresh stall after work was not nudged');
  } finally { w.restore(); }
});

test('a part given within the last interval is not nudged; past the interval it is (control)', () => {
  const w = world([{ name: 'justgiven' }]);
  try {
    taskOn(w, w.key.justgiven, 'fresh work');
    assert.equal(pass(w, { now: Date.now() }).calls.length, 0, 'nudged an agent just given its work');
    assert.equal(pass(w).calls.length, 1, 'control: past the interval it must be nudged');
  } finally { w.restore(); }
});

test('a card that is not idle (needs_you, working, unknown) is never typed into', () => {
  for (const paneState of ['needs_you', 'working']) {
    const w = world([{ name: 'st' + paneState.replace('_', ''), paneState }]);
    try {
      const k = Object.values(w.key)[0];
      taskOn(w, k, 'a task');
      // Force it into toAsk regardless of the Prompter, so the card rule alone is what refuses.
      const hb = { toAsk: [{ session: k, from: 'working', to: 'idle' }], next: new Map([[k, { open: true }]]) };
      assert.equal(pass(w, { hb }).calls.length, 0, paneState + ' card was typed into');
    } finally { w.restore(); }
  }
});

test('a delivery that reached nothing is retried, at most MAX_TRIES times per stall', () => {
  const w = world([{ name: 'refuses' }]);
  try {
    taskOn(w, w.key.refuses, 'a task');
    const book = new Map();
    const hb = stalled(w.cards);
    let total = 0;
    for (let i = 0; i < nudge.MAX_TRIES + 2; i += 1) total += pass(w, { book, hb, state: DELIVERY.COULD_NOT }).calls.length;
    assert.equal(total, nudge.MAX_TRIES);
  } finally { w.restore(); }
});

test('Agent Communication\'s limit caps nudges across the board in an hour; off, it does not', () => {
  const w = world([{ name: 'capa' }, { name: 'capb' }, { name: 'capc' }]);
  try {
    for (const k of Object.values(w.key)) taskOn(w, k, 'a task');
    const now = Date.now() + INTERVAL + 1000;
    assert.equal(pass(w, { now, limit: { on: true, perHour: 2 } }).calls.length, 2, 'the cap did not hold');
    assert.equal(pass(w, { now, limit: { on: false, perHour: 2 } }).calls.length, 3, 'control: off, all three are nudged');
    // A nudge an hour old no longer counts.
    const sent = [now - nudge.HOUR_MS - 1, now - nudge.HOUR_MS - 1];
    assert.equal(pass(w, { now, sent, limit: { on: true, perHour: 2 } }).calls.length, 2, 'an hour-old nudge still counted');
  } finally { w.restore(); }
});

test('a task that is closed does not count as open work', () => {
  const w = world([{ name: 'closedwork' }]);
  try {
    const n = taskOn(w, w.key.closedwork, 'finished');
    const r = tasks.close(w.pid, n);
    assert.ok(r && r.ok !== false, 'fixture: close refused: ' + JSON.stringify(r));
    assert.equal(pass(w).calls.length, 0);
  } finally { w.restore(); }
});

test('control for the closed-task arm: the same task left open is nudged', () => {
  const w = world([{ name: 'openwork' }]);
  try {
    taskOn(w, w.key.openwork, 'not finished');
    assert.equal(pass(w).calls.length, 1);
  } finally { w.restore(); }
});

test('openParts agrees with the Assigner\'s hasOpenWork: open, closed, built, and another agent\'s part', () => {
  const assigner = require('./assigner');
  const w = world([{ name: 'agrmine' }, { name: 'agrother' }, { name: 'agrbuilt' }, { name: 'agrclosed' }, { name: 'agrnone' }]);
  try {
    taskOn(w, w.key.agrmine, 'mine');
    taskOn(w, w.key.agrother, 'theirs');
    const b = taskOn(w, w.key.agrbuilt, 'built');
    const c = taskOn(w, w.key.agrclosed, 'closed');
    assert.ok(tasks.close(w.pid, c), 'fixture: close refused');
    const mb = tasks.setBuilt(w.pid, b, { by: w.key.agrbuilt });
    assert.ok(mb && mb.ok !== false, 'fixture: setBuilt refused: ' + JSON.stringify(mb));
    const recs = projects.readAll();
    const seen = {};
    for (const k of Object.values(w.key)) {
      seen[k] = [nudge.openParts(k, recs).length > 0, assigner.hasOpenWork(k, recs)];
      assert.equal(seen[k][0], seen[k][1], 'openParts and hasOpenWork disagree for ' + k + ': ' + JSON.stringify(seen[k]));
    }
    // Controls: both answers occur, so agreement is not two functions that always say the same thing.
    assert.equal(seen[w.key.agrmine][0], true);
    assert.equal(seen[w.key.agrnone][0], false);
    assert.equal(seen[w.key.agrclosed][0], false);
    assert.equal(seen[w.key.agrbuilt][0], false, 'a task this agent marked built still counted');
  } finally { w.restore(); }
});
