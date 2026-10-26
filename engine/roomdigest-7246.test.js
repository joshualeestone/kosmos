'use strict';
/**
 * #7246: in a big project, room posts that do not name a member stop waking it at every turn end. The turn-end line
 * started a turn, which ended in another idle report that flushed whatever arrived meanwhile, so a busy room kept its
 * idle members going all day. A project's mode: 'each' (as before), 'digest' (at most one line an hour; the turn end
 * tells only what asks something), 'named' (never pushed). Above BIG_ROOM members the default is 'digest'.
 *
 *   node --test engine/roomdigest-7246.test.js
 */
const os = require('node:os');
const path = require('node:path');
const SANDBOX = path.join(os.tmpdir(), 'kosmos-roomdigest-7246-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
delete process.env.AGENT_WORKFORCE_ROOM_HOLD_OFF;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const roomhold = require('./roomhold');
const fleet = require('../test-support/fleet');

process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const D = { PLACED: 'placed', COULD_NOT: 'could_not' };
const T0 = Date.parse('2026-10-26T20:00:00Z');
const MIN = 60 * 1000;
function harness() {
  const typed = [];
  const deliver = async (name, text) => { typed.push({ name, text }); return { state: D.PLACED }; };
  return { typed, deliver };
}
const flush = (name, deliver, mode, now) => roomhold.flushOnIdle(name, { deliver, roster: [], shownOf: () => 'Big Room', DELIVERY: D, modeOf: () => mode, now });

test('#7246 noticeMode: a project\'s own setting wins; otherwise more than BIG_ROOM members is a digest', () => {
  const members = (n) => Array.from({ length: n }, (_, i) => 'a' + i);
  assert.equal(roomhold.noticeMode({ agents: members(roomhold.BIG_ROOM) }), 'each', 'a room at the threshold changed');
  assert.equal(roomhold.noticeMode({ agents: members(roomhold.BIG_ROOM + 1) }), 'digest');
  assert.equal(roomhold.noticeMode({ agents: members(35), roomNotices: 'each' }), 'each', 'the project\'s own setting did not win');
  assert.equal(roomhold.noticeMode({ agents: members(3), roomNotices: 'named' }), 'named');
  assert.equal(roomhold.noticeMode({ agents: members(35), roomNotices: 'loud' }), 'digest', 'an unknown setting was taken');
  assert.equal(roomhold.noticeMode(null), 'each', 'an unreadable project changed behaviour');
  assert.ok(roomhold.DIGEST_MS < require('./messages').HELD_TELL_MAX_MS, 'a digest longer than the stale window would drop everything and say nothing');
});

test('#7246 CONTROL: an \'each\' room tells held posts at the turn end, as before', async () => {
  const { typed, deliver } = harness();
  roomhold.hold('ida', 'small', 'm1');
  await flush('ida', deliver, 'each', T0);
  assert.equal(typed.length, 1);
  assert.match(typed[0].text, /^\[Since you last heard from this room, 1 room post not addressed to you/);
});

test('#7246 digest: the first is told at once as a digest, then nothing for an hour, then the next', async () => {
  const { typed, deliver } = harness();
  roomhold.hold('bo', 'big', 'm1');
  await flush('bo', deliver, 'digest', T0);
  assert.equal(typed.length, 1, 'the first digest was not told');
  assert.match(typed[0].text, /^\[Hourly digest: 1 room post not addressed to you arrived in project Big Room \(m1\)\. Nothing is asked of you, so do not reply or write about them/);
  roomhold.hold('bo', 'big', 'm2');
  roomhold.hold('bo', 'big', 'm3');
  await flush('bo', deliver, 'digest', T0 + 20 * MIN);   // a turn end inside the hour: the chain the card measured
  assert.equal(typed.length, 1, 'a turn end inside the hour woke the member again');
  assert.deepEqual(roomhold.heldIn('bo', 'big').map(roomhold.plainId), ['m2', 'm3'], 'the waiting posts were lost');
  await flush('bo', deliver, 'digest', T0 + 61 * MIN);
  assert.equal(typed.length, 2, 'the next digest did not come after the hour');
  assert.match(typed[1].text, /2 room posts .*\(m2, m3\)/);
  assert.deepEqual(roomhold.heldIn('bo', 'big'), []);
});

test('#7246 digest: a post that asks something is told at the turn end at once; the rest still waits', async () => {
  const { typed, deliver } = harness();
  roomhold.noteDigest('cy', 'big', T0);
  roomhold.hold('cy', 'big', 'm1');
  roomhold.hold('cy', 'big', roomhold.addressedId('m2'));
  await flush('cy', deliver, 'digest', T0 + 5 * MIN);
  assert.equal(typed.length, 1, 'an asked post was held for the digest');
  assert.match(typed[0].text, /1 room post arrived .*\(m2\)\. 1 of them names you/);
  assert.deepEqual(roomhold.heldIn('cy', 'big'), ['m1'], 'the unasked post was told early or lost');
});

test('#7246 named: posts that ask nothing are never pushed at a turn end, however long they wait', async () => {
  const { typed, deliver } = harness();
  roomhold.hold('di', 'quiet', 'm1');
  await flush('di', deliver, 'named', T0);
  await flush('di', deliver, 'named', T0 + 3 * 60 * MIN);
  assert.equal(typed.length, 0);
  assert.deepEqual(roomhold.heldIn('di', 'quiet'), ['m1'], 'the post was dropped instead of kept for the next typed arrival');
});

test('#7246 flushDigests: an idle member gets its due digest; a working one, a non-digest room and an unreachable one do not', async () => {
  const { typed, deliver } = harness();
  for (const who of ['ed', 'fay', 'gus', 'hal']) roomhold.hold(who, 'big', 'm1');
  roomhold.hold('ed', 'small', 'm9');
  const reports = { ed: { found: true, state: 'idle', by: 'auto', at: new Date(T0).toISOString() },
    fay: { found: true, state: 'working', at: new Date(T0 - MIN).toISOString() },
    gus: { found: true, state: 'idle', by: 'auto', at: new Date(T0).toISOString() },
    hal: { found: true, state: 'idle', by: 'auto', at: new Date(T0).toISOString() } };
  roomhold.noteDigest('gus', 'big', T0 - 10 * MIN);   // gus had a digest ten minutes ago
  const board = fleet.install(['ed', 'fay', 'gus', 'hal'].map((n) => fleet.agent(n, { state: 'idle' })));
  const roster = board.agents;
  const done = await roomhold.flushDigests(roster, {
    readReport: (n) => reports[n], now: T0, decayMs: 15 * MIN, deliver, DELIVERY: D, shownOf: () => 'Big Room',
    modeOf: (p) => (p === 'big' ? 'digest' : 'each'), addressable: (n) => ({ ok: n !== 'hal' }),
  }).finally(() => board.restore());
  assert.deepEqual(typed.map((t) => t.name), ['ed'], 'the wrong members were told: ' + typed.map((t) => t.name));
  assert.deepEqual(done.map((d) => [d.name, d.projectId, d.digest]), [['ed', 'big', true]]);
  assert.deepEqual(roomhold.heldIn('ed', 'small'), ['m9'], 'an each-room\'s post was told by the digest sweep');
  assert.deepEqual(roomhold.heldIn('fay', 'big'), ['m1'], 'a working member was told mid-turn');
});

test('#7246 review 1: a cap-marked post (asks nothing) waits for the digest; only an @ post is told at once', async () => {
  const { typed, deliver } = harness();
  roomhold.noteDigest('ivy', 'big', T0);
  roomhold.hold('ivy', 'big', roomhold.cappedId('m1'));
  await flush('ivy', deliver, 'digest', T0 + 5 * MIN);
  assert.equal(typed.length, 0, 'a cap-marked post skipped the digest');
  assert.deepEqual(roomhold.heldIn('ivy', 'big'), [roomhold.cappedId('m1')], 'it was not kept');
});

test('#7246 review 1: a digest the gate refuses is tried again ten minutes later, not every minute', async () => {
  let tries = 0;
  const refuse = async () => { tries += 1; return { state: D.COULD_NOT, held: true }; };
  const board = fleet.install([fleet.agent('jo', { state: 'idle' })]);
  try {
    roomhold.hold('jo', 'big', 'm1');
    const report = { found: true, state: 'idle', by: 'auto', at: new Date(T0).toISOString() };
    const sweep = (at, deliver) => roomhold.flushDigests(board.agents, {
      readReport: () => report, now: at, decayMs: 15 * MIN, deliver, DELIVERY: D, shownOf: () => 'Big Room',
      modeOf: () => 'digest', addressable: () => ({ ok: true }),
    });
    await sweep(T0, refuse);
    assert.equal(tries, 1);
    assert.deepEqual(roomhold.heldIn('jo', 'big'), ['m1'], 'a refused digest lost its post');
    await sweep(T0 + MIN, refuse);
    await sweep(T0 + 9 * MIN, refuse);
    assert.equal(tries, 1, 'a refused digest was retried every minute');
    await sweep(T0 + roomhold.DIGEST_RETRY_MS, refuse);
    assert.equal(tries, 2, 'the refused digest was not retried after the wait');
    const { typed, deliver } = harness();
    await sweep(T0 + 2 * roomhold.DIGEST_RETRY_MS, deliver);
    assert.equal(typed.length, 1, 'CONTROL: once the gate lets it through, the digest is told');
  } finally { board.restore(); }
});
