'use strict';
/**
 * #4926: a held room post that asks nothing of the member and has gone stale (older than messages.HELD_TELL_MAX_MS, or
 * the room's loop guard stopped the conversation after it) is dropped at the flush instead of told: telling it is a wake
 * into an idle agent, which then answers it, hours after the person asked the room for quiet. A held post that names
 * the member and asks for an answer is always told.
 *
 *   node --test engine/roomhold-stale-4926.test.js
 */
const os = require('node:os');
const path = require('node:path');
const SANDBOX = path.join(os.tmpdir(), 'kosmos-roomhold-stale-4926-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
delete process.env.AGENT_WORKFORCE_ROOM_HOLD_OFF;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const messages = require('./messages');
const roomhold = require('./roomhold');

process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const NOW = Date.parse('2026-10-01T22:00:00Z');
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const post = (id, min, project = 'p1') => ({ kind: 'post', id, project, from: 'ann', to: ['kim'], text: 'x', at: ago(min) });
const valve = (min, stopped = true, project = 'p1') => ({ kind: 'valve', from: 'ann', to: project, project, at: ago(min), because: 'loop', stopped });

test('#4926 staleHeld: older than HELD_TELL_MAX_MS, or the loop guard stopped the room after it; nothing else', () => {
  const maxMin = messages.HELD_TELL_MAX_MS / 60000;
  const log = [post('m1', maxMin + 5), post('m2', 30), post('m3', 10), post('m9', 30, 'p2'), valve(20), valve(5, false), valve(1, true, 'p2')];
  const stale = messages.staleHeld('p1', ['m1', 'm2', 'm3', 'm7'], log, NOW);
  assert.ok(stale.has('m1'), 'a post older than the limit was not stale');
  assert.ok(stale.has('m2'), 'a post the loop guard stopped the room after was not stale');
  assert.ok(!stale.has('m3'), 'a post AFTER the stop was stale (the person reopened, or it is new talk)');
  assert.ok(!stale.has('m7'), 'a post not in the record yet (still being delivered) was stale');
  // Age alone (no stop in the room): the old post is stale, one inside the limit is not.
  const aged = messages.staleHeld('p1', ['m1', 'm3'], [post('m1', maxMin + 5), post('m3', maxMin - 5)], NOW);
  assert.ok(aged.has('m1') && !aged.has('m3'), 'age alone did not decide: ' + [...aged]);
  // CONTROL: the same post in a room whose guard was only noted, not stopped (stopped: false), is not stale.
  assert.equal(messages.staleHeld('p1', ['m2'], [post('m2', 30), valve(20, false)], NOW).size, 0, 'a not-stopped valve row made a post stale');
  // Another room's stop does not count here.
  assert.equal(messages.staleHeld('p2', ['m9'], log, NOW).has('m9'), true, 'fixture: p2 was stopped after m9');
  assert.equal(messages.staleHeld('p1', ['m3'], [post('m3', 10), valve(1, true, 'p2')], NOW).size, 0, 'another room\'s stop made a post stale');
});

test('#4926 withoutStale drops a stale UNADDRESSED id and keeps an addressed one; without a judge, nothing is dropped', () => {
  const ids = ['m1', roomhold.addressedId('m2'), 'm3'];
  const judge = () => new Set(['m1', 'm2']);
  assert.deepEqual(roomhold.withoutStale('p1', ids, judge), [roomhold.addressedId('m2'), 'm3'], 'an addressed post was dropped, or a stale one kept');
  assert.deepEqual(roomhold.withoutStale('p1', ids, undefined), ids);
  assert.deepEqual(roomhold.withoutStale('p1', ids, () => { throw new Error('x'); }), ids, 'a judge that throws dropped something');
});

test('#4926 flushOnIdle: only stale posts held -> nothing typed, and they are not kept for later; a fresh one is told alone', async () => {
  const D = { PLACED: 'placed', COULD_NOT: 'could_not' };
  const typed = [];
  const deliver = async (name, text) => { typed.push(text); return { state: D.PLACED }; };
  const judge = (p, ids) => new Set(ids.filter((x) => x === 'm1' || x === 'm2'));
  roomhold.forget('kim');
  roomhold.hold('kim', 'p1', 'm1'); roomhold.hold('kim', 'p1', 'm2');
  let done = await roomhold.flushOnIdle('kim', { deliver, roster: [], shownOf: () => 'Room', DELIVERY: D, stale: judge });
  assert.deepEqual(typed, [], 'a stale post woke the member');
  assert.deepEqual(done, []);
  assert.deepEqual(roomhold.heldIn('kim', 'p1'), [], 'stale posts were kept to be told later');
  roomhold.hold('kim', 'p1', 'm1'); roomhold.hold('kim', 'p1', 'm3');
  done = await roomhold.flushOnIdle('kim', { deliver, roster: [], shownOf: () => 'Room', DELIVERY: D, stale: judge });
  assert.equal(typed.length, 1);
  assert.match(typed[0], /1 room post not addressed to you/, 'the line counted the stale post too: ' + typed[0]);
  assert.match(typed[0], /m3/);
  assert.ok(!/m1/.test(typed[0]), 'the stale post was named');
  // CONTROL: without a judge (the old call), both are told.
  roomhold.hold('kim', 'p1', 'm1'); roomhold.hold('kim', 'p1', 'm3');
  await roomhold.flushOnIdle('kim', { deliver, roster: [], shownOf: () => 'Room', DELIVERY: D });
  assert.match(typed[1], /2 room posts/);
  roomhold.forget('kim');
});

test('#4926 server.js passes the staleness judge to both flushes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  for (const call of ['roomhold.flushOnIdle(who, {', 'roomhold.flushReleased(r, {']) {
    const at = src.indexOf(call);
    assert.notEqual(at, -1, call + ' not found');
    assert.match(src.slice(at, at + 600), /stale: \(p, ids, who2\) => messages\.staleHeld\(p, ids, undefined, undefined, who2\)/, call + ' does not pass the judge with the member');
  }
});

test('#4926 review 1 (Opus): flushReleased (the quota retry) passes the judge on: a stale plain post is not typed', async () => {
  const fleet = require('../test-support/fleet');
  const chat = require('./chat');
  const board = fleet.install([fleet.agent('gem', { state: 'idle' })]);
  try {
    const roster = board.snapshot ? board.snapshot() : board.roster;
    const D = { PLACED: 'placed', COULD_NOT: 'could_not' };
    const typed = [];
    roomhold.forget('gem');
    roomhold.hold('gem', 'p1', roomhold.addressedId('m5'));   // an ask, so the minute retry looks at it at all
    roomhold.hold('gem', 'p1', 'm1'); roomhold.hold('gem', 'p1', 'm3');
    assert.equal(chat.addressable('gem', roster).ok, true, 'fixture: the member cannot be typed into');
    await roomhold.flushReleased(roster, { isAgy: () => true, readReport: () => null, now: Date.now(), decayMs: 60000,
      deliver: async (n, text) => { typed.push(text); return { state: D.PLACED }; }, shownOf: () => 'Room', DELIVERY: D, env: {},
      stale: (p, ids) => new Set(ids.filter((x) => x === 'm1')) });
    assert.equal(typed.length, 1, 'fixture: the retry typed nothing');
    assert.ok(/m3/.test(typed[0]) && /m5/.test(typed[0]), 'a fresh or asked post was left out: ' + typed[0]);
    assert.ok(!/\bm1\b/.test(typed[0]), 'the quota retry told a stale post: ' + typed[0]);
  } finally { roomhold.forget('gem'); board.restore(); chat.resetForTests(); }
});

test('#4926 review 5 (Opus): a post held on the member\'s QUOTA is aged from the pause\'s end, not from the post', () => {
  const maxMin = messages.HELD_TELL_MAX_MS / 60000;
  const row = Object.assign(post('m1', maxMin + 120), { heldUntil: { gem: new Date(NOW - 10 * 60000).toISOString() } });
  assert.equal(messages.staleHeld('p1', ['m1'], [row], NOW, 'gem').size, 0, 'a quota-held post was dropped 10 min after the pause ended');
  assert.ok(messages.staleHeld('p1', ['m1'], [row], NOW, 'kim').has('m1'), 'control: for another member the post\'s own age decides');
  const ended = Object.assign(post('m2', maxMin + 300), { heldUntil: { gem: new Date(NOW - (maxMin + 5) * 60000).toISOString() } });
  assert.ok(messages.staleHeld('p1', ['m2'], [ended], NOW, 'gem').has('m2'), 'a pause that ended long ago kept it fresh');
  const stopped = [Object.assign(post('m3', 30), { heldUntil: { gem: new Date(NOW).toISOString() } }), valve(10)];
  assert.ok(messages.staleHeld('p1', ['m3'], stopped, NOW, 'gem').has('m3'), 'the loop guard no longer applied to a quota hold');
});
