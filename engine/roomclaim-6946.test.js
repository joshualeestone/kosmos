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
  assert.equal(ann.because, 'that post asks bob, so it is theirs to take for 30 more minutes: read the room, and ask them if you can help (if they hand it to you, claim the post where they do)');
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

test('#6952 review 4/5: a hand-off is a post of its own, by an agent or the person; a side question hands nothing over', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  const at = () => new Date().toISOString();
  const post = (row) => append({ kind: 'post', project: 'p', to: MEMBERS, outcomes: {}, at: at(), ...row });
  post({ id: 'm1', from: 'you', operator: true, mentioned: ['bob'], text: '@bob please fix the login bug' });
  // bob asks ann a side question on m1: it hands nothing over, so bob keeps m1.
  post({ id: 'm2', from: 'bob', replyTo: 'm1', mentioned: ['ann'], text: '@ann can you check my approach first?' });
  assert.deepEqual(claim('ann').askedOf, ['bob'], 'an asked member\'s side question handed the request away');
  // bob hands it on in his own post: ann claims THAT post, which asks her.
  post({ id: 'm3', from: 'bob', replyTo: 'm1', mentioned: ['ann'], text: '@ann I am out of usage, please take this' });
  assert.equal(claim('ann', 'm3').op, 'add', 'ann could not claim the post that hands the work to her');
  assert.match(claim('cy', 'm1').because, /if they hand it to you, claim the post where they do/);
  // The person's side question on an OPEN post does not lock it to the one they name (review 5).
  post({ id: 'm5', from: 'you', operator: true, text: 'can someone fix the signup page' });
  post({ id: 'm6', from: 'you', operator: true, replyTo: 'm5', mentioned: ['bob'], text: '@bob was this the page you touched last week?' });
  assert.equal(claim('cy', 'm5').op, 'add', 'the person\'s side question locked an open post to bob');
  // The person's hand-off is its own post: ann claims it.
  post({ id: 'm7', from: 'you', operator: true, replyTo: 'm5', mentioned: ['ann'], text: '@ann you take the header' });
  assert.equal(claim('ann', 'm7').op, 'add');
});

test('#6952 review 5: naming someone in a request to the room does not make it theirs; control: a request to them does', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  const at = () => new Date().toISOString();
  const post = (row) => append({ kind: 'post', project: 'p', to: MEMBERS, outcomes: {}, at: at(), ...row });
  post({ id: 'm1', from: 'you', operator: true, mentioned: ['bob'], text: 'can someone review what @bob shipped yesterday?' });
  assert.equal(claim('ann', 'm1').op, 'add', 'a reference to bob in a request to the room locked it to bob');
  post({ id: 'm2', from: 'bob', to: MEMBERS, text: 'Deploy finished.' });
  post({ id: 'm3', from: 'you', operator: true, replyTo: 'm2', text: 'great, now can someone write the release notes?' });
  assert.equal(claim('ann', 'm3').op, 'add', 'a request to the room in a reply to bob was locked to bob');
  // CONTROLS: "confirm" is not the room (it asks bob to confirm), and an ambiguous @-word leaves the post open.
  post({ id: 'm4', from: 'you', operator: true, mentioned: ['bob'], text: '@bob please confirm the dates and send them out' });
  assert.deepEqual(claim('ann', 'm4').askedOf, ['bob']);
  post({ id: 'm5', from: 'you', operator: true, mentioned: ['bob'], ambiguousMentions: ['b'], text: '@b please fix X' });
  assert.equal(claim('ann', 'm5').op, 'add', 'an ambiguous @-word locked the post');
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

test('#6952 review 6: a room word counts only where it asks for the work; "one of you" on a named post means them', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  const at = () => new Date().toISOString();
  let n = 0;
  const ask = (row) => { n += 1; append({ kind: 'post', id: 'r' + n, project: 'p', from: 'you', operator: true, to: MEMBERS, outcomes: {}, at: at(), ...row }); return 'r' + n; };
  // Requests to bob that mention the room in passing: still bob's.
  for (const text of ['@bob please fix the bug someone reported in signup', '@bob please fix X, and do not let anyone else touch the migration',
    '@bob please make sure everyone\'s tests pass after the bump', '@bob ask whoever owns billing']) {
    assert.deepEqual(claim('cy', ask({ mentioned: ['bob'], text })).askedOf, ['bob'], text);
  }
  // "one of you" on a post naming ann and bob means ann or bob, not cy.
  assert.deepEqual(claim('cy', ask({ mentioned: ['ann', 'bob'], text: '@ann @bob can one of you review this?' })).askedOf, ['ann', 'bob']);
  // CONTROLS: the room asked for the work.
  assert.equal(claim('cy', ask({ mentioned: ['bob'], text: 'anyone free to review what @bob shipped?' })).op, 'add');
  append({ kind: 'post', id: 'd1', project: 'p', from: 'bob', to: MEMBERS, text: 'Deploy finished.', outcomes: {}, at: at() });
  assert.equal(claim('cy', ask({ replyTo: 'd1', text: 'great. who can write the release notes?' })).op, 'add', 'who can in a reply to bob was locked to bob');
  assert.equal(claim('cy', ask({ replyTo: 'd1', text: 'can one of you write the notes?' })).op, 'add', 'one of you in a reply naming nobody was locked to bob');
});

test('#6952 review 6: released is said only when a claim was given back', () => {
  seedPost('m1', 'p');
  assert.equal(claim('ann').op, 'add');
  const toggled = messages.react({ project: 'p', of: 'm1', emoji: HAND, from: 'ann', members: MEMBERS });
  assert.equal(toggled.released, true, 'the holder\'s own toggle-off did not say it released the claim');
  assert.equal(claim('ann').op, 'add');
  assert.equal(claim('ann', 'm1', 'release').released, true);
  // An old unmarked pill that was never the claim: taken off, but nothing was released.
  seedPost('m2', 'p');
  append({ kind: 'reaction', project: 'p', of: 'm2', emoji: HAND, from: 'bob', op: 'add', at: '2026-10-21T00:00:00.000Z' });
  const stray = messages.react({ project: 'p', of: 'm2', emoji: HAND, from: 'bob', members: MEMBERS });
  assert.equal(stray.op, 'remove');
  assert.equal(stray.released, undefined, 'taking off a pill that was never the claim said it released one');
});

test('#6952 review 7: the asked members have first call for 30 minutes, then anyone may claim; control: inside the window, refused', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  append({ kind: 'post', id: 'm1', project: 'p', from: 'you', operator: true, to: MEMBERS, mentioned: ['bob'], text: '@bob please fix X', outcomes: {}, at: ago(29) });
  const inside = claim('ann', 'm1');
  assert.deepEqual(inside.askedOf, ['bob'], 'CONTROL: inside the window ann must be refused');
  assert.match(inside.because, /for 1 more minute:/);
  append({ kind: 'post', id: 'm2', project: 'p', from: 'you', operator: true, to: MEMBERS, mentioned: ['bob'], text: '@bob please fix Y', outcomes: {}, at: ago(31) });
  assert.equal(claim('ann', 'm2').op, 'add', 'a post nobody it asked took up was held past the window');
  // Two asked members read as "ann or bob".
  append({ kind: 'post', id: 'm3', project: 'p', from: 'you', operator: true, to: MEMBERS, mentioned: ['ann', 'bob'], text: '@ann @bob please fix Z', outcomes: {}, at: ago(1) });
  assert.match(claim('cy', 'm3').because, /^that post asks ann or bob, so it is theirs to take for 29 more minutes/);
});

test('#6952 review 7: a room word inside a request to bob, a relative clause or a question for information, is still bob\'s', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  let n = 0;
  const ask = (text, row) => { n += 1; append({ kind: 'post', id: 'q' + n, project: 'p', from: 'you', operator: true, to: MEMBERS, mentioned: ['bob'], outcomes: {}, at: new Date().toISOString(), text, ...(row || {}) }); return 'q' + n; };
  for (const text of ['@bob please ping the person who can approve the DNS change, then ship it', '@bob does anyone still call this endpoint? if not, please delete it',
    '@bob check who will be on call this weekend and update the pager config', '@bob why would anyone use the old flag? please remove it',
    '@bob please email the volunteers the new schedule']) {
    assert.deepEqual(claim('cy', ask(text)).askedOf, ['bob'], text);
  }
  // CONTROL: a bare "anyone?" asks the room.
  assert.equal(claim('cy', ask('@bob is out today, anyone?')).op, 'add');
});

test('#6957: once every asked member has claimed and given the post back, it is open; control: while one still holds it, not', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  append({ kind: 'post', id: 'm1', project: 'p', from: 'you', operator: true, to: MEMBERS, mentioned: ['bob'], text: '@bob please fix X', outcomes: {}, at: new Date().toISOString() });
  assert.equal(claim('bob').op, 'add');
  assert.equal(claim('cy').claimedBy, 'bob', 'CONTROL: while bob holds it, cy is refused');
  assert.equal(claim('bob', 'm1', 'release').op, 'remove');
  const cy = claim('cy');
  assert.equal(cy.op, 'add', 'bob gave the post back and cy was still sent to ask bob: ' + JSON.stringify(cy));
  // CONTROL: bob never claimed it, so inside the window it is still bob's.
  append({ kind: 'post', id: 'm2', project: 'p', from: 'you', operator: true, to: MEMBERS, mentioned: ['bob'], text: '@bob please fix Y', outcomes: {}, at: new Date().toISOString() });
  assert.deepEqual(claim('cy', 'm2').askedOf, ['bob']);
});

test('#6957: common requests to the room open the post; passing mentions still do not', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  let n = 0;
  const ask = (text) => { n += 1; append({ kind: 'post', id: 'w' + n, project: 'p', from: 'you', operator: true, to: MEMBERS, mentioned: ['bob'], text, outcomes: {}, at: new Date().toISOString() }); return 'w' + n; };
  for (const text of ["Who's free to take this? @bob is out", 'Who’s free to take this? @bob is out', 'Who has time for this? @bob is out',
    'Anyone around to take this? @bob is out', '@bob please take this. If you cannot, anyone else?']) {
    assert.equal(claim('cy', ask(text)).op, 'add', text);
  }
  // CONTROLS: still bob's.
  for (const text of ['@bob please ask whoever is around in billing', '@bob please fix the bug someone else reported', '@bob check who is free on Friday and book them',
    // review 1: passing mentions the first version of #6957 opened
    '@bob ping anyone around in billing', '@bob please ask if anyone around has the key', '@bob I need someone to review this, can you do it?',
    '@bob we need someone to own the docs, can you find them?', '@bob is the build broken for anyone else?', '@bob does this happen to anyone else?']) {
    assert.deepEqual(claim('cy', ask(text)).askedOf, ['bob'], text);
  }
});

test('#6957: a post dated ahead of the clock is open; the author of a request to bob cannot take it from him', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  const ahead = new Date(Date.now() + 5 * 3600000).toISOString();   // a clock stepped back
  append({ kind: 'post', id: 'm1', project: 'p', from: 'you', operator: true, to: MEMBERS, mentioned: ['bob'], text: '@bob please fix X', outcomes: {}, at: ahead });
  assert.equal(claim('cy').op, 'add', 'a post dated ahead of the clock was held (it would be for hours)');
  // CONTROL: the same post dated now is held, and opens once 30 minutes have passed (the clock stepped forward).
  append({ kind: 'post', id: 'm3', project: 'p', from: 'you', operator: true, to: MEMBERS, mentioned: ['bob'], text: '@bob please fix Z', outcomes: {}, at: new Date().toISOString() });
  assert.deepEqual(claim('cy', 'm3').askedOf, ['bob']);
  const realNow = Date.now;
  try { Date.now = () => realNow() + 31 * 60000; assert.equal(claim('cy', 'm3').op, 'add', 'the window did not end after 30 minutes'); }
  finally { Date.now = realNow; }
  // Review 4: no author exemption. ann asked bob to take it; holding it herself would lock bob out with no time limit.
  append({ kind: 'post', id: 'm2', project: 'p', from: 'ann', to: MEMBERS, mentioned: ['bob'], text: '@bob can you take the login bug?', outcomes: {}, at: new Date().toISOString() });
  assert.deepEqual(claim('ann', 'm2').askedOf, ['bob'], 'the author claimed the request she put to bob');
  assert.equal(claim('bob', 'm2').op, 'add');
});

test('#6957: the reserved-name refusal says what to do', () => {
  seedPost('m1', 'p');
  assert.match(messages.react({ project: 'p', of: 'm1', emoji: THUMB, from: 'operator', members: ['operator'] }).because, /make a new agent under another name/);
});

test('#6957 review 1: a reply naming nobody asks the answered author, even against the reply\'s own writer', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  append({ kind: 'post', id: 'm1', project: 'p', from: 'bob', to: MEMBERS, text: 'Shall I take the parser?', outcomes: {}, at: new Date().toISOString() });
  append({ kind: 'post', id: 'm2', project: 'p', from: 'cy', to: MEMBERS, replyTo: 'm1', text: 'yes, go ahead', outcomes: {}, at: new Date().toISOString() });
  assert.deepEqual(claim('cy', 'm2').askedOf, ['bob'], 'the reply\'s writer took the go-ahead meant for bob');
});

test('#6957 review 1: gave back means bob removed his own claim; a claim ended for him by a newer one does not count', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  const at = () => new Date().toISOString();
  append({ kind: 'post', id: 'm1', project: 'p', from: 'you', operator: true, to: MEMBERS, mentioned: ['bob'], text: '@bob please fix X', outcomes: {}, at: at() });
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND, from: 'bob', op: 'add', claim: true, at: at() });
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND, from: 'bob', op: 'remove', takenBy: 'cy', because: 'left-the-room', at: at() });
  assert.deepEqual(claim('ann').askedOf, ['bob'], 'a claim ended FOR bob counted as bob giving it back');
});

test('#6957 review 2: need someone to in a go-ahead reply is the answered author\'s', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  const at = () => new Date().toISOString();
  append({ kind: 'post', id: 'r1', project: 'p', from: 'bob', to: MEMBERS, text: 'Shall I take the parser?', outcomes: {}, at: at() });
  append({ kind: 'post', id: 'r2', project: 'p', from: 'ann', to: MEMBERS, replyTo: 'r1', text: 'Yes, we need someone to take it, go ahead', outcomes: {}, at: at() });
  assert.deepEqual(claim('cy', 'r2').askedOf, ['bob'], 'a go-ahead reply to bob opened to anyone');
  // CONTROL: the same reply without "need someone to" is bob's too; this is the reply path, not the pattern.
  append({ kind: 'post', id: 'r4', project: 'p', from: 'ann', to: MEMBERS, replyTo: 'r1', text: 'Yes, go ahead', outcomes: {}, at: at() });
  assert.deepEqual(claim('cy', 'r4').askedOf, ['bob']);
});

test('#6957 review 2: a bare anyone? after a new line, a dash or in brackets asks the room; @bob, who... asks bob', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  let n = 0;
  const ask = (text) => { n += 1; append({ kind: 'post', id: 'v' + n, project: 'p', from: 'you', operator: true, to: MEMBERS, mentioned: ['bob'], text, outcomes: {}, at: new Date().toISOString() }); return 'v' + n; };
  for (const text of ['@bob is out today\nAnyone?', '@bob is out today - anyone?', '@bob is out today \u2014 anyone?', '@bob is out (anyone?)', '@bob fix X\nCan someone review after?']) {
    assert.equal(claim('cy', ask(text)).op, 'add', JSON.stringify(text));
  }
  for (const text of ['@bob, who has time to pair with me tomorrow?', '@bob, who is around this weekend?', "@bob, who's around for on-call Friday?", '@bob: who can approve this?',
    // review 3: a dash or "!" after the name, and a greeting before it, address bob too
    '@bob - who has time to pair with me tomorrow?', '@bob \u2014 who can approve this?', '@bob! who can approve this?',
    'Hey @bob, who has time to pair with me tomorrow?', 'Thanks @bob, who can review this next?']) {
    assert.deepEqual(claim('cy', ask(text)).askedOf, ['bob'], text);
  }
});

test('#6957 review 2: gave back replays bob\'s rows in order; an old pill removed before his claim, then a claim ended for him, is not a give-back', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  const at = () => new Date().toISOString();
  append({ kind: 'post', id: 'm1', project: 'p', from: 'you', operator: true, to: MEMBERS, mentioned: ['bob'], text: '@bob please fix X', outcomes: {}, at: at() });
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND, from: 'bob', op: 'remove', at: at() });               // react() clearing an old pill
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND, from: 'bob', op: 'add', claim: true, at: at() });
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND, from: 'bob', op: 'remove', takenBy: 'cy', because: 'left-the-room', at: at() });
  assert.deepEqual(claim('ann').askedOf, ['bob'], 'the remove before bob\'s claim counted as bob giving it back');
});

test('#6957 review 3: a post a few seconds ahead of the clock is still held (a small clock adjustment), more than a minute ahead is open', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  append({ kind: 'post', id: 'm1', project: 'p', from: 'you', operator: true, to: MEMBERS, mentioned: ['bob'], text: '@bob please fix X', outcomes: {}, at: new Date(Date.now() + 30000).toISOString() });
  assert.deepEqual(claim('cy').askedOf, ['bob'], 'a post 30 s ahead of the clock lost its hold');
  append({ kind: 'post', id: 'm2', project: 'p', from: 'you', operator: true, to: MEMBERS, mentioned: ['bob'], text: '@bob please fix Y', outcomes: {}, at: new Date(Date.now() + 120000).toISOString() });
  assert.equal(claim('cy', 'm2').op, 'add');
});

test('#6957 review 4: someone ELSE asks the room, even right after the names; control: the bug someone else reported is still bob\'s', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  let n = 0;
  const ask = (text) => { n += 1; append({ kind: 'post', id: 'e' + n, project: 'p', from: 'you', operator: true, to: MEMBERS, mentioned: ['bob'], text, outcomes: {}, at: new Date().toISOString() }); return 'e' + n; };
  for (const text of ['Thanks @bob! Can someone else take the login bug?', '@bob! Can anyone else take this?', '@bob. Can anyone else take this?',
    '@bob is out, someone else please take this', '@bob is out, anyone else free to take it?', '@bob is swamped so somebody else please grab the login bug']) {
    assert.equal(claim('cy', ask(text)).op, 'add', text);
  }
  for (const text of ['@bob please fix the bug someone else reported', '@bob! who can approve this?', '@bob, did anyone else see this?']) {
    assert.deepEqual(claim('cy', ask(text)).askedOf, ['bob'], text);
  }
});

test('#6957 review 5: with two asked members, one giving it back is not enough; control: once both have, it is open', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  append({ kind: 'post', id: 'm1', project: 'p', from: 'you', operator: true, to: MEMBERS, mentioned: ['ann', 'bob'], text: '@ann @bob please fix X', outcomes: {}, at: new Date().toISOString() });
  assert.equal(claim('ann').op, 'add');
  assert.equal(claim('ann', 'm1', 'release').op, 'remove');
  assert.deepEqual(claim('cy').askedOf, ['ann', 'bob'], 'ann giving it back opened a post that also asks bob');
  assert.equal(claim('bob').op, 'add');
  assert.equal(claim('bob', 'm1', 'release').op, 'remove');
  assert.equal(claim('cy').op, 'add', 'both asked members gave it back and it was still held');
});

test('#6957 review 5: will/would anyone else is a question to bob, not a request to the room', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  let n = 0;
  const ask = (text) => { n += 1; append({ kind: 'post', id: 'z' + n, project: 'p', from: 'you', operator: true, to: MEMBERS, mentioned: ['bob'], text, outcomes: {}, at: new Date().toISOString() }); return 'z' + n; };
  for (const text of ['@bob will anyone else need access? Please set it up', '@bob would anyone else object if you took this?', '@bob can you take it, or would someone else be better?']) {
    assert.deepEqual(claim('cy', ask(text)).askedOf, ['bob'], text);
  }
});

test('#6957 review 6: could someone else HAVE... and can anyone else SEE... are questions to bob; control: can someone else take it? asks the room', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  let n = 0;
  const ask = (text) => { n += 1; append({ kind: 'post', id: 'y' + n, project: 'p', from: 'you', operator: true, to: MEMBERS, mentioned: ['bob'], text, outcomes: {}, at: new Date().toISOString() }); return 'y' + n; };
  for (const text of ['@bob could someone else have changed this file?', '@bob can anyone else see the logs, or only you?',
    '@bob could anybody else be affected by this?', "@bob can someone else's PR have broken this?"]) {
    assert.deepEqual(claim('cy', ask(text)).askedOf, ['bob'], text);
  }
  assert.equal(claim('cy', ask('@bob is out, can someone else take the login bug?')).op, 'add');
  // Review 6 N2: a name cannot end in a dot, so "@bob. Who can take this?" starts a clause after the dot.
  assert.equal(claim('cy', ask('@bob. Who can take this?')).op, 'add', 'the dot after @bob was eaten as part of the name');
});

test('#6957 review 6: only a marked claim given back counts; an unmarked old hand taken off is not a give-back', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  const at = () => new Date().toISOString();
  append({ kind: 'post', id: 'm1', project: 'p', from: 'you', operator: true, to: MEMBERS, mentioned: ['bob'], text: '@bob please fix X', outcomes: {}, at: at() });
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND, from: 'bob', op: 'add', at: at() });
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND, from: 'bob', op: 'remove', at: at() });
  assert.deepEqual(claim('cy').askedOf, ['bob'], 'bob taking off an unmarked hand counted as giving the post back');
});
