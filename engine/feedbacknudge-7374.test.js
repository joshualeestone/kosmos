'use strict';

/* #7374: the once-a-day ask to write the product-feedback report. Rosters come from test-support/fleet and the REAL
   status snapshot (fixture discipline: no hand-built cards; a role comes from the real instruction file). Only
   `lastWorked` is set on a real card, because it is read from the provider observer, which a test cannot drive.
   deliver is injected, so no real agent is ever typed into; the data root is a sandbox. */

require('../test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'feedbacknudge-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const feedback = require('./feedback');
const nudge = require('./feedbacknudge');
require('../test-support/data-root-sandbox').assertSandboxedDataRoot(SANDBOX, [require('./store').ROOT]);

test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const DELIVERY = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };
const EVENING = new Date(2026, 9, 27, 18, 0, 0);   // local 18:00, past NUDGE_HOUR
const TODAY = feedback.dateKey(EVENING);
const workedAt = new Date(2026, 9, 27, 11, 0, 0).toISOString();
const worked = (c, at = workedAt) => ({ ...c, lastWorked: { at, why: null } });

function roster(specs) {
  return fleet.install(specs.map(([name, opts]) => fleet.agent(name, opts || {}))).agents;
}
/* The roster comes back in the board's order, not the order given, so a card is found by its name. */
const by = (cards, name) => cards.find((c) => c.sessionName.startsWith(name)).sessionName;
/* An asked-record that lives in memory, so tests do not share the sandbox file unless they mean to. */
function memAsked(start = null) {
  let d = start;
  const sets = [];
  return { get: () => d, set: (date, session) => { d = date; sets.push([date, session]); return true; }, sets };
}
function run(cards, extra = {}) {
  const sent = [];
  const out = nudge.sweepOnce({
    roster: cards, book: extra.book || new Map(), now: extra.now || EVENING,
    send: extra.send || (() => ({ on: true, ok: true })), hasReport: extra.hasReport || (() => false),
    asked: extra.asked || memAsked(), deliver: extra.deliver || ((s, t) => { sent.push([s, t]); return { state: DELIVERY.PLACED }; }),
    DELIVERY, log: extra.log,
  });
  return { out, sent };
}

test('asks one idle agent when today has no report, and says what it costs and how to opt out', () => {
  const cards = roster([['mara']]).map((c) => worked(c));
  const { out, sent } = run(cards);
  assert.equal(out.result.act, 'nudge', JSON.stringify(out));
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], cards[0].sessionName);
  assert.match(sent[0][1], /one turn on your person's AI account/);
  assert.match(sent[0][1], /Settings, Automation/);
  assert.match(sent[0][1], /kosmos feedback write/);
});

test('a Project Manager or Director is asked before the first agent on the roster', () => {
  const cards = roster([['abe'], ['pia', { displayName: 'Pia', role: 'Project Manager' }]]).map((c) => worked(c));
  assert.equal(cards.find((c) => c.sessionName.startsWith('pia')).role, 'Project Manager', 'the real instruction file gave the role');
  const { sent } = run(cards);
  assert.equal(sent[0][0], by(cards, 'pia'));
  const dir = roster([['abe'], ['dot', { displayName: 'Dot', role: 'Project Director' }]]).map((c) => worked(c));
  assert.equal(run(dir).sent[0][0], by(dir, 'dot'));
  // Control: with no such role, the first idle card on the roster.
  const plain = roster([['zed'], ['bo']]).map((c) => worked(c));
  assert.equal(run(plain).sent[0][0], plain[0].sessionName);
});

test('a working agent is never interrupted; the idle one is asked instead, or nobody', () => {
  const cards = roster([['pia', { displayName: 'Pia', role: 'Project Manager', state: 'working' }], ['bo']]).map((c) => worked(c));
  assert.equal(run(cards).sent[0][0], by(cards, 'bo'));
  const busy = roster([['pia', { state: 'working' }]]).map((c) => worked(c));
  const r = run(busy);
  assert.equal(r.sent.length, 0);
  assert.equal(r.out.result.because, 'no idle agent to ask');
});

test('nobody is asked when sending is off or its setting is unreadable, or today already has a report', () => {
  const cards = roster([['mara']]).map((c) => worked(c));
  assert.equal(run(cards, { send: () => ({ on: false, ok: true }) }).sent.length, 0);
  assert.equal(run(cards, { send: () => ({ on: false, ok: false }) }).sent.length, 0);
  assert.equal(run(cards, { send: () => { throw new Error('x'); } }).sent.length, 0);
  assert.equal(run(cards, { hasReport: () => true }).sent.length, 0);
  // An unreadable report store asks nobody (a report may be there).
  assert.equal(run(cards, { hasReport: () => { throw new Error('x'); } }).sent.length, 0);
  // Control: the same roster with all gates open is asked.
  assert.equal(run(cards).sent.length, 1);
});

test('not before NUDGE_HOUR, and not on a day no agent worked', () => {
  const cards = roster([['mara']]).map((c) => worked(c));
  const noon = new Date(2026, 9, 27, nudge.NUDGE_HOUR - 1, 59, 0);
  assert.equal(run(cards, { now: noon }).sent.length, 0);
  const yesterday = roster([['mara']]).map((c) => worked(c, new Date(2026, 9, 26, 15, 0, 0).toISOString()));
  assert.equal(run(yesterday).out.result.because, 'no agent worked today');
  const never = roster([['mara']]).map((c) => ({ ...c, lastWorked: { at: null, why: 'not_seen' } }));
  assert.equal(run(never).sent.length, 0);
  // A provider Kosmos cannot see (Antigravity, Muse) does not block the ask.
  const unseen = roster([['mara']]).map((c) => ({ ...c, lastWorked: { at: null, why: 'no_source' } }));
  assert.equal(run(unseen).sent.length, 1);
});

test('once a day: the record stops a second ask, including after a restart', () => {
  const cards = roster([['mara']]).map((c) => worked(c));
  const asked = memAsked();
  const book = new Map();
  assert.equal(run(cards, { asked, book }).sent.length, 1);
  assert.deepEqual(asked.sets, [[TODAY, cards[0].sessionName]]);
  assert.equal(run(cards, { asked, book, now: new Date(2026, 9, 27, 20, 0, 0) }).sent.length, 0);
  // A restart: the in-memory book is gone, the record on disk is not.
  assert.equal(run(cards, { asked, book: new Map() }).sent.length, 0);
  // Control: the next evening is a new day.
  assert.equal(run(cards.map((c) => worked(c, new Date(2026, 9, 28, 9, 0, 0).toISOString())), { asked, book: new Map(), now: new Date(2026, 9, 28, 18, 0, 0) }).sent.length, 1);
});

test('the record on disk is written and read back through the real file', () => {
  const cards = roster([['mara']]).map((c) => worked(c));
  const real = { get: undefined };   // not a reader: sweepOnce falls back to the file
  assert.equal(run(cards, { asked: real }).sent.length, 1);
  const saved = JSON.parse(fs.readFileSync(nudge.askedFile(), 'utf8'));
  assert.deepEqual(saved, { date: TODAY, session: cards[0].sessionName });
  assert.equal(run(cards, { asked: real }).sent.length, 0, 'asked again from the file');
});

test('a delivery that reached nothing is retried up to MAX_TRIES; a hold spends no try', () => {
  const cards = roster([['mara']]).map((c) => worked(c));
  const book = new Map();
  const asked = memAsked();
  let calls = 0;
  const held = () => { calls++; return { state: DELIVERY.COULD_NOT, held: true, heldBy: 'menu' }; };
  for (let i = 0; i < 5; i++) run(cards, { book, asked, deliver: held });
  assert.equal(calls, 5, 'a hold is tried again each tick');
  assert.equal(book.get('day'), undefined, 'a hold spent no try');
  const fail = () => { calls++; return { state: DELIVERY.COULD_NOT }; };
  calls = 0;
  for (let i = 0; i < 5; i++) run(cards, { book, asked, deliver: fail });
  assert.equal(calls, nudge.MAX_TRIES);
  assert.deepEqual(asked.sets, [], 'nothing reached it, so nothing is recorded as asked');
});

test('the tick is inert without live execution and under the operator brake', () => {
  const cards = roster([['mara']]).map((c) => worked(c));
  let sent = 0;
  const deps = (allowed, env) => ({
    allowed: () => allowed, env, roster: () => cards, book: new Map(), now: () => EVENING,
    send: () => ({ on: true, ok: true }), hasReport: () => false, asked: memAsked(),
    deliver: () => { sent++; return { state: DELIVERY.PLACED }; }, DELIVERY,
  });
  assert.equal(nudge.makeTick(deps(false, {}))(), null);
  assert.equal(nudge.makeTick(deps(true, { AGENT_WORKFORCE_FEEDBACK_NUDGE_OFF: '1' }))(), null);
  assert.equal(sent, 0);
  nudge.makeTick(deps(true, {}))();
  assert.equal(sent, 1, 'control: allowed and no brake, it asks');
});

test('the role labels asked first are the real Project Manager and Director labels', () => {
  assert.deepEqual(nudge.firstLabels(), ['Project Manager', 'Project Director']);
});
