'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#7794: a stall pushed to the phone as needs_you is acked to the coordinator (POST /v1/mac/notify-ack) once every
 * agent the push covered recovered, so its deferred 30-minute email does not go out about something already over. One
 * push covers every agent due in that sweep under the first one's id, so the ack waits for all of them, and for none of
 * them to be failing again. Nothing else changes: a push that never landed, a board restart, or an agent that never
 * reports an end leaves the email to go as before.
 *
 *   node --test engine/stallack-7794.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-stallack-7794-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
const state = mk('remote');
for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(state, f), 'x');
const NOTIFY_ID = '11111111-2222-4333-8444-555555555555';
const TOKEN = 'knt1_stallacktest0123456789';
const notifyFile = path.join(state, 'phone-notify.json');
fs.writeFileSync(notifyFile, JSON.stringify({ on: true, notifyId: NOTIFY_ID, token: TOKEN }));
process.env.AGENT_WORKFORCE_TUNNEL_STATE = state;
process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'http://127.0.0.1:9';   // never dialled: a sender is injected
delete process.env.KOSMOS_NO_PHONE_NOTICES;

const test = require('node:test');
const assert = require('node:assert/strict');
const ds = require('./deliverystreak');
const remote = require('./remote');
fs.mkdirSync(path.dirname(remote.FILE), { recursive: true });
fs.writeFileSync(remote.FILE, JSON.stringify({ on: true }));
remote.macRequest = async () => ({ ok: false, notSent: true, because: 'no coordinator in this test' });
const pn = require('./phonenotify');
pn.setAvailableForTests(true);
const posts = [];
pn.setSender((url, headers, body) => { posts.push({ url, headers, body: JSON.parse(body) }); });

/* A real board card from test-support/fleet (fixture-discipline.test.js: never a hand-built one), carrying a stall. */
const fleet = require('../test-support/fleet');
test.after(() => fleet.restore());
const T0 = Date.parse('2026-11-02T10:00:00Z');
const MIN = 60 * 1000;
const SINCE = new Date(T0).toISOString();
const FAIL = { state: 'could_not', inputHeld: true };
const PLACED = { state: 'placed' };
const stalledCard = (session) => ({ ...fleet.install([fleet.agent(session)]).card(session), name: session,
  deliveryStall: { since: SINCE, count: 4, lastWhy: 'input' } });

/* Each named agent has a said streak of four failures from T0, and ONE push at T0 + 40 min covers them all. */
function pushedStalls(names, { answer = true } = {}) {
  const said = new Map();
  for (const n of names) for (let i = 0; i < 4; i += 1) ds.note(n, FAIL, T0 + i * MIN);
  assert.equal(ds.stallsToSay(names, said, { now: T0 + 40 * MIN }).length, names.length, 'precondition: every stall is said');
  const sent = [];
  ds.tellStalls(names.map(stalledCard), { now: T0 + 40 * MIN, send: (ev) => { sent.push(ev); return answer === true; } });
  assert.equal(sent.length, 1, 'precondition: one push covered them all');
  return { said, ev: sent[0] };
}
const recover = (name, said, at) => { ds.note(name, PLACED, at); return ds.endsToSay(said); };

test.beforeEach(() => ds.resetForTests());
/* The push goes out at T0 + 40 min (pushedStalls), so the earliest an ack can go is 25 minutes later. */
const PUSH = T0 + 40 * MIN;
const DUE = PUSH + 25 * MIN;

test('one pushed stall that recovers is acked once, 25 minutes after the push, with the id the push carried', () => {
  const { said, ev } = pushedStalls(['a1']);
  const ends = recover('a1', said, PUSH + 5 * MIN);
  assert.equal(ends.length, 1);
  assert.deepEqual(ds.acksDue(ends, PUSH + 5 * MIN), [], 'acked before the coordinator would read it');
  assert.deepEqual(ds.acksDue([], DUE - MIN), [], 'acked a minute early');
  assert.deepEqual(ds.acksDue([], DUE), [ev.id]);
  assert.deepEqual(ds.acksDue([], DUE + MIN), [], 'acked twice');
});

test('a push covering several agents is acked only when the last of them recovers', () => {
  const { said, ev } = pushedStalls(['m1', 'm2', 'm3']);
  assert.match(ev.agent, /and 2 more$/, 'precondition: the push named the others');
  assert.deepEqual(ds.acksDue(recover('m1', said, PUSH + 5 * MIN), DUE), [], 'acked while m2 and m3 were still stalled');
  assert.deepEqual(ds.acksDue(recover('m3', said, DUE + MIN), DUE + MIN), [], 'acked while m2 was still stalled');
  assert.deepEqual(ds.acksDue(recover('m2', said, DUE + 2 * MIN), DUE + 2 * MIN), [ev.id]);
});

test('an agent that recovers and stalls again before the ack is due keeps its email', () => {
  const { said, ev } = pushedStalls(['f1']);
  const ends = recover('f1', said, PUSH + 5 * MIN);
  assert.deepEqual(ds.acksDue(ends, PUSH + 5 * MIN), [], 'acked before it was due');
  ds.note('f1', FAIL, PUSH + 8 * MIN);   // stalled again: the old push's email is its only warning
  assert.deepEqual(ds.acksDue([], DUE), [], 'acked while the agent was failing again');
  ds.note('f1', PLACED, DUE + 2 * MIN);   // that streak ends (never said, so it reports no end)
  assert.deepEqual(ds.acksDue([], DUE + 3 * MIN), [ev.id], 'not acked once it stopped failing');
});

test('a push whose answer was a failure is still acked once it is over (the coordinator may hold it)', () => {
  const { said, ev } = pushedStalls(['x1']);
  ev.onResult(false);   // Kosmos+ answered badly (tellStalls' untold); it may still have stored the push
  assert.deepEqual(ds.acksDue(recover('x1', said, PUSH + 5 * MIN), DUE), [ev.id]);
});

test('a retry of a failed push joins it, and its clock starts at the retry (the coordinator may hold only the retry)', () => {
  const { said, ev } = pushedStalls(['r1']);
  ev.onResult(false);   // taken back, so r1 is due again
  const again = [];
  ds.tellStalls([stalledCard('r1')], { now: PUSH + 16 * MIN, send: (e) => { again.push(e); return true; } });
  assert.equal(again.length, 1, 'precondition: the push was retried');
  assert.equal(again[0].id, ev.id, 'precondition: the retry carries the same id');
  const ends = recover('r1', said, PUSH + 20 * MIN);
  assert.deepEqual(ds.acksDue(ends, DUE), [], 'acked 25 minutes after the first push, though the coordinator may hold only the retry');
  assert.deepEqual(ds.acksDue([], PUSH + 16 * MIN + 25 * MIN), [ev.id], 'not acked 25 minutes after the retry');
});

test('a retry that leaves out an agent the push covered keeps waiting for that agent', () => {
  const said = new Map();
  for (const n of ['j1', 'j2']) for (let i = 0; i < 4; i += 1) ds.note(n, FAIL, T0 + i * MIN);
  ds.stallsToSay(['j1', 'j2'], said, { now: PUSH });
  const pushes = [];
  const fail = (e) => { pushes.push(e); return true; };
  ds.tellStalls([stalledCard('j2')], { now: PUSH, send: fail });   // j2 alone first, and that answer fails
  pushes[0].onResult(false);                                      // j2 is taken back (its one take-back today)
  ds.tellStalls([stalledCard('j1'), stalledCard('j2')], { now: PUSH + 16 * MIN, send: fail });   // j1 and j2, under j1's id
  pushes[1].onResult(false);                                      // j1 taken back; j2 is not (already taken back today)
  ds.tellStalls([stalledCard('j1'), stalledCard('j2')], { now: PUSH + 32 * MIN, send: fail });   // j1 only now
  assert.equal(pushes.length, 3, 'precondition: three pushes');
  assert.equal(pushes[2].id, pushes[1].id, 'precondition: the retry carries the same id');
  assert.equal(pushes[2].agent, pushes[1].agent.replace(/ and 1 more$/, ''), 'precondition: the retry left j2 out');
  const ends = recover('j1', said, PUSH + 40 * MIN);
  assert.deepEqual(ds.acksDue(ends, PUSH + 32 * MIN + 25 * MIN), [], 'acked while j2, which the push named, was still stalled');
});

test('an end clears an agent only from pushes made before it ended', () => {
  const said = new Map();
  for (let i = 0; i < 4; i += 1) ds.note('e1', FAIL, T0 + i * MIN);
  ds.stallsToSay(['e1'], said, { now: T0 + 40 * MIN });
  const early = recover('e1', said, T0 + 45 * MIN);   // a real end of an EARLIER stall, ended at T0 + 45 min
  assert.equal(early.length, 1, 'precondition: the earlier stall ended');
  const LATER = T0 + 3 * 60 * MIN;
  const SINCE2 = new Date(T0 + 2 * 60 * MIN).toISOString();
  for (let i = 0; i < 4; i += 1) ds.note('e1', FAIL, T0 + 2 * 60 * MIN + i * MIN);
  ds.stallsToSay(['e1'], said, { now: LATER });
  const sent = [];
  ds.tellStalls([{ ...stalledCard('e1'), deliveryStall: { since: SINCE2, count: 4, lastWhy: 'input' } }],
    { now: LATER, send: (ev) => { sent.push(ev); return true; } });
  assert.equal(sent.length, 1, 'precondition: the later stall was pushed');
  ds.note('e1', PLACED, LATER + 5 * MIN);   // it recovers, but its own end is not read yet
  assert.deepEqual(ds.acksDue(early, LATER + 25 * MIN), [], 'an end from before the push cleared it');
});

test('a sender that throws opens nothing', () => {
  const said = new Map();
  for (let i = 0; i < 4; i += 1) ds.note('t1', FAIL, T0 + i * MIN);
  ds.stallsToSay(['t1'], said, { now: PUSH });
  ds.tellStalls([stalledCard('t1')], { now: PUSH, send: () => { throw new Error('a sender that fails'); } });
  assert.deepEqual(ds.acksDue(recover('t1', said, PUSH + 5 * MIN), DUE), [], 'acked a push that was never handed over');
});

test('a push the sender did not take opens nothing', () => {
  const said = new Map();
  for (let i = 0; i < 4; i += 1) ds.note('n1', FAIL, T0 + i * MIN);
  ds.stallsToSay(['n1'], said, { now: PUSH });
  let sent = 0;
  ds.tellStalls([stalledCard('n1')], { now: PUSH, send: () => { sent += 1; return false; } });
  assert.equal(sent, 1, 'precondition: the push was offered');
  assert.deepEqual(ds.acksDue(recover('n1', said, PUSH + 5 * MIN), DUE), [], 'acked a push that was never handed over');
});

test('nothing is acked after a restart, or for an agent that never reports an end', () => {
  pushedStalls(['x2']);
  ds.resetForTests();   // a board restart: nothing in memory
  const said = new Map();
  for (let i = 0; i < 4; i += 1) ds.note('x2', FAIL, T0 + i * MIN);
  assert.equal(ds.stallsToSay(['x2'], said, { now: PUSH }).length, 1, 'precondition: the same stall is said again');
  const ends = recover('x2', said, PUSH + 5 * MIN);
  assert.equal(ends.length, 1, 'precondition: its end is reported, so only the lost push can hold the ack');
  assert.deepEqual(ds.acksDue(ends, DUE), [], 'acked a push made before the restart');

  ds.resetForTests();
  const reset = pushedStalls(['x3']);
  ds.reset('x3');   // the card speaks for itself now; no end is ever reported
  assert.deepEqual(ds.acksDue(ds.endsToSay(reset.said), DUE), [], 'acked an agent that never recovered');

  /* CONTROL: the same shape, recovered, is acked (so the empty answers above are the rules, not a dead function). */
  ds.resetForTests();
  const ok = pushedStalls(['x4']);
  assert.deepEqual(ds.acksDue(recover('x4', ok.said, PUSH + 5 * MIN), DUE), [ok.ev.id]);
});

test('an open push older than an hour is dropped, not acked', () => {
  const { said } = pushedStalls(['o1']);
  assert.deepEqual(ds.acksDue([], PUSH + 60 * MIN), [], 'kept past an hour');
  assert.deepEqual(ds.acksDue(recover('o1', said, PUSH + 61 * MIN), PUSH + 61 * MIN), [], 'acked after it was dropped');
});

test('acked() posts the id, cut as the push cut it, to /v1/mac/notify-ack with the notify token', () => {
  posts.length = 0;
  const long = 'stall:0:' + SINCE + ':' + 's'.repeat(200);
  assert.equal(pn.acked(long), true);
  assert.equal(posts.length, 1);
  const p = posts[0];
  assert.match(p.url, /\/v1\/mac\/notify-ack$/);
  assert.equal(p.headers['x-kosmos-notify-token'], TOKEN);
  assert.deepEqual(Object.keys(p.body).sort(), ['eventId', 'installId']);
  assert.equal(p.body.installId, NOTIFY_ID);
  assert.equal(p.body.eventId, pn.payload(NOTIFY_ID, { kind: 'needs_you', id: long }).id, 'not the id the push sent');
  assert.equal(Buffer.byteLength(p.body.eventId), 120);
});

test('acked() sends nothing with no token, an empty id, or on a computer marked never to send', () => {
  posts.length = 0;
  assert.equal(pn.acked(''), false);
  const mark = path.join(path.dirname(remote.FILE), 'no-phone-notices');
  fs.writeFileSync(mark, '');
  try { assert.equal(pn.acked('stall:0:x:y'), false); } finally { fs.rmSync(mark, { force: true }); }
  const kept = fs.readFileSync(notifyFile, 'utf8');
  fs.writeFileSync(notifyFile, JSON.stringify({ on: true, notifyId: NOTIFY_ID }));
  try { assert.equal(pn.acked('stall:0:x:y'), false); } finally { fs.writeFileSync(notifyFile, kept); }
  const plus = fs.readFileSync(remote.FILE, 'utf8');
  fs.writeFileSync(remote.FILE, JSON.stringify({ on: false }));   // #6488: Kosmos+ switched off on this computer
  try { assert.equal(pn.acked('stall:0:x:y'), false, 'acked with Kosmos+ switched off here'); } finally { fs.writeFileSync(remote.FILE, plus); }
  assert.equal(posts.length, 0);
  /* CONTROL: switched OFF but still holding the token, it acks (an email about something over is still wrong). */
  fs.writeFileSync(notifyFile, JSON.stringify({ on: false, notifyId: NOTIFY_ID, token: TOKEN }));
  try { assert.equal(pn.acked('stall:0:x:y'), true); } finally { fs.writeFileSync(notifyFile, kept); }
  assert.equal(posts.length, 1);
});

test('the board sweep acks what acksDue returns, every minute, through phonenotify.acked', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf('ds.acksDue(stallEnds)');
  assert.ok(at > 0, 'server.js no longer asks acksDue');
  assert.match(src.slice(at, at + 120), /phonenotify\.acked\(id\)/);
  const ends = src.indexOf('stallEnds = ds.endsToSay(');
  assert.ok(ends > 0 && ends < at, 'acksDue no longer reads this minute\'s ends');
});
