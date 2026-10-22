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

function append(row) {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  fs.appendFileSync(messages.LOG, JSON.stringify(row) + '\n', 'utf8');
}
function seedPost(id, project) {
  append({ kind: 'post', id, project, from: 'you', operator: true, to: [], text: 'can someone do this', outcomes: {}, at: new Date().toISOString() });
}
const claim = (from, of = 'm1', mode = 'claim', members = MEMBERS) => messages.react({ project: 'p', of, from, members, claim: mode });
const holder = (of = 'm1', members) => { const c = messages.claimOf(of, messages.record().rows, members); return c && c.by; };
const reactionRows = () => messages.record().rows.filter((m) => m.kind === 'reaction');

test('the race: the second agent to claim is refused with the first one\'s name; control: with no claim it lands', () => {
  seedPost('m1', 'p');
  const first = claim('ann');
  assert.equal(first.ok, true);
  assert.equal(first.op, 'add');
  const second = claim('bob');
  assert.equal(second.ok, false, 'a second agent claimed a post another agent already holds');
  assert.equal(second.claimedBy, 'ann');
  assert.equal(second.because, 'ann claimed that post just now, so do not post that you are taking it: read the room, and ask ann if you can help');
  assert.equal(holder(), 'ann');

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

test('review 1 #2: a skin-toned 🙋 is stored as the plain one, so --release takes it back and nothing is left over', () => {
  seedPost('m1', 'p');
  const toned = messages.react({ project: 'p', of: 'm1', emoji: HAND_TONE, from: 'ann', members: MEMBERS });
  assert.equal(toned.ok, true);
  assert.equal(toned.emoji, HAND, 'the skin-toned claim was not stored as the plain 🙋');
  assert.equal(claim('ann').op, 'already', 'claiming after a toned claim made a second pill instead of answering already');
  const back = claim('ann', 'm1', 'release');
  assert.equal(back.op, 'remove');
  assert.equal(holder(), null);
  assert.deepEqual(messages.reactionsFor('m1', messages.record().rows), [], 'a 🙋 pill was left on the post after the release');
});

test('review 1 #2: a holder with two 🙋 forms from before this rule stays the holder until both are gone, and one release takes both', () => {
  seedPost('m1', 'p');
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND_TONE, from: 'ann', op: 'add', at: new Date().toISOString() });
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND, from: 'ann', op: 'add', at: new Date().toISOString() });
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND, from: 'ann', op: 'remove', at: new Date().toISOString() });
  assert.equal(holder(), 'ann', 'removing one of two 🙋 forms dropped the holder while the other is still on the post');
  assert.equal(claim('bob').ok, false);
  assert.equal(claim('ann', 'm1', 'release').op, 'remove');
  assert.equal(holder(), null);
  assert.deepEqual(messages.reactionsFor('m1', messages.record().rows), [], 'the toned 🙋 pill survived the release');
});

test('claiming twice keeps the claim; release by a non-holder is refused; release with nothing held is a no-op that exits ok', () => {
  seedPost('m1', 'p');
  assert.equal(claim('ann').op, 'add');
  assert.equal(claim('ann').op, 'already', 'a second claim must not toggle the claim off');
  assert.equal(holder(), 'ann');

  const notMine = claim('bob', 'm1', 'release');
  assert.equal(notMine.ok, false, 'bob gave back a claim that is not his');
  assert.match(notMine.because, /^ann holds that post, not you/);
  assert.equal(holder(), 'ann', 'a refused release changed the claim');

  assert.equal(claim('ann', 'm1', 'release').op, 'remove');
  assert.equal(holder(), null);
  const retried = claim('ann', 'm1', 'release');
  assert.equal(retried.ok, true, 'review 1 #4: a retried release that already landed read as a failure');
  assert.equal(retried.op, 'none');
  assert.equal(claim('bob').op, 'add', 'a released post could not be claimed again');
  assert.equal(holder(), 'bob');
});

test('review 1 #3: "already yours" is said only to the holder; a later 🙋 from before the rule is not the claim', () => {
  seedPost('m1', 'p');
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND, from: 'ann', op: 'add', at: new Date(Date.now() - 120000).toISOString() });
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND, from: 'bob', op: 'add', at: new Date().toISOString() });
  const bob = claim('bob');
  assert.equal(bob.ok, false, 'bob was told the post is his while ann holds it');
  assert.equal(bob.claimedBy, 'ann');
  assert.match(bob.because, /^ann claimed that post 2 minutes ago/);
  assert.equal(claim('ann').op, 'already');
});

test('review 1 #1: a claim whose holder left the room is not a claim', () => {
  seedPost('m1', 'p');
  assert.equal(claim('ann').ok, true);
  const after = ['bob', 'cy'];   // ann is no longer a member
  assert.equal(holder('m1', after), null);
  const bob = claim('bob', 'm1', 'claim', after);
  assert.equal(bob.ok, true, 'a claim by an agent no longer on the project still locked the post');
  assert.equal(bob.op, 'add');
  // CONTROL: with ann still a member, the same call is refused.
  seedPost('m2', 'p');
  assert.equal(claim('ann', 'm2').ok, true);
  assert.equal(claim('bob', 'm2', 'claim', ['ann', 'bob', 'cy']).ok, false);
});

test('review 1 #1: the person takes a claim over with their 🙋, and pressing it again frees the post', () => {
  seedPost('m1', 'p');
  assert.equal(claim('ann').ok, true);
  const took = messages.react({ project: 'p', of: 'm1', emoji: HAND, operator: true });
  assert.equal(took.ok, true, 'the person was refused a 🙋 in their own room');
  assert.deepEqual(took.tookOver, ['ann']);
  assert.equal(holder(), 'you', 'the person pressing 🙋 did not take the claim over');
  const over = claim('bob');
  assert.equal(over.ok, false);
  assert.equal(over.claimedBy, 'you');
  assert.match(over.because, /^the person claimed that post just now, so do not post that you are taking it: read the room, and ask them/);
  const freed = messages.react({ project: 'p', of: 'm1', emoji: HAND, operator: true });
  assert.equal(freed.op, 'remove');
  assert.equal(holder(), null, 'the person pressing 🙋 again did not free the post');
  assert.equal(claim('bob').op, 'add');
});

test('the claim rules keep react\'s other refusals: a non-member, a missing post, a bad mode', () => {
  seedPost('m1', 'p');
  const stranger = messages.react({ project: 'p', of: 'm1', from: 'zed', members: MEMBERS, claim: 'claim' });
  assert.equal(stranger.ok, false);
  assert.match(stranger.because, /not on that project/);
  assert.equal(claim('ann', 'm9').ok, false, 'a claim on a post that does not exist was kept');
  const bad = messages.react({ project: 'p', of: 'm1', from: 'ann', members: MEMBERS, claim: 'grab' });
  assert.equal(bad.ok, false);
  assert.equal(reactionRows().length, 0, 'a refused claim wrote a row');
});

test('claimOf replays: the earliest live claimant holds, a full remove clears that reactor, other posts never leak', () => {
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

test('claimAge says how long ago, in words that still read right days later', () => {
  const now = Date.parse('2026-10-22T23:00:00.000Z');
  const at = (ms) => new Date(now - ms).toISOString();
  assert.equal(messages.claimAge(at(20 * 1000), now), 'just now');
  assert.equal(messages.claimAge(at(60 * 1000), now), '1 minute ago');
  assert.equal(messages.claimAge(at(45 * 60 * 1000), now), '45 minutes ago');
  assert.equal(messages.claimAge(at(3 * 3600 * 1000), now), '3 hours ago');
  assert.equal(messages.claimAge(at(3 * 86400 * 1000), now), '3 days ago');
  assert.equal(messages.claimAge('not a time', now), 'at a time we cannot read');
});
