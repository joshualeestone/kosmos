'use strict';

/**
 * #6946: a request posted in a project room can be CLAIMED (the 🙋 reaction, `kosmos claim`), and the second agent to
 * answer it is refused with the first one's name before it posts that it is taking it.
 *
 * The card's done-line is the race test below and its control: two agents answer one request, and the second sees the
 * first's claim; with no claim to see, the same second call is the one that lands.
 */

const os = require('node:os');
const path = require('node:path');
// Sandbox BEFORE the engine require, as reactions-2255.test.js does (react() appends to the real log otherwise).
process.env.AGENT_WORKFORCE_DATA = path.join(os.tmpdir(), 'kosmos-roomclaim-test-' + process.pid);

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const messages = require('./messages');

const HAND = '\u{1F64B}';
const HAND_TONE = '\u{1F64B}\u{1F3FD}';
const THUMB = '\u{1F44D}';
const MEMBERS = ['ann', 'bob', 'cy'];

function wipeLog() { try { fs.rmSync(messages.LOG, { force: true }); } catch { /* fresh */ } }
test.beforeEach(() => { messages.resetForTests(); wipeLog(); });

function seedPost(id, project) {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  fs.appendFileSync(messages.LOG,
    JSON.stringify({ kind: 'post', id, project, from: 'you', operator: true, to: [], text: 'can someone do this', outcomes: {}, at: new Date().toISOString() }) + '\n', 'utf8');
}
const claim = (from, of = 'm1', mode = 'claim') => messages.react({ project: 'p', of, from, members: MEMBERS, claim: mode });

test('the race: the second agent to claim is refused with the first one\'s name; control: with no claim it lands', () => {
  seedPost('m1', 'p');
  const first = claim('ann');
  assert.equal(first.ok, true);
  assert.equal(first.op, 'add');
  const second = claim('bob');
  assert.equal(second.ok, false, 'a second agent claimed a post another agent already holds');
  assert.equal(second.claimedBy, 'ann');
  assert.match(second.because, /^ann already claimed that post at \d{4}-\d\d-\d\dT/);
  assert.match(second.because, /do not post that you are taking it/);
  assert.deepEqual(messages.claimOf('m1', messages.record().rows) && messages.claimOf('m1', messages.record().rows).by, 'ann');

  // CONTROL: the same call from bob, on a post nobody has claimed, is the one that lands.
  seedPost('m2', 'p');
  const control = claim('bob', 'm2');
  assert.equal(control.ok, true, 'the control could not claim an unclaimed post, so the refusal above proves nothing');
  assert.equal(control.op, 'add');
});

test('a plain 🙋 react is held to the same rule, any skin tone included; other emoji are not', () => {
  seedPost('m1', 'p');
  assert.equal(claim('ann').ok, true);
  const plain = messages.react({ project: 'p', of: 'm1', emoji: HAND, from: 'bob', members: MEMBERS });
  assert.equal(plain.ok, false, 'kosmos react 🙋 went around the claim');
  assert.equal(plain.claimedBy, 'ann');
  const tone = messages.react({ project: 'p', of: 'm1', emoji: HAND_TONE, from: 'cy', members: MEMBERS });
  assert.equal(tone.ok, false, 'a skin-toned 🙋 went around the claim');
  const thumb = messages.react({ project: 'p', of: 'm1', emoji: THUMB, from: 'bob', members: MEMBERS });
  assert.equal(thumb.ok, true, 'an ordinary reaction on a claimed post was refused');
});

test('claiming twice keeps the claim; only --release gives it back, and then someone else can claim', () => {
  seedPost('m1', 'p');
  assert.equal(claim('ann').op, 'add');
  const again = claim('ann');
  assert.equal(again.ok, true);
  assert.equal(again.op, 'already', 'a second claim must not toggle the claim off');
  assert.equal(messages.claimOf('m1', messages.record().rows).by, 'ann');

  const notMine = claim('bob', 'm1', 'release');
  assert.equal(notMine.ok, false, 'bob gave back a claim that is not his');
  assert.equal(messages.claimOf('m1', messages.record().rows).by, 'ann', 'a refused release changed the claim');

  const back = claim('ann', 'm1', 'release');
  assert.equal(back.ok, true);
  assert.equal(back.op, 'remove');
  assert.equal(messages.claimOf('m1', messages.record().rows), null);
  assert.equal(claim('bob').op, 'add', 'a released post could not be claimed again');
  assert.equal(messages.claimOf('m1', messages.record().rows).by, 'bob');
});

test('the person is never refused, and an agent cannot claim over the person', () => {
  seedPost('m1', 'p');
  assert.equal(claim('ann').ok, true);
  const person = messages.react({ project: 'p', of: 'm1', emoji: HAND, operator: true });
  assert.equal(person.ok, true, 'the person was refused a 🙋 in their own room');
  assert.equal(messages.claimOf('m1', messages.record().rows).by, 'ann', 'the earliest live claim stays the holder');

  seedPost('m2', 'p');
  assert.equal(messages.react({ project: 'p', of: 'm2', emoji: HAND, operator: true }).ok, true);
  const over = claim('bob', 'm2');
  assert.equal(over.ok, false);
  assert.equal(over.claimedBy, 'you');
  assert.match(over.because, /^the person already claimed that post/);
});

test('the claim rules keep react\'s other refusals: a non-member, a missing post, a bad mode', () => {
  seedPost('m1', 'p');
  const stranger = messages.react({ project: 'p', of: 'm1', from: 'zed', members: MEMBERS, claim: 'claim' });
  assert.equal(stranger.ok, false);
  assert.match(stranger.because, /not on that project/);
  assert.equal(claim('ann', 'm9').ok, false, 'a claim on a post that does not exist was kept');
  const bad = messages.react({ project: 'p', of: 'm1', from: 'ann', members: MEMBERS, claim: 'grab' });
  assert.equal(bad.ok, false);
  assert.equal(messages.record().rows.filter((m) => m.kind === 'reaction').length, 0, 'a refused claim wrote a row');
});

test('claimOf replays: the earliest live add holds, a remove clears that reactor, other posts never leak', () => {
  const rows = [
    { kind: 'reaction', of: 'm1', emoji: HAND, from: 'ann', op: 'add', at: '2026-10-22T23:00:00.000Z' },
    { kind: 'reaction', of: 'm1', emoji: HAND_TONE, from: 'bob', op: 'add', at: '2026-10-22T23:00:01.000Z' },
    { kind: 'reaction', of: 'm2', emoji: HAND, from: 'cy', op: 'add', at: '2026-10-22T23:00:02.000Z' },
  ];
  assert.deepEqual(messages.claimOf('m1', rows), { by: 'ann', at: '2026-10-22T23:00:00.000Z' });
  rows.push({ kind: 'reaction', of: 'm1', emoji: HAND, from: 'ann', op: 'remove', at: '2026-10-22T23:00:03.000Z' });
  assert.deepEqual(messages.claimOf('m1', rows), { by: 'bob', at: '2026-10-22T23:00:01.000Z' });
  assert.equal(messages.claimOf('m3', rows), null);
  assert.equal(messages.claimOf('m1', [{ kind: 'reaction', of: 'm1', emoji: THUMB, from: 'ann', op: 'add' }]), null,
    'an ordinary reaction is not a claim');
});
