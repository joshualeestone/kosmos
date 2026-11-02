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

test('one pushed stall that recovers is acked once, with the id the push carried', () => {
  const { said, ev } = pushedStalls(['a1']);
  assert.deepEqual(ds.acksDue([], T0 + 41 * MIN), [], 'acked before anything recovered');
  const ends = recover('a1', said, T0 + 50 * MIN);
  assert.equal(ends.length, 1);
  assert.deepEqual(ds.acksDue(ends, T0 + 50 * MIN), [ev.id]);
  assert.deepEqual(ds.acksDue([], T0 + 51 * MIN), [], 'acked twice');
});

test('a push covering several agents is acked only when the last of them recovers', () => {
  const { said, ev } = pushedStalls(['m1', 'm2', 'm3']);
  assert.match(ev.agent, /and 2 more$/, 'precondition: the push named the others');
  assert.deepEqual(ds.acksDue(recover('m1', said, T0 + 45 * MIN), T0 + 45 * MIN), [], 'acked while m2 and m3 were still stalled');
  assert.deepEqual(ds.acksDue(recover('m3', said, T0 + 46 * MIN), T0 + 46 * MIN), [], 'acked while m2 was still stalled');
  assert.deepEqual(ds.acksDue(recover('m2', said, T0 + 47 * MIN), T0 + 47 * MIN), [ev.id]);
});

test('an agent the push covered that is failing again holds the ack until it stops', () => {
  const { said, ev } = pushedStalls(['f1']);
  ds.note('f1', PLACED, T0 + 45 * MIN);
  const ends = ds.endsToSay(said);
  ds.note('f1', FAIL, T0 + 46 * MIN);   // a new streak no push covered: the old push's email is its only warning
  assert.deepEqual(ds.acksDue(ends, T0 + 46 * MIN), [], 'acked while the agent was failing again');
  ds.note('f1', PLACED, T0 + 50 * MIN);   // that streak ends (never said, so it reports no end)
  assert.deepEqual(ds.acksDue([], T0 + 51 * MIN), [ev.id], 'not acked once it stopped failing');
});

test('nothing is acked for a push that never landed, after a restart, or for an agent that never reports an end', () => {
  const failed = pushedStalls(['x1']);
  failed.ev.onResult(false);   // Kosmos+ did not take it (tellStalls' untold)
  assert.deepEqual(ds.acksDue(recover('x1', failed.said, T0 + 50 * MIN), T0 + 50 * MIN), [], 'acked a push that never landed');

  ds.resetForTests();
  const before = pushedStalls(['x2']);
  ds.resetForTests();   // a board restart: nothing in memory
  ds.note('x2', FAIL, T0 + 41 * MIN);
  ds.note('x2', PLACED, T0 + 50 * MIN);
  assert.deepEqual(ds.acksDue(ds.endsToSay(before.said), T0 + 50 * MIN), [], 'acked after a restart');

  ds.resetForTests();
  const reset = pushedStalls(['x3']);
  ds.reset('x3');   // the card speaks for itself now; no end is ever reported
  assert.deepEqual(ds.acksDue(ds.endsToSay(reset.said), T0 + 50 * MIN), [], 'acked an agent that never recovered');

  /* CONTROL: the same shape, recovered, is acked (so the empty answers above are the rules, not a dead function). */
  ds.resetForTests();
  const ok = pushedStalls(['x4']);
  assert.deepEqual(ds.acksDue(recover('x4', ok.said, T0 + 50 * MIN), T0 + 50 * MIN), [ok.ev.id]);
});

test('an open push older than six hours is dropped, not acked', () => {
  const { said } = pushedStalls(['o1']);
  assert.deepEqual(ds.acksDue([], T0 + 40 * MIN + 6 * 60 * MIN), [], 'kept past six hours');
  assert.deepEqual(ds.acksDue(recover('o1', said, T0 + 7 * 60 * MIN), T0 + 7 * 60 * MIN), [], 'acked after it was dropped');
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
