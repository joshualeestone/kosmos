'use strict';
/**
 * kosmos#4926 (the live check on 0.7.96, 11-07): a held post keeps `held` on its row after it is told, so a seat's
 * uncited answer never took it off --unanswered. roomhold now keeps when the member's own room read showed it each held
 * post, and messages.laterOwnPost counts the member's posts made after that moment. This file covers the record, and pins
 * that the two engine paths that tell (the idle flush, a typed arrival) record nothing; the read path is in
 * server.roomread-uncited-4926.test.js.
 */

const os = require('node:os');
const path = require('node:path');

const SANDBOX = path.join(os.tmpdir(), 'kosmos-roomhold-told-4926-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
delete process.env.AGENT_WORKFORCE_ROOM_HOLD_OFF;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const chat = require('./chat');
const messages = require('./messages');
const selfreport = require('./selfreport');
const roomhold = require('./roomhold');
const fleet = require('../test-support/fleet');

const P = 'told-room';

test.beforeEach(() => {
  chat.resetForTests();
  messages.resetForTests();
  require('./roomloop').resetForTests();
  for (const d of [messages.LOG, roomhold.dir(), selfreport.DIR]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* fresh */ } }
});
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('noteTold keeps the earliest time per post, takes marked ids, and ignores what is not a post id', () => {
  assert.equal(roomhold.noteTold('mara', P, [roomhold.addressedId('m5'), 'm6', 'nonsense', 7], 2000), true);
  assert.equal(roomhold.noteTold('mara', P, ['m5', 'm6'], 1000), true);
  assert.equal(roomhold.noteTold('mara', P, ['m5'], 3000), true);
  assert.deepEqual([...roomhold.toldIn('mara', P)].sort(), [['m5', 1000], ['m6', 1000]], 'the earliest telling is when it reached the member');
  // CONTROL: another member and another room have nothing.
  assert.equal(roomhold.toldIn('leo', P).size, 0);
  assert.equal(roomhold.toldIn('mara', 'other').size, 0);
  assert.equal(roomhold.noteTold('mara', '', ['m1'], 1000), false, 'no project, nothing kept');
  assert.equal(roomhold.noteTold('mara', P, ['m1'], NaN), false, 'no time, nothing kept');
});

test('noteTold forgets tellings older than TOLD_KEEP_MS and keeps at most TOLD_MAX per room, the newest', () => {
  const now = Date.UTC(2026, 10, 7, 12);
  roomhold.noteTold('mara', P, ['m1'], now - roomhold.TOLD_KEEP_MS - 1);
  roomhold.noteTold('mara', 'other', ['m2'], now - roomhold.TOLD_KEEP_MS - 1);
  roomhold.noteTold('mara', P, ['m3'], now);
  assert.deepEqual([...roomhold.toldIn('mara', P).keys()], ['m3'], 'an old telling was kept');
  assert.equal(roomhold.toldIn('mara', 'other').size, 0, 'an old telling in another room was kept');
  const many = [];
  for (let k = 0; k < roomhold.TOLD_MAX + 5; k += 1) many.push('m' + (100 + k));
  for (let k = 0; k < many.length; k += 1) roomhold.noteTold('mara', P, [many[k]], now + k);
  const kept = roomhold.toldIn('mara', P);
  assert.equal(kept.size, roomhold.TOLD_MAX);
  assert.equal(kept.has(many[many.length - 1]), true, 'the newest was dropped');
  assert.equal(kept.has('m3'), false, 'the oldest was kept past the cap');
});

test('a member removed, or taken off one room, keeps no tellings there', () => {
  roomhold.noteTold('mara', P, ['m1'], 1000);
  roomhold.noteTold('mara', 'other', ['m2'], 1000);
  roomhold.forgetProject('mara', P);
  assert.equal(roomhold.toldIn('mara', P).size, 0, 'the left room kept its tellings');
  assert.equal(roomhold.toldIn('mara', 'other').size, 1, 'CONTROL: another room lost its tellings');
  roomhold.forget('mara');
  assert.equal(roomhold.toldIn('mara', 'other').size, 0, 'a removed member kept its tellings');
});

/* Only the member's own room read records a telling (server.roomread-uncited-4926.test.js). The idle line and an
   arrival's line name held posts by id and never carry their words, so a member cannot have answered one before it read
   the room, and a post it makes in between must not move the ask off its list (review 1). */
test('the idle flush tells but records no telling: its line names ids, not words', async () => {
  roomhold.hold('mara', P, 'm3');
  const typed = [];
  await roomhold.flushOnIdle('mara', { deliver: async (n, text) => { typed.push(text); return { state: chat.DELIVERY.PLACED }; }, roster: [], DELIVERY: chat.DELIVERY, env: {}, shownOf: () => 'Room' });
  assert.equal(typed.length, 1, 'CONTROL: the flush must really have typed its line');
  assert.ok(typed[0].includes('m3'), typed[0]);
  assert.deepEqual(roomhold.heldIn('mara', P), [], 'CONTROL: the post must have been told');
  assert.equal(roomhold.toldIn('mara', P).size, 0, 'the idle line was counted as the member having read the post');
});

function fakeTmux() {
  return (args) => (args[0] === 'display-message'
    ? { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' }
    : { ran: true, spawnFailed: false, status: 0, out: '', err: '' });
}
function report(name, state) { assert.equal(selfreport.record(name, { state, because: 'test' }).recorded, true); }
const MEMBERS = ['leo', 'mara', 'april'];
const room3 = () => [fleet.agent('leo', { state: 'idle' }), fleet.agent('mara', { state: 'idle' }), fleet.agent('april', { state: 'idle' })];

test('held posts carried on a typed arrival are told but record no telling', () => {
  const board = fleet.install(room3());
  try {
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    chat.setRunner(fakeTmux());
    chat.setDryRun(false);
    report('mara', 'idle');
    roomhold.hold('mara', P, 'm900');
    const sent = messages.sendPost({ fromPane: '%7', project: P, text: '@mara two' }, board.agents, MEMBERS);
    assert.equal(sent.outcomes.mara, chat.DELIVERY.PLACED, 'CONTROL: the arrival must have been typed');
    assert.deepEqual(roomhold.heldIn('mara', P), [], 'CONTROL: the held post must have ridden on it');
    assert.equal(roomhold.toldIn('mara', P).size, 0, 'the arrival line was counted as the member having read the post');
  } finally { board.restore(); }
});

test('laterOwnPost counts a held ask from the moment it was told, and never before', () => {
  const at = (s) => new Date(Date.UTC(2026, 10, 7, 12, 0, s)).toISOString();
  const rows = [
    { id: 'm1', kind: 'post', from: 'poster', at: at(0), outcomes: { a: roomhold.HELD } },
    { id: 'm2', kind: 'post', from: 'a', at: at(10) },
    { id: 'm3', kind: 'post', from: 'a', at: at(30) },
  ];
  const t = (s) => Date.parse(at(s));
  assert.equal(messages.laterOwnPost(rows, 0, 'a'), null, 'CONTROL: a held ask with no telling counts nothing, as before');
  assert.equal(messages.laterOwnPost(rows, 0, 'a', t(5)), 'm2');
  assert.equal(messages.laterOwnPost(rows, 0, 'a', t(20)), 'm3', 'a post made before the telling counted');
  assert.equal(messages.laterOwnPost(rows, 0, 'a', t(30)), null, 'a post in the same millisecond as the telling counted');
  assert.equal(messages.laterOwnPost(rows, 0, 'a', NaN), null);
  // A post with no time it can be placed by is not counted.
  assert.equal(messages.laterOwnPost([rows[0], { id: 'm2', kind: 'post', from: 'a', at: 'soon' }], 0, 'a', t(5)), null);
  // The telling only widens a held ask: a quiet one, or one that could not be typed, still counts nothing.
  for (const o of [roomhold.QUIET, chat.DELIVERY.COULD_NOT]) {
    assert.equal(messages.laterOwnPost([{ ...rows[0], outcomes: { a: o } }, rows[1]], 0, 'a', t(5)), null, o);
  }
  // A reply to its own earlier post carries on that thread, before or after the telling.
  const thread = [rows[0], { id: 'm2', kind: 'post', from: 'a', at: at(2) }, { id: 'm3', kind: 'post', from: 'a', at: at(30), replyTo: 'm2' }];
  assert.equal(messages.laterOwnPost(thread, 0, 'a', t(5)), null, 'a reply to its own pre-telling post counted');
});
