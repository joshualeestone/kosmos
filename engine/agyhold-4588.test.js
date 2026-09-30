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
// agyquota remembers the latest pool reset it has seen (the release tail); each test starts with none.
test.beforeEach(() => { require('./agyquota').POOL_MEMO.bySession.clear(); require('./agyquota').POOL_MEMO.seen.clear(); });
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

/* ---- 1. notePool (with a fresh memory) / heldForQuota, on real board cards ---- */

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
    assert.equal(agyquota.notePool(b.cards, now, agyquota.newPoolMemo()), Date.parse(until));
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
    assert.equal(agyquota.notePool(b.cards, after, agyquota.newPoolMemo()), null);
    assert.equal(agyquota.heldForQuota(b.s.agyholdb, b.cards, after), null);
    // At the reset instant itself the pool is open again (strictly-after rule).
    assert.equal(agyquota.notePool(b.cards, Date.parse(until), agyquota.newPoolMemo()), null);
    // CONTROL: one millisecond before, it is held.
    assert.equal(agyquota.notePool(b.cards, Date.parse(until) - 1, agyquota.newPoolMemo()), Date.parse(until));
  } finally { b.restore(); }
  const none = agyBoard({});
  try {
    assert.equal(agyquota.notePool(none.cards, Date.now(), agyquota.newPoolMemo()), null);
    assert.equal(agyquota.heldForQuota(none.s.agyholda, none.cards, Date.now()), null);
  } finally { none.restore(); }
});

test('#4588 B notePool: the latest of two resets is returned', () => {
  const early = new Date(Date.now() + 10 * 60e3).toISOString();
  const late = new Date(Date.now() + 40 * 60e3).toISOString();
  const b = agyBoard({ agyholda: late, agyholdb: early });
  try {
    assert.equal(agyquota.notePool(b.cards, Date.now(), agyquota.newPoolMemo()), Date.parse(late));
    // Past the early reset, the late one still holds the pool.
    assert.equal(agyquota.heldForQuota(b.s.agyholdb, b.cards, Date.parse(early) + 1), Date.parse(late));
  } finally { b.restore(); }
  // Order-independence: the same pair written the other way round.
  const c = agyBoard({ agyholda: early, agyholdb: late });
  try { assert.equal(agyquota.notePool(c.cards, Date.now(), agyquota.newPoolMemo()), Date.parse(late)); } finally { c.restore(); }
});

test('#4588 B notePool: garbage in is null, never a throw', () => {
  assert.equal(agyquota.notePool(null, Date.now(), agyquota.newPoolMemo()), null);
  assert.equal(agyquota.notePool([null, { runner: 'antigravity', quotaUntil: 'not a date' }], Date.now(), agyquota.newPoolMemo()), null);
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
    assert.deepEqual(r.results.map((x) => x.act), ['quota-held']);
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
    assert.deepEqual(first.res.results.map((r) => r.act), ['quota-held']);
    assert.equal(first.res.results[0].delivered, false);
    assert.equal(book.size, 0, 'a held nudge wrote the book (spent a try)');
    assert.equal(sent.length, 0, 'a held nudge counted toward the hourly limit');
    // A held verdict is checked before the verdict state: even a (never-produced) placed+held counts nothing.
    const odd = anPass(w, () => ({ ...HELD(), state: DELIVERY.PLACED }), book, sent);
    assert.deepEqual(odd.res.results.map((r) => r.act), ['quota-held']);
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
    agyquota.POOL_MEMO.bySession.clear(); agyquota.POOL_MEMO.seen.clear(); // the held run above recorded the pool's reset (its release)
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

const pausedFor = (r, n, m) => { const x = agyquota.notePool(r, n, m); return x !== null && n < x ? x : null; };
const memoReset = (m) => (m.bySession.size ? Math.max(...m.bySession.values()) : null);

/* ---- review iteration 1: the release tail, one pool for the resume, and chat's own card rule ---- */


test('#4588 B resume: nobody is resumed while ANY antigravity card is still inside its pause; CONTROL: resumed once the pool is open', () => {
  const RESET = '2026-09-28T22:11:54.000Z';
  const AT = Date.parse(RESET);
  const report = { found: true, state: 'idle', by: 'auto', until: RESET, because: status.QUOTA_REPORT_PREFIX + ' Google said: ...' };
  const now = AT + agyquota.GRACE_MS + 1;
  const sent = [];
  const base = [{ sessionName: 'res-a', name: 'A', runner: 'antigravity', state: 'idle' }];
  const other = { sessionName: 'res-b', name: 'B', runner: 'antigravity', state: 'rate_limited', quotaUntil: new Date(now + 60 * 60e3).toISOString() };
  const run = (roster) => agyquota.sweepOnce({ roster, book: new Map(), now, memo: agyquota.newPoolMemo(), readReport: (s) => (s === 'res-a' ? report : { found: false }),
    deliver: (s) => { sent.push(s); return { state: DELIVERY.PLACED }; }, DELIVERY });
  const held = run(base.concat([other]));
  assert.equal(held.skipped, 'the shared pool is still paused');
  assert.deepEqual(sent, [], 'res-a was resumed into a pool res-b still holds');
  const open = run(base);
  assert.deepEqual(sent, ['res-a'], 'CONTROL: with the pool open res-a is resumed, so the arm above proves the pool check');
  assert.equal(open.skipped, undefined);
});

test('#4588 B heldForQuota finds the card by chat\'s own rule (resolveCard), so a differently cased name is still held; CONTROL: an unknown name is not', () => {
  const now = Date.now();
  const roster = [
    { sessionName: 'CaseAgy', runner: 'antigravity', state: 'rate_limited', quotaUntil: new Date(now + 60e3).toISOString(), isNamedOurs: true },
  ];
  assert.equal(chat.resolveCard(roster, 'caseagy').sessionName, 'CaseAgy', 'fixture: resolveCard is case-insensitive');
  assert.notEqual(agyquota.heldForQuota('caseagy', roster, now, agyquota.newPoolMemo()), null, 'a lower-cased name slipped past the gate');
  assert.equal(agyquota.heldForQuota('nosuchagent', roster, now, agyquota.newPoolMemo()), null, 'CONTROL');
});

/* ---- review iteration 2: per-agent release, a memory that corrects and is bounded, one predicate for the resume ---- */


test('#4588 B memory: a card that corrects its reset lowers it; a reset over MAX_POOL_MS ahead is not believed; CONTROL: a sane one is', () => {
  const now = Date.parse('2026-09-28T20:00:00.000Z');
  const memo = agyquota.newPoolMemo();
  const card = (until) => [{ sessionName: 'mem-a', runner: 'antigravity', state: 'rate_limited', quotaUntil: new Date(until).toISOString() }];
  agyquota.heldForQuota('mem-a', card(now + 5 * 3600e3), now, memo);
  assert.equal(memoReset(memo), now + 5 * 3600e3);
  agyquota.heldForQuota('mem-a', card(now + 30 * 60e3), now, memo);
  assert.equal(memoReset(memo), now + 30 * 60e3, 'a corrected (earlier) reset did not lower the memory');
  const far = agyquota.newPoolMemo();
  assert.equal(agyquota.heldForQuota('mem-a', card(now + agyquota.MAX_POOL_MS + 60e3), now, far), null, 'a reset beyond MAX_POOL_MS held the pool');
  assert.equal(far.bySession.size, 0);
  assert.notEqual(agyquota.heldForQuota('mem-a', card(now + agyquota.MAX_POOL_MS - 60e3), now, agyquota.newPoolMemo()), null, 'CONTROL: a week-long pause is held');
});

test('#4588 B resume and senders agree: a card that stops showing its pause before the reset still holds the resume; CONTROL: resumed after the reset', () => {
  const RESET = '2026-09-28T22:11:54.000Z';
  const AT = Date.parse(RESET);
  const memo = agyquota.newPoolMemo();
  const report = { found: true, state: 'idle', by: 'auto', until: RESET, because: status.QUOTA_REPORT_PREFIX + ' Google said: ...' };
  const b = (quotaUntil, state) => ({ sessionName: 'agr-b', name: 'B', runner: 'antigravity', state, quotaUntil });
  const a = { sessionName: 'agr-a', name: 'A', runner: 'antigravity', state: 'idle' };
  const later = AT + 3600e3;
  const sent = [];
  const run = (roster, now) => agyquota.sweepOnce({ roster, book: new Map(), now, memo, readReport: (s) => (s === 'agr-a' ? report : { found: false }),
    deliver: (s) => { sent.push(s); return { state: DELIVERY.PLACED }; }, DELIVERY });
  run([a, b(new Date(later).toISOString(), 'rate_limited')], AT + agyquota.GRACE_MS + 1); // the board sees B paused until `later`
  // B's screen changed: it no longer shows the pause, but the pool is still empty until `later`.
  const r = run([a, b(null, 'needs_you')], AT + agyquota.GRACE_MS + 2);
  assert.equal(r.skipped, 'the shared pool is still paused');
  assert.notEqual(agyquota.heldForQuota('agr-a', [a, b(null, 'needs_you')], AT + agyquota.GRACE_MS + 2, memo), null, 'the senders agree');
  assert.deepEqual(sent, [], 'agr-a was resumed into a pool still empty until B\'s reset');
  const early = agyquota.sweepOnce({ roster: [a, b(null, 'needs_you')], book: new Map(), now: later + 1, memo, readReport: () => report,
    deliver: (s) => { sent.push(s); return { state: DELIVERY.PLACED }; }, DELIVERY });
  assert.equal(early.skipped, 'the shared pool has just refilled', 'an agent whose own reset came earlier still waits the grace after the pool refills');
  const ok = agyquota.sweepOnce({ roster: [a, b(null, 'needs_you')], book: new Map(), now: later + agyquota.GRACE_MS, memo, readReport: () => ({ ...report, until: new Date(later - agyquota.GRACE_MS - 1).toISOString() }),
    deliver: (s) => { sent.push(s); return { state: DELIVERY.PLACED }; }, DELIVERY });
  assert.equal(ok.skipped, undefined, 'CONTROL: after the remembered reset the resume runs');
});

/* ---- review iteration 3: a disappearance is not a correction; the resume and the senders never share a slot ---- */

test('#4588 B memory by session: a later card that STOPS showing its pause still holds the pool to its reset; CONTROL: one that CORRECTS its reset moves it', () => {
  const now = Date.parse('2026-09-28T20:00:00.000Z');
  const A = now + 30 * 60e3; const B = now + 60 * 60e3;
  const memo = agyquota.newPoolMemo();
  const card = (s, until, state) => ({ sessionName: s, runner: 'antigravity', state, quotaUntil: until === null ? null : new Date(until).toISOString() });
  agyquota.notePool([card('mb-a', A, 'rate_limited'), card('mb-b', B, 'rate_limited')], now, memo);
  // B's screen changed (a question is up, no turn has run): it no longer shows the pause. A still does.
  assert.equal(pausedFor([card('mb-a', A, 'rate_limited'), card('mb-b', null, 'needs_you')], now + 60e3, memo), B,
    'the pool reopened at A\'s reset although B\'s pause stands');
  const fixMemo = agyquota.newPoolMemo();
  agyquota.notePool([card('mb-a', A, 'rate_limited'), card('mb-b', B, 'rate_limited')], now, fixMemo);
  assert.equal(pausedFor([card('mb-a', A, 'rate_limited'), card('mb-b', now + 40 * 60e3, 'rate_limited')], now + 60e3, fixMemo), now + 40 * 60e3,
    'CONTROL: B corrected its own reset, and the pool follows it');
});

/* ---- review iteration 5: a per-agent release that waits on nothing, a pool that can be seen serving, held peers left out ---- */

const RS = Date.parse('2026-09-28T22:11:54.000Z');
const rsRoster = (paused) => ['rs-a', 'rs-b', 'rs-c'].map((s) => ({ sessionName: s, name: s, runner: 'antigravity', state: s === paused ? 'rate_limited' : 'idle',
  quotaUntil: s === paused ? new Date(RS).toISOString() : null })).concat([{ sessionName: 'rs-x', runner: 'claude', state: 'idle' }]);

test('#4588 B release: after the reset agent i (by name) comes back at reset + GRACE_MS + (i+1) * SLOT_MS; CONTROL: a claude card is never held', () => {
  const memo = agyquota.newPoolMemo();
  agyquota.notePool(rsRoster('rs-a'), RS - 1, memo);
  const after = rsRoster(null);
  assert.deepEqual(['rs-a', 'rs-b', 'rs-c'].map((s) => agyquota.heldForQuota(s, after, RS, memo)), [1, 2, 3].map((k) => RS + agyquota.GRACE_MS + agyquota.SLOT_MS * k));
  assert.equal(agyquota.heldForQuota('rs-a', after, RS + agyquota.GRACE_MS + agyquota.SLOT_MS, memo), null, 'rs-a is free at its step');
  assert.notEqual(agyquota.heldForQuota('rs-c', after, RS + agyquota.GRACE_MS + agyquota.SLOT_MS, memo), null, 'rs-c is still held then');
  assert.equal(agyquota.heldForQuota('rs-x', after, RS, memo), null, 'CONTROL');
  assert.equal(agyquota.heldForQuota('rs-c', after, RS + agyquota.GRACE_MS + agyquota.SLOT_MS * 3, memo), null, 'the last one is free at its step');
  assert.equal(memo.bySession.size, 1, 'fixture: the entry is still remembered inside its release');
  // Kept past the release (the resume's age window counts from the pool's reset), but it holds nobody then.
  agyquota.notePool(after, RS + agyquota.GRACE_MS + agyquota.SLOT_MS * 4, memo);
  assert.equal(memo.bySession.size, 1, 'the entry was dropped before the resume\'s six-hour window');
  assert.equal(agyquota.heldForQuota('rs-c', after, RS + agyquota.GRACE_MS + agyquota.SLOT_MS * 4, memo), null, 'a kept entry held an agent past its step');
  agyquota.notePool(after, RS + 2 * agyquota.MAX_AGE_MS - 1, memo);
  assert.equal(memo.bySession.size, 1, 'the entry was dropped before its constant horizon');
  agyquota.notePool(after, RS + 2 * agyquota.MAX_AGE_MS, memo);
  assert.equal(memo.bySession.size, 0, 'an entry is dropped 2 * MAX_AGE_MS after its reset');
});

test('#4588 B an agent whose report says a reset 30 days away holds nobody (the 8-day rule); CONTROL: a sane reset does', () => {
  const now = Date.parse('2026-09-28T20:00:00.000Z');
  const memo = agyquota.newPoolMemo();
  const roster = [
    { sessionName: 'far-a', runner: 'antigravity', state: 'idle' },
    { sessionName: 'far-b', runner: 'antigravity', state: 'rate_limited', quotaUntil: new Date(now + 30 * 24 * 3600e3).toISOString() },
  ];
  assert.equal(agyquota.heldForQuota('far-a', roster, now, memo), null, 'a 30-day reset held the pool');
  assert.equal(agyquota.heldForQuota('far-a', [roster[0], { ...roster[1], quotaUntil: new Date(now + 3600e3).toISOString() }], now, memo), now + 3600e3, 'CONTROL');
});

test('#4588 B the first resumed agent reading WORKING does not release everyone: the stagger stands; nor does a working card during the pause', () => {
  const memo = agyquota.newPoolMemo();
  agyquota.notePool(rsRoster('rs-a'), RS - 1, memo);
  const resumed = rsRoster(null).map((c) => (c.sessionName === 'rs-a' ? { ...c, state: 'working' } : c));
  const at = RS + agyquota.GRACE_MS + agyquota.SLOT_MS + 1; // rs-a's step has passed; rs-b and rs-c have not
  assert.notEqual(agyquota.heldForQuota('rs-b', resumed, at, memo), null, 'rs-a working released rs-b early');
  assert.notEqual(agyquota.heldForQuota('rs-c', resumed, at, memo), null, 'rs-a working released rs-c early');
  const during = agyquota.newPoolMemo();
  const until = RS + 3600e3;
  const pausedB = rsRoster(null).map((c) => (c.sessionName === 'rs-b' ? { ...c, state: 'rate_limited', quotaUntil: new Date(until).toISOString() } : c));
  agyquota.notePool(pausedB, RS, during);
  const bQuiet = rsRoster(null).map((c) => (c.sessionName === 'rs-a' ? { ...c, state: 'working' } : c)); // B no longer shows it; A has a turn in flight
  assert.equal(agyquota.heldForQuota('rs-c', bQuiet, RS + 60e3, during), until, 'a working card during the pause dropped the remembered reset');
});

test('#4588 B a pane on this machine that is not ours (isNamedOurs false) is not in the pool; CONTROL: the same card as ours is', () => {
  const now = Date.parse('2026-09-28T20:00:00.000Z');
  const until = now + 3600e3;
  const ours = { sessionName: 'own-a', runner: 'antigravity', state: 'idle', isNamedOurs: true };
  const stranger = { sessionName: 'strange-b', runner: 'antigravity', state: 'rate_limited', quotaUntil: new Date(until).toISOString(), isNamedOurs: false };
  assert.equal(agyquota.heldForQuota('own-a', [ours, stranger], now, agyquota.newPoolMemo()), null, 'a stranger\'s pause held our agent');
  assert.equal(agyquota.heldForQuota('own-a', [ours, { ...stranger, isNamedOurs: true }], now, agyquota.newPoolMemo()), until, 'CONTROL');
});

test('#4588 B recommender: a held PEER is left out of the asks but the item convenes; CONTROL: an unheld peer is asked', () => {
  const b = stuckBoard([{ name: 'recpeerheld', report: STUCK('which of two layouts to ship') }, { name: 'recpeerheldpeer' }]);
  try {
    const members = new Map([['proj-a', [b.key.recpeerheld, b.key.recpeerheldpeer]]]);
    const d = recDeps((s) => (s === b.key.recpeerheldpeer ? Date.now() + 60e3 : null));
    const seen = recommender.runOnce({ prev: undefined, roster: b.cards, setting: { on: true }, members, now: T0, ...d.deps });
    const out = recommender.runOnce({ prev: seen.next, roster: b.cards, setting: { on: true }, members, now: T0 + recommender.GRACE_MS, ...d.deps });
    assert.ok(d.heldAsked.includes(b.key.recpeerheldpeer), 'fixture: the peer was never asked about');
    assert.equal(d.sent.some(([s]) => s === b.key.recpeerheldpeer), false, 'a held peer was typed into');
    assert.equal(d.notes.length, 1, 'the item did not convene: a stuck agent was kept waiting on a peer\'s Google pause');
    assert.notEqual(out.acted[0].verdict, 'held');
    const free = recDeps(() => null);
    const seen2 = recommender.runOnce({ prev: undefined, roster: b.cards, setting: { on: true }, members, now: T0 + 3 * 3600e3, ...free.deps });
    recommender.runOnce({ prev: seen2.next, roster: b.cards, setting: { on: true }, members, now: T0 + 3 * 3600e3 + recommender.GRACE_MS, ...free.deps });
    assert.ok(free.sent.some(([s]) => s === b.key.recpeerheldpeer), 'CONTROL: an unheld peer is asked');
  } finally { b.restore(); }
});

/* ---- review iteration 7: a resume held back by a later reset is not lost; a held peer is worded as unreachable ---- */

test('#4588 B an agent whose own reset is over six hours before the pool\'s is still resumed once the pool opens; CONTROL: PR A\'s window alone would drop it', () => {
  const A = Date.parse('2026-09-28T10:00:00.000Z');
  const B = A + 7 * 3600e3;
  const memo = agyquota.newPoolMemo();
  const reportA = { found: true, state: 'idle', by: 'auto', until: new Date(A).toISOString(), because: status.QUOTA_REPORT_PREFIX + ' Google said: ...' };
  const cards = (bPaused) => [
    { sessionName: 'late-a', name: 'A', runner: 'antigravity', state: 'idle' },
    { sessionName: 'late-b', name: 'B', runner: 'antigravity', state: bPaused ? 'rate_limited' : 'idle', quotaUntil: bPaused ? new Date(B).toISOString() : null },
  ];
  const sent = [];
  const book = new Map();
  agyquota.notePool(cards(true), A - 60e3, memo);
  const sweep = (now, roster) => agyquota.sweepOnce({ roster, book, now, memo, readReport: (s) => (s === 'late-a' ? reportA : { found: false }),
    deliver: (s) => { sent.push(s); return { state: DELIVERY.PLACED }; }, DELIVERY });
  assert.equal(sweep(A + 3600e3, cards(true)).skipped, 'the shared pool is still paused', 'fixture: B holds the pool');
  sweep(B + agyquota.GRACE_MS, cards(false));
  assert.deepEqual(sent, ['late-a'], 'late-a was dropped as more than six hours old although the pool only opened now');
  assert.equal(agyquota.plan(reportA, undefined, B + agyquota.GRACE_MS).act, 'none', 'CONTROL: measured from its own reset alone, it would have been dropped');
});

test('#4588 B recommender: when every peer is held the playbook says they could not be reached (not that nobody else is on the project); CONTROL: a project with no peers says nobody else', () => {
  const b = stuckBoard([{ name: 'recword', report: STUCK('which of two layouts to ship') }, { name: 'recwordpeer' }]);
  try {
    const members = new Map([['proj-a', [b.key.recword, b.key.recwordpeer]]]);
    const d = recDeps((s) => (s === b.key.recwordpeer ? Date.now() + 60e3 : null));
    const seen = recommender.runOnce({ prev: undefined, roster: b.cards, setting: { on: true }, members, now: T0, ...d.deps });
    recommender.runOnce({ prev: seen.next, roster: b.cards, setting: { on: true }, members, now: T0 + recommender.GRACE_MS, ...d.deps });
    const playbook = d.sent.filter(([s]) => s === b.key.recword).map(([, t]) => t).join('\n');
    assert.ok(playbook.includes('could be reached'), 'the playbook did not say the peers could not be reached: ' + playbook.slice(0, 200));
    assert.equal(playbook.includes('No one else is on this project'), false, 'a held peer was worded as not existing');
    assert.equal(d.sent.some(([s]) => s === b.key.recwordpeer), false, 'the held peer was typed into');
  } finally { b.restore(); }
  const solo = stuckBoard([{ name: 'recsolo', report: STUCK('which of two layouts to ship') }]);
  try {
    const members = new Map([['proj-a', [solo.key.recsolo]]]);
    const d = recDeps(() => null);
    const seen = recommender.runOnce({ prev: undefined, roster: solo.cards, setting: { on: true }, members, now: T0, ...d.deps });
    recommender.runOnce({ prev: seen.next, roster: solo.cards, setting: { on: true }, members, now: T0 + recommender.GRACE_MS, ...d.deps });
    assert.ok(d.sent.map(([, t]) => t).join('\n').includes('No one else is on this project'), 'CONTROL: the no-peers wording is reachable');
  } finally { solo.restore(); }
});

/* ---- review iteration 9: only a pause that began inside an agent's own window extends it ---- */

test('#4588 B a pool pause that BEGAN after an agent\'s six hours had closed does not revive its old stop; CONTROL: one seen inside the window does', () => {
  const X = Date.parse('2026-09-26T10:00:00.000Z');             // X's own reset, 50 h before the sweep below
  const Yreset = X + 50 * 3600e3;
  const report = { found: true, state: 'idle', by: 'auto', until: new Date(X).toISOString(), because: status.QUOTA_REPORT_PREFIX + ' Google said: ...' };
  const cardY = (paused) => ({ sessionName: 'hb-y', runner: 'antigravity', state: paused ? 'rate_limited' : 'idle', quotaUntil: paused ? new Date(Yreset).toISOString() : null });
  const late = agyquota.newPoolMemo();
  agyquota.notePool([cardY(true)], Yreset - 10 * 60e3, late);     // Y's pause first seen 10 min before its reset: long after X's window
  assert.equal(agyquota.heldBackBy(X, late), null, 'a pause seen 50 h after X\'s reset was counted as holding X back');
  assert.equal(agyquota.plan(report, undefined, Yreset + agyquota.GRACE_MS + 60e3, agyquota.heldBackBy(X, late)).act, 'none', 'X\'s old stop was revived');
  const early = agyquota.newPoolMemo();
  agyquota.notePool([cardY(true)], X + 3600e3, early);            // CONTROL: the same pause first seen 1 h after X's reset
  assert.equal(agyquota.heldBackBy(X, early), Yreset);
  assert.equal(agyquota.plan(report, undefined, Yreset + agyquota.GRACE_MS + 60e3, agyquota.heldBackBy(X, early)).act, 'nudge', 'CONTROL: held back inside its window, X is resumed');
});

/* ---- review iteration 10: a repeat pause gets its own first-seen time ---- */

test('#4588 B the SAME agent pausing again after its old reset records a fresh first-seen time; CONTROL: a correction of a reset still ahead keeps it', () => {
  const t = Date.parse('2026-09-28T10:00:00.000Z');
  const card = (until) => [{ sessionName: 'rp-a', runner: 'antigravity', state: 'rate_limited', quotaUntil: new Date(until).toISOString() }];
  const memo = agyquota.newPoolMemo();
  agyquota.notePool(card(t + 3600e3), t, memo);                       // pause 1, reset at t+1h
  agyquota.notePool(card(t + 30 * 60e3), t + 10 * 60e3, memo);        // CONTROL: corrected while still ahead
  assert.equal(memo.seen.get('rp-a'), t, 'a correction moved the first-seen time');
  agyquota.notePool(card(t + 5 * 3600e3), t + 3 * 3600e3, memo);      // pause 2, after pause 1's reset has passed
  assert.equal(memo.seen.get('rp-a'), t + 3 * 3600e3, 'a new pause kept the old pause\'s first-seen time');
  // So pause 2 does not count as holding back an agent whose window had closed before it began.
  assert.equal(agyquota.heldBackBy(t - 7 * 3600e3, memo), null, 'a pause that began after X\'s window closed extended it');
});
