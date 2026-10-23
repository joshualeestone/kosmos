'use strict';

/**
 * #6946: a request posted in a project room can be CLAIMED (the 🙋 reaction, `kosmos claim`), and the second agent to
 * answer it is refused with the first one's name before it posts that it is taking it.
 *
 * The card's done-line is the race test below and its control: two agents answer one request, and the second sees the
 * first's claim; with no claim to see, the same second call is the one that lands.
 */

require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273)
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

test('round 6: a raised hand written before this rule (no claim mark) is an ordinary reaction, not a claim', () => {
  seedPost('m1', 'p');
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND_TONE, from: 'bob', op: 'add', at: '2026-10-21T00:00:00.000Z' });
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND, from: 'bob', op: 'add', at: '2026-10-21T00:00:00.000Z' });
  assert.equal(holder(), null, 'an old raised hand became a claim of whatever age it is');
  const ann = claim('ann');
  assert.equal(ann.op, 'add', 'an old raised hand locked the post');
  assert.equal(holder(), 'ann');
  // CONTROL: the same old row WITH the mark is a claim.
  seedPost('m2', 'p');
  append({ kind: 'reaction', project: 'p', of: 'm2', emoji: HAND, from: 'bob', op: 'add', claim: true, at: '2026-10-21T00:00:00.000Z' });
  assert.equal(holder('m2'), 'bob');
  assert.equal(claim('ann', 'm2').claimedBy, 'bob');
  assert.ok(reactionRows().filter((m) => m.from === 'ann' && m.of === 'm1' && m.op === 'add').every((m) => m.claim === true),
    'react() did not mark the claim it wrote');
});

test('claiming twice keeps the claim; a release with nothing of yours held is a no-op that names the holder', () => {
  seedPost('m1', 'p');
  assert.equal(claim('ann').op, 'add');
  assert.equal(claim('ann').op, 'already', 'a second claim must not toggle the claim off');
  assert.equal(holder(), 'ann');

  const notMine = claim('bob', 'm1', 'release');
  assert.equal(notMine.ok, true, 'round 2 N3: a release with nothing of yours held is not a failure');
  assert.equal(notMine.op, 'none');
  assert.equal(notMine.claimedBy, 'ann', 'the no-op release did not say who holds the post');
  assert.equal(holder(), 'ann', 'bob\'s release changed ann\'s claim');

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
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND, from: 'ann', op: 'add', claim: true, at: new Date(Date.now() - 120000).toISOString() });
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND, from: 'bob', op: 'add', claim: true, at: new Date().toISOString() });
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

test('round 3: the person\'s 🙋 agrees with a claim and never claims; control: an agent\'s 🙋 does', () => {
  seedPost('m1', 'p');
  assert.equal(claim('ann').ok, true);
  const agree = messages.react({ project: 'p', of: 'm1', emoji: HAND, operator: true });
  assert.equal(agree.ok, true, 'the person was refused a 🙋 in their own room');
  assert.equal(agree.op, 'add');
  assert.equal(holder(), 'ann', 'the person clicking ann\'s 🙋 pill took the post from ann');
  assert.equal(claim('bob').claimedBy, 'ann');
  assert.equal(reactionRows().filter((m) => m.from === 'ann' && m.op === 'remove').length, 0, 'the person\'s click took ann\'s claim back');
  assert.equal(messages.react({ project: 'p', of: 'm1', emoji: HAND, operator: true }).op, 'remove', 'the person\'s second click did not take their own 🙋 back');
  assert.equal(holder(), 'ann');
  // On a post no agent holds, the person's 🙋 holds nothing either: an agent can still claim it.
  seedPost('m2', 'p');
  assert.equal(messages.react({ project: 'p', of: 'm2', emoji: HAND, operator: true }).op, 'add');
  assert.equal(holder('m2'), null, 'the person\'s 🙋 became a claim');
  assert.equal(claim('bob', 'm2').op, 'add');
});

test('round 3: a non-holder\'s release is a no-op that takes their stray 🙋 off and names the holder', () => {
  seedPost('m1', 'p');
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND, from: 'ann', op: 'add', claim: true, at: new Date(Date.now() - 60000).toISOString() });
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND, from: 'bob', op: 'add', claim: true, at: new Date().toISOString() });
  const back = claim('bob', 'm1', 'release');
  assert.equal(back.op, 'none', 'bob was told he gave back a post he never held');
  assert.equal(back.claimedBy, 'ann');
  assert.deepEqual(messages.reactionsFor('m1', messages.record().rows)[0].who, ['ann'], 'bob\'s stray 🙋 was left on the post');
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
    { kind: 'reaction', of: 'm1', emoji: HAND, from: 'ann', op: 'add', claim: true, at: '2026-10-22T23:00:00.000Z' },
    { kind: 'reaction', of: 'm1', emoji: HAND_TONE, from: 'bob', op: 'add', claim: true, at: '2026-10-22T23:00:01.000Z' },
    { kind: 'reaction', of: 'm2', emoji: HAND, from: 'cy', op: 'add', claim: true, at: '2026-10-22T23:00:02.000Z' },
  ];
  assert.deepEqual(messages.claimOf('m1', rows), { by: 'ann', at: '2026-10-22T23:00:00.000Z' });
  rows.push({ kind: 'reaction', of: 'm1', emoji: HAND, from: 'ann', op: 'remove', at: '2026-10-22T23:00:03.000Z' });
  assert.deepEqual(messages.claimOf('m1', rows), { by: 'bob', at: '2026-10-22T23:00:01.000Z' });
  assert.equal(messages.claimOf('m3', rows), null);
  assert.equal(messages.claimOf('m1', [{ kind: 'reaction', of: 'm1', emoji: THUMB, from: 'ann', op: 'add', claim: true }]), null,
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

test('round 2 W2: a claim made while the earlier holder was out of the room survives their return', () => {
  seedPost('m1', 'p');
  assert.equal(claim('ann', 'm1', 'claim', ['ann', 'bob']).op, 'add');
  assert.equal(claim('bob', 'm1', 'claim', ['bob']).op, 'add', 'bob could not claim after ann left');
  const ended = reactionRows().filter((m) => m.from === 'ann' && m.op === 'remove');
  assert.equal(ended.length, 1, 'bob\'s claim did not end the claim of a holder who had left');
  assert.equal(ended[0].takenBy, 'bob', 'the log does not say whose claim ended ann\'s');
  assert.equal(ended[0].because, 'left-the-room');
  // ann is back on the project: bob still holds it.
  assert.equal(holder('m1', ['ann', 'bob']), 'bob', 'ann\'s old claim came back above bob\'s when ann rejoined');
  assert.equal(claim('bob', 'm1', 'claim', ['ann', 'bob']).op, 'already');
  // CONTROL: with ann never gone, bob's claim is refused and ann's claim has no remove row.
  seedPost('m2', 'p');
  assert.equal(claim('ann', 'm2', 'claim', ['ann', 'bob']).op, 'add');
  assert.equal(claim('bob', 'm2', 'claim', ['ann', 'bob']).ok, false);
});

test('round 2 W3: the room\'s view of a claim drops a holder who was removed; control: not removed, they hold it', () => {
  seedPost('m1', 'p');
  assert.equal(claim('ann').ok, true);
  const remove = require('./remove');
  const setRemoved = (names) => { fs.mkdirSync(path.dirname(remove.REMOVED_FILE), { recursive: true });
    fs.writeFileSync(remove.REMOVED_FILE, JSON.stringify(names.map((n) => ({ name: n, stopped: true })))); };
  try {
    setRemoved([]);
    assert.deepEqual(messages.claimOf('m1', messages.record().rows, messages.claimMembers(MEMBERS)) && messages.claimOf('m1', messages.record().rows, messages.claimMembers(MEMBERS)).by, 'ann',
      'CONTROL: a holder who was not removed is not shown as holding the post');
    setRemoved(['ann']);
    assert.equal(messages.claimOf('m1', messages.record().rows, messages.claimMembers(MEMBERS)), null, 'a removed holder still shows as holding the post');
    // Round 2 N1: with no member list at all (the registry could not be read), the post is never shown as free.
    assert.equal(messages.claimOf('m1', messages.record().rows, messages.claimMembers(null)).by, 'ann');
  } finally {
    try { fs.rmSync(remove.REMOVED_FILE, { force: true }); } catch { /* best effort */ }
  }
});

test('only 🙋 forms are a claim (every raised hand a pill can show); 🙋 followed by another emoji is not', () => {
  for (const form of [HAND, HAND_TONE, '\u{1F64B}\u200D\u2640\uFE0F', '\u{1F64B}\u{1F3FB}\u200D\u2642\uFE0F', '\u{1F64B}\uFE0F',
    '\u{1F64B}\uFE0F\u200D\u2640\uFE0F', '\u{1F64B}\uFE0E']) {
    assert.equal(messages.isClaimEmoji(form), true, JSON.stringify(form));
  }
  for (const other of ['\u{1F64B}\u{1F525}', THUMB, '\u{1F64C}', '']) assert.equal(messages.isClaimEmoji(other), false, JSON.stringify(other));
  seedPost('m1', 'p');
  assert.equal(claim('ann').ok, true);
  const two = messages.react({ project: 'p', of: 'm1', emoji: '\u{1F64B}\u{1F525}', from: 'bob', members: MEMBERS });
  assert.equal(two.ok, true, 'a two-emoji reaction starting with 🙋 was treated as a claim');
  assert.equal(two.emoji, '\u{1F64B}\u{1F525}');
});

test('round 5: the holder\'s own plain 🙋 react takes its claim back (a toggle, unlike kosmos claim)', () => {
  seedPost('m1', 'p');
  assert.equal(claim('ann').op, 'add');
  const off = messages.react({ project: 'p', of: 'm1', emoji: HAND, from: 'ann', members: MEMBERS });
  assert.equal(off.op, 'remove', 'the holder\'s own plain 🙋 did not take the claim back');
  assert.equal(holder(), null);
  assert.equal(claim('bob').op, 'add');
});

test('round 7: an old unmarked 🙋 pill can be taken off, by an agent or the person, in any form', () => {
  const pills = (of = 'm1') => messages.reactionsFor(of, messages.record().rows).filter((r) => messages.isClaimEmoji(r.emoji));
  // Case 1: ann's old plain 🙋, nobody holds the post; her plain toggle takes it off, it does not claim.
  seedPost('m1', 'p');
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND, from: 'ann', op: 'add', at: '2026-10-21T00:00:00.000Z' });
  const off = messages.react({ project: 'p', of: 'm1', emoji: HAND, from: 'ann', members: MEMBERS });
  assert.equal(off.op, 'remove', 'ann\'s toggle on her old 🙋 claimed the post instead of taking it off');
  assert.deepEqual(pills(), []);
  assert.equal(holder(), null);
  // Case 2: ann's old 🙋 while bob holds the post; her release takes her pill off and names bob.
  seedPost('m2', 'p');
  append({ kind: 'reaction', project: 'p', of: 'm2', emoji: HAND, from: 'ann', op: 'add', at: '2026-10-21T00:00:00.000Z' });
  assert.equal(claim('bob', 'm2').op, 'add');
  const rel = claim('ann', 'm2', 'release');
  assert.equal(rel.op, 'none');
  assert.equal(rel.claimedBy, 'bob');
  assert.deepEqual(pills('m2').map((r) => r.who), [['bob']], 'ann\'s old pill was left beside bob\'s claim');
  // Case 3: ann's old toned 🙋 goes with one toggle (it does not add a second pill).
  seedPost('m3', 'p');
  append({ kind: 'reaction', project: 'p', of: 'm3', emoji: HAND_TONE, from: 'ann', op: 'add', at: '2026-10-21T00:00:00.000Z' });
  assert.equal(messages.react({ project: 'p', of: 'm3', emoji: HAND_TONE, from: 'ann', members: MEMBERS }).op, 'remove');
  assert.deepEqual(pills('m3'), [], 'a toned old pill could not be taken off');
  // ... and a claim on top of an old pill leaves ONE pill, the marked claim.
  seedPost('m4', 'p');
  append({ kind: 'reaction', project: 'p', of: 'm4', emoji: HAND_TONE, from: 'ann', op: 'add', at: '2026-10-21T00:00:00.000Z' });
  assert.equal(claim('ann', 'm4').op, 'add');
  assert.deepEqual(pills('m4').map((r) => r.emoji), [HAND], 'claiming left the old toned pill beside the claim');
  assert.equal(holder('m4'), 'ann');
  // Case 4: the person's old toned 🙋 goes with one click.
  seedPost('m5', 'p');
  append({ kind: 'reaction', project: 'p', of: 'm5', emoji: HAND_TONE, operator: true, op: 'add', at: '2026-10-21T00:00:00.000Z' });
  assert.equal(messages.react({ project: 'p', of: 'm5', emoji: HAND_TONE, operator: true }).op, 'remove');
  assert.deepEqual(pills('m5'), [], 'the person\'s old toned pill could not be taken off');
});

test('#6952: a post that @-names members can be claimed only by them; control: a post that names nobody, by anyone', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  append({ kind: 'post', id: 'm1', project: 'p', from: 'you', operator: true, to: MEMBERS, mentioned: ['bob'], text: '@bob please do X', outcomes: {}, at: new Date().toISOString() });
  const ann = claim('ann');
  assert.equal(ann.ok, false, 'ann claimed a post that asks bob');
  assert.deepEqual(ann.askedOf, ['bob']);
  assert.equal(ann.because, 'that post asks bob, so it is theirs to take: read the room, and ask them if you can help (if they hand it to you, claim the post where they do)');
  assert.deepEqual(messages.react({ project: 'p', of: 'm1', emoji: HAND, from: 'ann', members: MEMBERS }).askedOf, ['bob'], 'a plain 🙋 went around the rule');
  assert.equal(claim('bob').op, 'add', 'bob could not claim the post that asks him');
  // CONTROL: `to` is every member here too, but nobody is named, so ann can claim it.
  append({ kind: 'post', id: 'm2', project: 'p', from: 'you', operator: true, to: MEMBERS, text: 'can someone do Y', outcomes: {}, at: new Date().toISOString() });
  assert.equal(claim('ann', 'm2').op, 'add');
});

test('#6952: an agent named operator cannot react (it would read as the person in the room view)', () => {
  seedPost('m1', 'p');
  const r = messages.react({ project: 'p', of: 'm1', emoji: THUMB, from: 'operator', members: ['operator'] });
  assert.equal(r.ok, false);
  assert.match(r.because, /that name is reserved/);
  assert.match(messages.react({ project: 'p', of: 'm1', emoji: THUMB, from: 'Operator', members: ['Operator'] }).because, /that name is reserved/);
  // CONTROL: the same reaction from an ordinary member lands.
  assert.equal(messages.react({ project: 'p', of: 'm1', emoji: THUMB, from: 'ann', members: MEMBERS }).op, 'add');
});

test('#6952 review 1: a post naming only someone who has left the room is open to the rest; control: while they are in it, it is not', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  append({ kind: 'post', id: 'm1', project: 'p', from: 'you', operator: true, to: MEMBERS, mentioned: ['bob'], text: '@bob please do X', outcomes: {}, at: new Date().toISOString() });
  assert.equal(claim('ann', 'm1', 'claim', ['ann', 'bob', 'cy']).ok, false, 'CONTROL: with bob in the room, ann must be refused');
  const after = claim('ann', 'm1', 'claim', ['ann', 'cy']);
  assert.equal(after.ok, true, 'a post naming only a departed member could never be claimed');
  assert.equal(after.op, 'add');
});

test('#6952 review 1: the name operator is reserved when an agent is created, in any case', () => {
  const create = require('./create');
  const check = create.nameProblem;
  assert.equal(typeof check, "function", "engine/create.js no longer exports nameProblem");
  for (const n of ['operator', 'Operator', 'OPERATOR']) assert.match(String(check(n)), /reserved/, n);
  assert.equal(check('operators'), null, 'a name that only starts with operator was refused');
});

test('#6952 review 2: a reply asks the author of the post it answers; control: a reply to the person\'s own post asks nobody', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  const at = () => new Date().toISOString();
  append({ kind: 'post', id: 'm1', project: 'p', from: 'bob', to: MEMBERS, text: 'Shall I fix the login bug?', outcomes: {}, at: at() });
  append({ kind: 'post', id: 'm2', project: 'p', from: 'you', operator: true, to: MEMBERS, replyTo: 'm1', text: 'yes please, go ahead', outcomes: {}, at: at() });
  const ann = claim('ann', 'm2');
  assert.equal(ann.ok, false, 'ann claimed the go-ahead meant for bob');
  assert.deepEqual(ann.askedOf, ['bob']);
  assert.equal(claim('bob', 'm2').op, 'add');
  // CONTROL: the person answering their OWN post asks nobody new, so anyone can claim it.
  append({ kind: 'post', id: 'm3', project: 'p', from: 'you', operator: true, to: MEMBERS, text: 'can someone do Y', outcomes: {}, at: at() });
  append({ kind: 'post', id: 'm4', project: 'p', from: 'you', operator: true, to: MEMBERS, replyTo: 'm3', text: 'still open', outcomes: {}, at: at() });
  assert.equal(claim('ann', 'm4').op, 'add');
});

test('#6952 review 4: only the person re-assigns a post; an agent hands work on in its own post, which is the one claimed', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  const at = () => new Date().toISOString();
  const post = (row) => append({ kind: 'post', project: 'p', to: MEMBERS, outcomes: {}, at: at(), ...row });
  post({ id: 'm1', from: 'you', operator: true, mentioned: ['bob'], text: '@bob please fix the login bug' });
  // bob asks ann a side question on m1: it hands nothing over, so bob keeps m1 and ann cannot take it.
  post({ id: 'm2', from: 'bob', replyTo: 'm1', mentioned: ['ann'], text: '@ann can you check my approach first?' });
  assert.deepEqual(claim('ann').askedOf, ['bob'], 'an asked member\'s side question handed the request away');
  // bob hands it on in his own post: ann claims THAT post, which asks her.
  post({ id: 'm3', from: 'bob', replyTo: 'm1', mentioned: ['ann'], text: '@ann I am out of usage, please take this' });
  assert.equal(claim('ann', 'm3').op, 'add', 'ann could not claim the post that hands the work to her');
  assert.match(claim('cy', 'm1').because, /if they hand it to you, claim the post where they do/);
  // The person re-assigns m1 itself: ann can now claim m1 too.
  post({ id: 'm4', from: 'you', operator: true, replyTo: 'm1', mentioned: ['ann'], text: '@ann yes, you take it' });
  assert.equal(claim('ann').op, 'add', 'the person handed m1 to ann and the board still refused her');
  // The person's hand-off of an OPEN post makes it the named member's (control: before it, anyone could claim).
  post({ id: 'm5', from: 'you', operator: true, text: 'can someone fix the signup page' });
  post({ id: 'm6', from: 'you', operator: true, replyTo: 'm5', mentioned: ['ann'], text: '@ann you take this one' });
  assert.deepEqual(claim('cy', 'm5').askedOf, ['ann'], 'the person\'s hand-off of an open post was ignored');
});

test('#6952 review 3: an agent answering its own post asks the room; control: the person answering it asks that agent', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  const at = () => new Date().toISOString();
  append({ kind: 'post', id: 'm1', project: 'p', from: 'bob', to: MEMBERS, text: 'Investigating the login bug', outcomes: {}, at: at() });
  append({ kind: 'post', id: 'm2', project: 'p', from: 'bob', to: MEMBERS, replyTo: 'm1', text: 'Found it but I am out of usage, can someone take it?', outcomes: {}, at: at() });
  const ann = claim('ann', 'm2');
  assert.equal(ann.ok, true, 'bob\'s answer to his own post was locked to bob: ' + JSON.stringify(ann));
  // CONTROL: the person answering bob's post asks bob.
  append({ kind: 'post', id: 'm3', project: 'p', from: 'you', operator: true, to: MEMBERS, replyTo: 'm1', text: 'yes, finish it', outcomes: {}, at: at() });
  assert.deepEqual(claim('cy', 'm3').askedOf, ['bob']);
});
