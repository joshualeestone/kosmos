'use strict';

/**
 * #6949: the person frees a room post's 🙋 claim (#6946) from the board, for an agent that went quiet holding it.
 *
 * The card's done-line is the first test: ann claims, the person frees it, bob can claim it, and ann's next room read
 * says it was freed. Its control: without the person's action, bob is refused naming ann.
 */

const os = require('node:os');
const path = require('node:path');
// Sandbox BEFORE the engine require, as roomclaim-6946.test.js does (freeClaim() appends to the real log otherwise).
process.env.AGENT_WORKFORCE_DATA = path.join(os.tmpdir(), 'kosmos-roomfree-test-' + process.pid);

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const messages = require('./messages');

const HAND = '\u{1F64B}';
const HAND_TONE = '\u{1F64B}\u{1F3FD}';
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
const claim = (from, of = 'm1') => messages.react({ project: 'p', of, from, members: MEMBERS, claim: 'claim' });
const free = (by, of = 'm1', project = 'p') => messages.freeClaim({ project, of, by, members: MEMBERS });
const holder = (of = 'm1') => { const c = messages.claimOf(of, messages.record().rows, MEMBERS); return c && c.by; };
const rows = () => messages.record().rows;
const agentNotes = () => rows().filter((m) => m.kind === 'note' && m.audience === messages.NOTE_AUDIENCE_AGENTS);

test('the done-line: the person frees ann\'s claim, bob can claim, and the room tells ann; control: without it bob is refused', () => {
  seedPost('m1', 'p');
  assert.equal(claim('ann').ok, true);

  // CONTROL first: without the person's action bob is refused, naming ann.
  const refused = claim('bob');
  assert.equal(refused.ok, false, 'the control claimed a held post, so the free below proves nothing');
  assert.equal(refused.claimedBy, 'ann');

  const out = free('ann');
  assert.deepEqual(out, { ok: true, op: 'freed', of: 'm1', freed: 'ann' });
  assert.equal(holder(), null, 'the claim survived the person freeing it');
  const removed = rows().filter((m) => m.kind === 'reaction' && m.op === 'remove');
  assert.equal(removed.length, 1);
  assert.equal(removed[0].from, 'ann', 'the remove row is not ann\'s, so replay would not take her 🙋 off');
  assert.equal(removed[0].takenBy, 'you', 'the log does not say the person took the claim');
  assert.equal(removed[0].operator, undefined, 'the remove was written as the person\'s own reaction');
  assert.deepEqual(messages.reactionsFor('m1', rows()), [], 'ann\'s 🙋 pill is still on the post');

  const notes = agentNotes();
  assert.equal(notes.length, 1, 'no agents-only note says the claim was freed');
  assert.match(notes[0].text, /^The person freed the claim ann held on \[m1\], so another agent can claim it now\./);
  assert.equal(notes[0].project, 'p');

  const now = claim('bob');
  assert.equal(now.ok, true, 'bob still could not claim the freed post');
  assert.equal(holder(), 'bob');
});

test('a claim that changed hands since the page drew it is refused, and nothing is written', () => {
  seedPost('m1', 'p');
  assert.equal(claim('ann').ok, true);
  assert.equal(messages.react({ project: 'p', of: 'm1', from: 'ann', members: MEMBERS, claim: 'release' }).op, 'remove');
  assert.equal(claim('bob').ok, true);
  const before = rows().length;
  const out = free('ann');   // the page still shows ann
  assert.equal(out.ok, false, 'a stale page freed the agent who holds it now');
  assert.equal(out.claimedBy, 'bob');
  assert.match(out.because, /^ann no longer holds that post; bob claimed it just now, so nothing was freed$/);
  assert.equal(rows().length, before, 'a refused free wrote to the log');
  assert.equal(holder(), 'bob');
  // CONTROL: naming the holder it now shows frees it.
  assert.equal(free('bob').op, 'freed');
});

test('an already-free post is op none and writes nothing; a missing post, project or holder is refused', () => {
  seedPost('m1', 'p');
  const before = rows().length;
  assert.deepEqual(free('ann'), { ok: true, op: 'none', of: 'm1' });
  assert.equal(rows().length, before, 'freeing a free post wrote to the log');
  assert.equal(free('ann', 'm9').ok, false);
  assert.equal(free('ann', 'm9').because, 'there is no post by that id in this room');
  assert.equal(free('ann', 'm1', 'other').because, 'there is no post by that id in this room', 'a post in another room was freed');
  assert.equal(free('', 'm1').because, 'we could not tell whose claim to free');
  assert.equal(free(undefined, 'm1').because, 'we could not tell whose claim to free');
  assert.equal(messages.freeClaim({ project: '', of: 'm1', by: 'ann', members: MEMBERS }).ok, false);
});

test('every live 🙋 form of the holder is removed (rows from before react() stored them plain)', () => {
  seedPost('m1', 'p');
  const at = new Date().toISOString();
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND, op: 'add', from: 'ann', at });
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND_TONE, op: 'add', from: 'ann', at });
  assert.equal(holder(), 'ann');
  assert.equal(free('ann').op, 'freed');
  const removed = rows().filter((m) => m.kind === 'reaction' && m.op === 'remove').map((m) => m.emoji).sort();
  assert.deepEqual(removed, [HAND, HAND_TONE].sort(), 'a 🙋 form of ann\'s was left, so she still holds the post');
  assert.equal(holder(), null);
});

test('the person\'s own 🙋 and other agents\' reactions are left alone', () => {
  seedPost('m1', 'p');
  assert.equal(claim('ann').ok, true);
  assert.equal(messages.react({ project: 'p', of: 'm1', emoji: HAND, operator: true }).op, 'add');
  assert.equal(messages.react({ project: 'p', of: 'm1', emoji: '\u{1F44D}', from: 'bob', members: MEMBERS }).op, 'add');
  assert.equal(free('ann').op, 'freed');
  const left = messages.reactionsFor('m1', rows(), 'you');
  assert.deepEqual(left.map((r) => [r.emoji, r.who]), [[HAND, ['you']], ['\u{1F44D}', ['bob']]]);
});

test('with a second live claimant, it holds the post next, and the note and the answer name it', () => {
  seedPost('m1', 'p');
  const at = new Date().toISOString();
  // Two live 🙋 rows, as from before the claim rule: ann's is earlier, so ann holds it and bob is next.
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND, op: 'add', from: 'ann', at });
  append({ kind: 'reaction', project: 'p', of: 'm1', emoji: HAND, op: 'add', from: 'bob', at });
  assert.equal(holder(), 'ann');
  const out = free('ann');
  assert.equal(out.op, 'freed');
  assert.equal(out.claimedBy, 'bob', 'the answer does not say bob holds it now');
  assert.equal(holder(), 'bob');
  assert.match(agentNotes()[0].text, /^The person freed the claim ann held on \[m1\], so bob holds it now\./,
    'the note says another agent can claim a post bob holds');
  // CONTROL: with no second claimant the answer names nobody (the done-line test checks its note).
  seedPost('m2', 'p');
  assert.equal(claim('cy', 'm2').ok, true);
  assert.equal(free('cy', 'm2').claimedBy, undefined);
});
