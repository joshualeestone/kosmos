'use strict';
/* #4588 PR B: while any Antigravity agent on this machine is paused on its Google account's shared quota, automatic
 * timers type into NO antigravity agent here, and a hold never spends a sender's one-shot budget. Every rule is tested
 * with the arm that must fire AND a control arm that must not, on the fixture shapes the sibling suites use (fleet +
 * the real status snapshot + selfreport for cards; real projects, tasks, commitments and briefs for the Assigner).
 * Every deliver here is an injected stub, so no real pane is ever typed into.
 *
 *   node --test engine/agyhold-4588.test.js
 */

require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Sandbox every root BEFORE requiring any engine module (they resolve roots at require time).
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-agyhold-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');

const test = require('node:test');
const assert = require('node:assert/strict');

const store = require('./store');
const fleet = require('../test-support/fleet');
const status = require('./status');
const selfreport = require('./selfreport');
const projects = require('./projects');
const tasks = require('./tasks');
const commitments = require('./commitments');
const brief = require('./brief');
const heartbeat = require('./heartbeat');
const chat = require('./chat');
const messages = require('./messages');
const agyquota = require('./agyquota');
const firstreply = require('./firstreply-nudge');
const agentnudge = require('./agentnudge');
const assigner = require('./assigner');
const recommender = require('./recommender');
const { DELIVERY } = chat;

require('../test-support/data-root-sandbox').assertSandboxedDataRoot(SANDBOX, [store.ROOT]);

test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('sandbox: the store root is inside this process\'s temp dir, not the live Kosmos data', () => {
  const root = path.resolve(store.ROOT);
  assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep), root);
  assert.ok(root.startsWith(path.resolve(SANDBOX) + path.sep), root);
});

/* The shape a held deliverAutomatic returns (chat.js), and the plain refusal it must be told apart from. */
const HELD = () => ({ state: DELIVERY.COULD_NOT, held: true, heldUntil: new Date(Date.now() + 60e3).toISOString(), because: 'held' });
const REFUSED = () => ({ state: DELIVERY.COULD_NOT, because: 'refused' });
const QUOTA_BECAUSE = "Paused: this Google account's shared Antigravity quota ran out.";

/* ---- 1. poolHeldUntil / heldForQuota, on real board cards ---- */

/* Real cards: two agy agents and a claude one, built by the real snapshot from real self-reports (the
   status.agyquota-card-4588 fixture). `pausedUntil` maps agent name -> ISO reset for the ones paused. */
let agyRun = 0;
function agyBoard(pausedUntil) {
  // Fresh session names per board: a self-report outlives the board, so reused names would inherit the last one.
  const run = ++agyRun;
  const n = { agyholda: 'agyholda' + run, agyholdb: 'agyholdb' + run, claudehold: 'claudehold' + run };
  const board = fleet.install([
    fleet.agent(n.agyholda, { state: 'unknown', runner: 'antigravity', command: 'agy', screen: '' }),
    fleet.agent(n.agyholdb, { state: 'unknown', runner: 'antigravity', command: 'agy', screen: '' }),
    fleet.agent(n.claudehold, { state: 'idle' }),
  ]);
  for (const k of ['agyholda', 'agyholdb']) {
    const report = pausedUntil[k]
      ? { state: 'idle', because: QUOTA_BECAUSE, until: pausedUntil[k], auto: true }
      : { state: 'idle', because: 'finished', auto: true };
    assert.equal(selfreport.record(n[k], report).recorded, true, 'fixture: self-report refused for ' + n[k]);
  }
  const cards = status.snapshot().agents;
  return { cards, restore: board.restore, s: n, card: (k) => cards.find((c) => c.sessionName === n[k]) };
}

test('#4588 B fixture: a paused agy card carries quotaUntil and runner antigravity; the claude card does not', () => {
  const until = new Date(Date.now() + 25 * 60e3).toISOString();
  const b = agyBoard({ agyholda: until });
  try {
    assert.equal(b.card('agyholda').runner, 'antigravity');
    assert.equal(b.card('agyholda').quotaUntil, until);
    assert.equal(b.card('agyholdb').runner, 'antigravity');
    assert.equal(b.card('agyholdb').quotaUntil, null, 'CONTROL: the idle agy colleague carries no reset of its own');
    assert.equal(b.card('claudehold').runner, 'claude');
  } finally { b.restore(); }
});

test('#4588 B heldForQuota: a paused agy card holds itself AND its idle agy colleague; the claude card is not held', () => {
  const until = new Date(Date.now() + 25 * 60e3).toISOString();
  const b = agyBoard({ agyholda: until });
  try {
    const now = Date.now();
    assert.equal(agyquota.poolHeldUntil(b.cards, now), Date.parse(until));
    assert.equal(agyquota.heldForQuota(b.s.agyholda, b.cards, now), Date.parse(until), 'the paused agent itself');
    assert.equal(agyquota.heldForQuota(b.s.agyholdb, b.cards, now), Date.parse(until), 'the idle colleague shares the one pool');
    assert.equal(agyquota.heldForQuota(b.s.claudehold, b.cards, now), null, 'CONTROL: a claude agent draws on no Google pool');
    assert.equal(agyquota.heldForQuota('not-on-board', b.cards, now), null, 'a session missing from the roster is not held');
  } finally { b.restore(); }
});

test('#4588 B heldForQuota: a reset already past holds nothing; no paused agy card is null', () => {
  const until = new Date(Date.now() + 25 * 60e3).toISOString();
  const b = agyBoard({ agyholda: until });
  try {
    const after = Date.parse(until) + 1;
    assert.equal(agyquota.poolHeldUntil(b.cards, after), null);
    assert.equal(agyquota.heldForQuota(b.s.agyholdb, b.cards, after), null);
    // At the reset instant itself the pool is open again (strictly-after rule).
    assert.equal(agyquota.poolHeldUntil(b.cards, Date.parse(until)), null);
    // CONTROL: one millisecond before, it is held.
    assert.equal(agyquota.poolHeldUntil(b.cards, Date.parse(until) - 1), Date.parse(until));
  } finally { b.restore(); }
  const none = agyBoard({});
  try {
    assert.equal(agyquota.poolHeldUntil(none.cards, Date.now()), null);
    assert.equal(agyquota.heldForQuota(none.s.agyholda, none.cards, Date.now()), null);
  } finally { none.restore(); }
});

test('#4588 B poolHeldUntil: the latest of two resets is returned', () => {
  const early = new Date(Date.now() + 10 * 60e3).toISOString();
  const late = new Date(Date.now() + 40 * 60e3).toISOString();
  const b = agyBoard({ agyholda: late, agyholdb: early });
  try {
    assert.equal(agyquota.poolHeldUntil(b.cards, Date.now()), Date.parse(late));
    // Past the early reset, the late one still holds the pool.
    assert.equal(agyquota.heldForQuota(b.s.agyholdb, b.cards, Date.parse(early) + 1), Date.parse(late));
  } finally { b.restore(); }
  // Order-independence: the same pair written the other way round.
  const c = agyBoard({ agyholda: early, agyholdb: late });
  try { assert.equal(agyquota.poolHeldUntil(c.cards, Date.now()), Date.parse(late)); } finally { c.restore(); }
});

test('#4588 B poolHeldUntil: garbage in is null, never a throw', () => {
  assert.equal(agyquota.poolHeldUntil(null, Date.now()), null);
  assert.equal(agyquota.poolHeldUntil([null, { runner: 'antigravity', quotaUntil: 'not a date' }], Date.now()), null);
  assert.equal(agyquota.heldForQuota('x', undefined, Date.now()), null);
});

/* ---- 3a. firstreply-nudge: a held deliver spends no try ---- */

const FR_NOW = Date.parse('2026-09-28T12:00:00.000Z');
const FR_HEARD = new Date(FR_NOW - 90 * 1000).toISOString();
const frPersonRow = () => ({ at: FR_HEARD, text: 'hello, are you there?', from: null, wire: null, delivery: { state: 'placed', because: null } });

function frSweep(result) {
  const board = fleet.install([fleet.agent('frhold', { screen: fleet.SCREEN.idle, state: 'idle' })]);
  const roster = board.agents;
  const book = new Map();
  const calls = [];
  const o = { roster, book, now: FR_NOW, thread: () => ({ messages: [frPersonRow()] }),
    deliver: (session, text) => { calls.push({ session, text }); return result(); }, DELIVERY, log: () => {} };
  return { o, book, calls, session: roster[0].sessionName, restore: board.restore };
}

test('#4588 B firstreply: a held delivery leaves the book untouched and reports act held; CONTROL: a plain could_not spends a try', () => {
  const h = frSweep(HELD);
  try {
    assert.equal(h.o.roster[0].state, 'idle', 'fixture: the card must read idle or the nudge is never tried');
    const r = firstreply.sweepOnce(h.o);
    assert.equal(h.calls.length, 1, 'fixture: the nudge was not attempted at all');
    assert.deepEqual(r.results.map((x) => x.act), ['held']);
    assert.equal(r.results[0].delivered, false);
    assert.equal(h.book.size, 0, 'a held nudge wrote the book (spent a try)');
    // Held every minute for longer than MAX_TRIES: still never spent, and still tried each sweep.
    for (let i = 0; i < firstreply.MAX_TRIES + 2; i++) firstreply.sweepOnce(h.o);
    assert.equal(h.book.size, 0);
    assert.equal(h.calls.length, firstreply.MAX_TRIES + 3, 'a held nudge stopped being tried');
  } finally { h.restore(); }
  const c = frSweep(REFUSED);
  try {
    const r = firstreply.sweepOnce(c.o);
    assert.deepEqual(r.results.map((x) => x.act), ['nudge']);
    assert.equal(c.book.get(c.session).tries, 1, 'CONTROL: a could_not without held must spend one try');
  } finally { c.restore(); }
});

/* ---- 3b. agentnudge: a held deliver spends no try and nothing counts toward the hour ---- */

let seq = 0;
function anWorld(name) {
  const board = fleet.install([fleet.agent(name, { state: 'idle' })]);
  const card0 = board.agents.find((c) => c.sessionName === name) || board.agents[0];
  const session = card0.sessionName;
  const p = projects.create({ name: 'Agy Hold Nudge ' + (++seq) });
  projects.addAgent(p.id, session, board.agents);
  const cards = status.snapshot().agents;
  const t = tasks.create(p.id, { sentence: 'write the release notes', made: { via: 'screen' } });
  const given = tasks.assignPart(p.id, t.number, 1, session, { via: 'screen' });
  assert.ok(given && given.ok, 'fixture: assignPart refused: ' + JSON.stringify(given));
  let prev = new Map();
  let hb;
  for (let i = 0; i < heartbeat.STARTUP_STALL_TICKS; i += 1) { hb = heartbeat.step(prev, cards, true); prev = hb.next; }
  return { cards, session, hb, restore: board.restore };
}
function anPass(w, result, book, sent) {
  const calls = [];
  const res = agentnudge.sweepOnce({
    toAsk: w.hb.toAsk, next: w.hb.next, roster: w.cards, projects: projects.readAll(),
    book, sent, now: Date.now() + 15 * 60e3 + 1000, intervalMs: 15 * 60e3, limit: { on: false },
    deliver: (session, text) => { calls.push({ session, text }); return result(); }, DELIVERY,
  });
  return { calls, res };
}

test('#4588 B agentnudge: a held delivery leaves the book and the hour untouched; CONTROL: a plain could_not spends a try', () => {
  const w = anWorld('anhold');
  try {
    assert.deepEqual(w.hb.toAsk.map((x) => x.session), [w.session], 'fixture: the Prompter did not open a stall');
    const book = new Map();
    const sent = [];
    const first = anPass(w, HELD, book, sent);
    assert.equal(first.calls.length, 1, 'fixture: the nudge was not attempted at all');
    assert.deepEqual(first.res.results.map((r) => r.act), ['held']);
    assert.equal(first.res.results[0].delivered, false);
    assert.equal(book.size, 0, 'a held nudge wrote the book (spent a try)');
    assert.equal(sent.length, 0, 'a held nudge counted toward the hourly limit');
    // A held verdict is checked before the verdict state: even a (never-produced) placed+held counts nothing.
    const odd = anPass(w, () => ({ ...HELD(), state: DELIVERY.PLACED }), book, sent);
    assert.deepEqual(odd.res.results.map((r) => r.act), ['held']);
    assert.equal(book.size, 0);
    assert.equal(sent.length, 0, 'held must never count toward the hour, whatever the state says');
  } finally { w.restore(); }
  const c = anWorld('anctl');
  try {
    const book = new Map();
    const sent = [];
    const r = anPass(c, REFUSED, book, sent);
    assert.deepEqual(r.res.results.map((x) => x.act), ['nudge']);
    assert.equal(book.get(c.session).tries, 1, 'CONTROL: a could_not without held must spend one try');
  } finally { c.restore(); }
});

/* ---- 4. assigner runOnce: a held ask is refunded and retried soon, with no failure counted ---- */

const T0 = 1_000_000_000_000;
const ON = { on: true };
function asgWorld(name) {
  const board = fleet.install([fleet.agent(name, { state: 'idle' })]);
  const card0 = board.agents.find((c) => c.sessionName === name) || board.agents[0];
  const session = card0.sessionName;
  const rep = commitments.report(session, []);
  assert.ok(rep && rep.ok !== false, 'fixture: commitments report refused: ' + JSON.stringify(rep));
  const p = projects.create({ name: 'Agy Hold Assigner ' + (++seq) });
  projects.addAgent(p.id, session, board.agents);
  const folder = projects.readAll().find((x) => x.id === p.id).folder;
  fs.writeFileSync(path.join(folder, 'BRIEF.md'), '## Goal\n\nA real goal.\n');
  const cards = status.snapshot().agents;
  return { cards, session, pid: p.id, restore: board.restore };
}
function asgTick(w, prev, now, result) {
  const asks = [];
  const out = assigner.tick({
    prev, now, DELIVERY,
    readSetting: () => ON,
    readRoster: () => w.cards,
    readRecords: () => projects.readAll(),
    readCommitment: (session) => commitments.read(session),
    readGoal: (p) => brief.readGoal(p.folder),
    give: () => ({ ok: true }),
    ask: (session, text) => { asks.push({ session, text }); return result(); },
  });
  return { out, asks };
}
const charges = (next, session) => next.askLog.filter((e) => e.session === session).length;

test('#4588 B assigner step: an agy agent held on the pool is neither asked nor given work, so nothing is reserved for it; CONTROL: unheld, it is asked', () => {
  const w = asgWorld('asgstep' + (++seq));
  try {
    const at = T0 + assigner.IDLE_MS;
    // The same idle card, now an Antigravity agent; a second agy card's pause is what empties the machine's pool.
    const asAgy = w.cards.map((c) => (c.sessionName === w.session ? { ...c, runner: 'antigravity' } : c));
    const paused = { sessionName: 'agypoolpaused', runner: 'antigravity', state: 'rate_limited', quotaUntil: new Date(at + 20 * 60e3).toISOString() };
    const run = (cards) => {
      assigner.tick({ prev: undefined, now: T0, DELIVERY, readSetting: () => ON, readRoster: () => cards, readRecords: () => projects.readAll(),
        readCommitment: (s) => commitments.read(s), readGoal: (p) => brief.readGoal(p.folder), give: () => ({ ok: true }), ask: () => ({ state: DELIVERY.PLACED }) });
      const first = assigner.tick({ prev: undefined, now: T0, DELIVERY, readSetting: () => ON, readRoster: () => cards, readRecords: () => projects.readAll(),
        readCommitment: (s) => commitments.read(s), readGoal: (p) => brief.readGoal(p.folder), give: () => ({ ok: true }), ask: () => ({ state: DELIVERY.PLACED }) });
      const asks = [];
      const out = assigner.tick({ prev: first.next, now: at, DELIVERY, readSetting: () => ON, readRoster: () => cards, readRecords: () => projects.readAll(),
        readCommitment: (s) => commitments.read(s), readGoal: (p) => brief.readGoal(p.folder), give: () => ({ ok: true }), ask: (session) => { asks.push(session); return { state: DELIVERY.PLACED }; } });
      return { out, asks };
    };
    const held = run(asAgy.concat([paused]));
    assert.deepEqual(held.asks, [], 'a held agent was asked');
    assert.equal(held.out.next.askLog.length, 0, 'a held agent was charged');
    const ctl = run(asAgy);
    assert.deepEqual(ctl.asks, [w.session], 'CONTROL: the unheld agy agent was not asked, so the arm above proves nothing');
  } finally { w.restore(); }
});

test('#4588 B assigner: a held ask refunds its charge, counts no failure, and is due again after ASK_RETRY_MS', () => {
  const w = asgWorld('asghold');
  try {
    const seen = asgTick(w, undefined, T0, HELD);
    const at = T0 + assigner.IDLE_MS;
    const held = asgTick(w, seen.out.next, at, HELD);
    assert.equal(held.asks.length, 1, 'fixture: the goal ask was not attempted');
    assert.deepEqual(held.out.asks.map((x) => x.verdict), ['held']);
    assert.equal(charges(held.out.next, w.session), 0, 'the held ask kept its hourly charge');
    assert.equal(held.out.next.askFails.has(w.pid), false, 'a held ask counted as a failure');
    assert.equal(held.out.next.asked.get(w.pid), at - assigner.GOAL_ASK_MS + assigner.ASK_RETRY_MS, 'not set to the short retry');
    // Inside the retry wait: not asked again.
    assert.equal(asgTick(w, held.out.next, at + assigner.ASK_RETRY_MS - 1, HELD).asks.length, 0);
    // At the retry: asked again, because the per-agent hourly cap (1) was given back.
    const again = asgTick(w, held.out.next, at + assigner.ASK_RETRY_MS, () => ({ state: DELIVERY.PLACED }));
    assert.equal(again.asks.length, 1, 'the refunded ask was not tried again after ASK_RETRY_MS');
  } finally { w.restore(); }
});

test('#4588 B assigner CONTROL: a plain could_not keeps its charge, counts a failure, and the hour blocks the retry', () => {
  const w = asgWorld('asgctl');
  try {
    const seen = asgTick(w, undefined, T0, REFUSED);
    const at = T0 + assigner.IDLE_MS;
    const lost = asgTick(w, seen.out.next, at, REFUSED);
    assert.equal(lost.asks.length, 1);
    assert.deepEqual(lost.out.asks.map((x) => x.verdict), [DELIVERY.COULD_NOT]);
    assert.equal(charges(lost.out.next, w.session), 1, 'CONTROL: a could_not keeps its charge');
    assert.equal(lost.out.next.askFails.get(w.pid), 1, 'CONTROL: a could_not counts one failure');
    assert.equal(asgTick(w, lost.out.next, at + assigner.ASK_RETRY_MS, REFUSED).asks.length, 0,
      'CONTROL: the kept charge blocks a retry inside the hour');
    // And a hold after a real failure leaves the count where it was (not incremented, not cleared).
    const retryAt = at + 61 * 60e3;
    const held = asgTick(w, lost.out.next, retryAt, HELD);
    assert.equal(held.asks.length, 1, 'fixture: the retry was not attempted');
    assert.equal(held.out.next.askFails.get(w.pid), 1, 'a held ask changed the failure count');
  } finally { w.restore(); }
});

/* ---- 5. recommender runOnce: a held stuck agent is not convened at all ---- */

const STUCK = (because) => ({ state: 'needs_you', because, project: 'proj-a' });
function stuckBoard(specs) {
  const board = fleet.install(specs.map((s) => fleet.agent(s.name, { state: 'idle' })));
  const key = {};
  for (const s of specs) {
    const card = board.agents.find((c) => c.sessionName === s.name) || board.agents.find((c) => (c.sessionName || '').startsWith(s.name));
    key[s.name] = card ? card.sessionName : s.name;
    if (s.report) assert.equal(selfreport.record(key[s.name], s.report).recorded, true, 'fixture: self-report refused');
  }
  const cards = status.snapshot().agents;
  const restore = () => {
    for (const s of specs) { try { selfreport.record(key[s.name], { state: 'working', because: 'test over' }); } catch { /* best effort */ } }
    board.restore();
  };
  return { cards, key, restore };
}
function recDeps(heldUntil) {
  const notes = [];
  const sent = [];
  const heldAsked = [];
  return {
    notes, sent, heldAsked,
    deps: {
      roomNote: (pid, t, o) => { notes.push([pid, t, o]); return true; },
      deliver: (s, t) => { sent.push([s, t]); return { state: DELIVERY.PLACED }; },
      DELIVERY,
      heldUntil: (s) => { heldAsked.push(s); return heldUntil(s); },
    },
  };
}

test('#4588 B recommender: a held stuck agent gets no note, no ask, no playbook, no attempt, and its hourly charge back', () => {
  const b = stuckBoard([{ name: 'rechold', report: STUCK('which of two layouts to ship') }, { name: 'recholdpeer' }]);
  try {
    const members = new Map([['proj-a', [b.key.rechold, b.key.recholdpeer]]]);
    const d = recDeps(() => Date.now() + 60e3);
    const seen = recommender.runOnce({ prev: undefined, roster: b.cards, setting: { on: true }, members, now: T0, ...d.deps });
    const out = recommender.runOnce({ prev: seen.next, roster: b.cards, setting: { on: true }, members, now: T0 + recommender.GRACE_MS, ...d.deps });
    assert.deepEqual(d.heldAsked, [b.key.rechold], 'fixture: the item was never convened, so heldUntil was never asked');
    assert.equal(d.notes.length, 0, 'a held stuck agent got a room note');
    assert.equal(d.sent.length, 0, 'a held stuck agent (or its peers) was typed into');
    assert.deepEqual(out.acted.map((a) => a.verdict), ['held']);
    assert.equal(out.next.log.length, 0, 'the fresh item kept its hourly charge');
    const rec = [...out.next.items.values()].find((x) => x.session === b.key.rechold);
    assert.ok(rec, 'the held item was forgotten');
    assert.equal(rec.noted, false, 'a held item was marked noted');
    assert.equal(rec.attempts, 0, 'a held item counted an attempt');
    // After the reset (heldUntil null) the same item is convened normally on the next tick.
    const free = recDeps(() => null);
    const later = recommender.runOnce({ prev: out.next, roster: b.cards, setting: { on: true }, members, now: T0 + recommender.GRACE_MS + 60e3, ...free.deps });
    assert.equal(free.notes.length, 1, 'the item held earlier was never convened after the reset');
    assert.equal(later.acted[0].verdict, DELIVERY.PLACED);
  } finally { b.restore(); }
});

test('#4588 B recommender CONTROL: heldUntil returning null convenes normally and charges the hour', () => {
  const b = stuckBoard([{ name: 'recctl', report: STUCK('which of two layouts to ship') }, { name: 'recctlpeer' }]);
  try {
    const members = new Map([['proj-a', [b.key.recctl, b.key.recctlpeer]]]);
    const d = recDeps(() => null);
    const seen = recommender.runOnce({ prev: undefined, roster: b.cards, setting: { on: true }, members, now: T0, ...d.deps });
    const out = recommender.runOnce({ prev: seen.next, roster: b.cards, setting: { on: true }, members, now: T0 + recommender.GRACE_MS, ...d.deps });
    assert.equal(d.notes.length, 1, 'CONTROL: no room note');
    assert.deepEqual(d.sent.map((x) => x[0]), [b.key.recctlpeer, b.key.recctl], 'CONTROL: the ask then the playbook');
    assert.equal(out.acted[0].verdict, DELIVERY.PLACED);
    assert.equal(out.next.log.length, 1, 'CONTROL: a convened item charges the hour');
  } finally { b.restore(); }
});

test('#4588 B recommender: a held RETRY sends no playbook and counts no attempt', () => {
  const b = stuckBoard([{ name: 'recretry', report: STUCK('which of two layouts to ship') }]);
  try {
    const members = new Map([['proj-a', [b.key.recretry]]]);
    // First convening: the playbook reaches nothing, so the item is due a retry.
    const lost = { roomNote: () => true, deliver: () => ({ state: DELIVERY.COULD_NOT }), DELIVERY, heldUntil: () => null };
    const seen = recommender.runOnce({ prev: undefined, roster: b.cards, setting: { on: true }, members, now: T0, ...lost });
    const first = recommender.runOnce({ prev: seen.next, roster: b.cards, setting: { on: true }, members, now: T0 + recommender.GRACE_MS, ...lost });
    const rec0 = [...first.next.items.values()][0];
    assert.equal(rec0.attempts, 1, 'fixture: the first playbook was not counted');
    const d = recDeps(() => Date.now() + 60e3);
    const retry = recommender.runOnce({ prev: first.next, roster: b.cards, setting: { on: true }, members, now: T0 + recommender.GRACE_MS + 60e3, ...d.deps });
    assert.deepEqual(retry.acted.map((a) => [a.retry, a.verdict]), [[true, 'held']]);
    assert.equal(d.sent.length, 0, 'a held retry typed the playbook');
    assert.equal([...retry.next.items.values()][0].attempts, 1, 'a held retry counted an attempt');
  } finally { b.restore(); }
});

/* ---- 6. messages.sweepUnanswered: a held nudge writes no row ---- */

function seedUnanswered(to) {
  fs.rmSync(messages.LOG, { force: true });
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  const row = { kind: 'post', id: 'm4588', from: 'you', operator: true, project: 'agyhold-room', to: [to],
    text: '@' + to + ' are we set?', mentioned: [to], outcomes: { [to]: DELIVERY.PLACED }, at: new Date(Date.now() - 60e3).toISOString() };
  fs.appendFileSync(messages.LOG, JSON.stringify(row) + '\n');
}
function withStubbedAutomatic(result, fn) {
  const real = chat.deliverAutomatic;
  const realDeliver = chat.deliver;
  const calls = [];
  chat.deliverAutomatic = (name, line, roster) => { calls.push({ name, line, roster }); return result(); };
  chat.deliver = () => { throw new Error('sweepUnanswered must not call chat.deliver (a timer line is automatic)'); };
  try { return fn(calls); } finally { chat.deliverAutomatic = real; chat.deliver = realDeliver; }
}
const nudgeRows = () => messages.record().rows.filter((m) => m.kind === 'nudge');

test('#4588 B sweepUnanswered: a held nudge writes no row, so the pair\'s one nudge is still unspent; CONTROL: a plain result writes one', () => {
  assert.ok(path.resolve(messages.LOG).startsWith(path.resolve(SANDBOX) + path.sep), 'the message log must be in the sandbox: ' + messages.LOG);
  const to = 'agyholdmara';
  // A hand-built roster row: the stub below answers for chat, so nothing reads it past `target`.
  const roster = [{ sessionName: to, target: 'kt-agyhold-nonexistent:9.9' }];
  messages.setUnansweredAfterForTests(0);
  try {
    seedUnanswered(to);
    assert.deepEqual(messages.unanswered('agyhold-room', Date.now()), { m4588: [to] }, 'fixture: the ask does not read unanswered');
    const held = withStubbedAutomatic(HELD, (calls) => {
      const r = messages.sweepUnanswered(roster, Date.now());
      assert.equal(calls.length, 1, 'fixture: the nudge was not attempted');
      return r;
    });
    assert.equal(held.ok, true);
    assert.deepEqual(held.nudged, [], 'a held nudge was reported as nudged');
    assert.equal(nudgeRows().length, 0, 'a held nudge spent the pair\'s at-most-once row');
    // Unspent: the next sweep, no longer held, still nudges once and records it.
    const after = withStubbedAutomatic(REFUSED, (calls) => { const r = messages.sweepUnanswered(roster, Date.now()); assert.equal(calls.length, 1); return r; });
    assert.deepEqual(after.nudged.map((n) => n.to), [to]);
    assert.equal(nudgeRows().length, 1, 'CONTROL: a non-held result writes the row');
    assert.equal(nudgeRows()[0].outcome, DELIVERY.COULD_NOT);
    // And then it is spent: a third sweep does not call the delivery at all.
    withStubbedAutomatic(REFUSED, (calls) => { messages.sweepUnanswered(roster, Date.now()); assert.equal(calls.length, 0, 'the at-most-once did not hold'); });
  } finally {
    messages.setUnansweredAfterForTests(null);
    fs.rmSync(messages.LOG, { force: true });
  }
});

/* ---- projects.speakOfMembership: only { automatic: true } goes through deliverAutomatic ---- */

test('#4588 B speakOfMembership: { automatic: true } uses deliverAutomatic; the default uses deliver (a person\'s action is never held)', () => {
  const real = { d: chat.deliver, a: chat.deliverAutomatic };
  const seen = [];
  chat.deliver = () => { seen.push('deliver'); return { state: DELIVERY.PLACED }; };
  chat.deliverAutomatic = () => { seen.push('automatic'); return HELD(); };
  try {
    const project = { id: 'p1', name: 'P' };
    const auto = projects.speakOfMembership('someone', project, 'listed', [], { automatic: true });
    assert.equal(auto.held, true);
    const plain = projects.speakOfMembership('someone', project, 'listed', []);
    assert.equal(plain.state, DELIVERY.PLACED);
    const explicitFalse = projects.speakOfMembership('someone', project, 'listed', [], { automatic: false });
    assert.equal(explicitFalse.state, DELIVERY.PLACED);
    assert.deepEqual(seen, ['automatic', 'deliver', 'deliver']);
  } finally { chat.deliver = real.d; chat.deliverAutomatic = real.a; }
});
