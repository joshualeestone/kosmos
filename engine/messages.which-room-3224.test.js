'use strict';

/**
 * #3224, the proactive half: owedElsewhere(agent, targetProject, now) finds the
 * question an agent owes the person in a DIFFERENT room, so /api/post can ask which
 * room a non-reply post meant instead of posting it blind. "Owed" is the #185 test
 * (an operator post that mentioned the agent, reached its pane, and no room post
 * from the agent in that project since), bounded to WHICH_ROOM_WINDOW_MS.
 *
 * Seeds the record directly with explicit timestamps, as the misroute-digest test
 * does, so ask/answer ordering is fixed by construction.
 *
 *   node --test engine/messages.which-room-3224.test.js
 */

const os = require('node:os');
const path = require('node:path');
const SANDBOX = path.join(os.tmpdir(), 'kosmos-which-room-3224-test-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const chat = require('./chat');
const messages = require('./messages');

const PLACED = chat.DELIVERY.PLACED;
const COULD_NOT = chat.DELIVERY.COULD_NOT;
const MIN = 60 * 1000;
const NOW = Date.parse('2026-09-25T19:00:00.000Z');
const iso = (msBeforeNow) => new Date(NOW - msBeforeNow).toISOString();

function ask(id, project, who, minsAgo, outcome = PLACED) {
  return { kind: 'post', id, from: 'you', project, to: [who], text: '@' + who + ' where is it?',
    operator: true, mentioned: [who], outcomes: { [who]: outcome }, at: iso(minsAgo * MIN) };
}
function post(id, project, who, minsAgo) {
  return { kind: 'post', id, from: who, project, to: [], text: 'posting', outcomes: {}, at: iso(minsAgo * MIN) };
}
function seed(rows) {
  messages.resetForTests();
  try { fs.rmSync(messages.LOG, { force: true, recursive: true }); } catch { /* fresh */ }
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  fs.writeFileSync(messages.LOG, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  messages.resetForTests();
}

test.after(() => {
  messages.setWhichRoomWindowForTests(undefined);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('an unanswered question in B is found when the agent posts to A', () => {
  seed([ask('q1', 'projB', 'mara', 5)]);
  assert.deepEqual(messages.owedElsewhere('mara', 'projA', NOW), { id: 'q1', project: 'projB' });
});

test('CONTROL: nothing owed anywhere asks nothing', () => {
  seed([post('p0', 'projB', 'mara', 5)]);
  assert.equal(messages.owedElsewhere('mara', 'projA', NOW), null);
});

test('answered in B before this post: nothing owed', () => {
  seed([ask('q1', 'projB', 'mara', 5), post('a1', 'projB', 'mara', 2)]);
  assert.equal(messages.owedElsewhere('mara', 'projA', NOW), null);
});

test('an answer in the same millisecond as the ask clears it (>=, as in unanswered)', () => {
  seed([ask('q1', 'projB', 'mara', 5), post('a1', 'projB', 'mara', 5)]);
  assert.equal(messages.owedElsewhere('mara', 'projA', NOW), null);
});

test('a post to A does not answer a question in B', () => {
  seed([ask('q1', 'projB', 'mara', 5), post('p1', 'projA', 'mara', 2)]);
  assert.deepEqual(messages.owedElsewhere('mara', 'projA', NOW), { id: 'q1', project: 'projB' });
});

test('posting to the room the question is in asks nothing', () => {
  seed([ask('q1', 'projB', 'mara', 5)]);
  assert.equal(messages.owedElsewhere('mara', 'projB', NOW), null);
});

test('owing BOTH rooms: posting where the NEWER question is asks nothing; posting where the older one is asks about the newer', () => {
  seed([ask('q1', 'projB', 'mara', 5), ask('q2', 'projA', 'mara', 3)]);
  assert.equal(messages.owedElsewhere('mara', 'projA', NOW), null, 'A holds the newer question, so a post to A is ordinary');
  assert.deepEqual(messages.owedElsewhere('mara', 'projB', NOW), { id: 'q2', project: 'projA' },
    'B\'s own question is older than A\'s, so a post to B may be the answer to A');
});

test('an old ignored question in A does not excuse answering B\'s newer question into A', () => {
  seed([ask('q1', 'projA', 'mara', 50), ask('q2', 'projB', 'mara', 2)]);
  assert.deepEqual(messages.owedElsewhere('mara', 'projA', NOW), { id: 'q2', project: 'projB' });
});

test('the window: a question older than an hour does not hold a post (and one just inside does)', () => {
  seed([ask('q1', 'projB', 'mara', 61)]);
  assert.equal(messages.owedElsewhere('mara', 'projA', NOW), null, 'a 61-minute-old ask must not hold a post');
  seed([ask('q1', 'projB', 'mara', 59)]);
  assert.deepEqual(messages.owedElsewhere('mara', 'projA', NOW), { id: 'q1', project: 'projB' }, 'a 59-minute-old ask must');
});

test('an ask that never reached the pane (could_not) is not owed', () => {
  seed([ask('q1', 'projB', 'mara', 5, COULD_NOT)]);
  assert.equal(messages.owedElsewhere('mara', 'projA', NOW), null);
});

test('an ask addressed to someone else is not this agent\'s debt', () => {
  seed([ask('q1', 'projB', 'dana', 5)]);
  assert.equal(messages.owedElsewhere('mara', 'projA', NOW), null);
});

test('an ask from the future (clock skew) is ignored rather than held against a post', () => {
  seed([ask('q1', 'projB', 'mara', -5)]);
  assert.equal(messages.owedElsewhere('mara', 'projA', NOW), null);
});

test('two rooms owed: the most recent question is the one named', () => {
  seed([ask('q1', 'projB', 'mara', 20), ask('q2', 'projC', 'mara', 4)]);
  assert.deepEqual(messages.owedElsewhere('mara', 'projA', NOW), { id: 'q2', project: 'projC' });
});

test('an agent named "you" does not find operator posts standing in as its answers', () => {
  seed([ask('q1', 'projB', 'you', 5)]);
  assert.deepEqual(messages.owedElsewhere('you', 'projA', NOW), { id: 'q1', project: 'projB' });
});

test('an unreadable record asks nothing (post as before), it does not throw', () => {
  messages.resetForTests();
  try { fs.rmSync(messages.LOG, { force: true, recursive: true }); } catch { /* fresh */ }
  fs.mkdirSync(messages.LOG, { recursive: true });   // a directory where the log file should be
  messages.resetForTests();
  assert.equal(messages.owedElsewhere('mara', 'projA', NOW), null);
  fs.rmSync(messages.LOG, { force: true, recursive: true });
});

function newPost(id, project, who, minsAgo) {
  return { ...post(id, project, who, minsAgo), newPost: true };
}

test('--new answers "which room" once: questions owed at that moment are not asked about again', () => {
  seed([ask('q1', 'projB', 'mara', 10), newPost('n1', 'projA', 'mara', 5)]);
  assert.equal(messages.owedElsewhere('mara', 'projA', NOW), null, 'the second post after --new must not be held for the same question');
  // CONTROL: the same post WITHOUT the --new mark leaves the question owed.
  seed([ask('q1', 'projB', 'mara', 10), post('p1', 'projA', 'mara', 5)]);
  assert.deepEqual(messages.owedElsewhere('mara', 'projA', NOW), { id: 'q1', project: 'projB' });
});

test('a question that arrives AFTER a --new post is asked about', () => {
  seed([newPost('n1', 'projA', 'mara', 10), ask('q2', 'projB', 'mara', 5)]);
  assert.deepEqual(messages.owedElsewhere('mara', 'projA', NOW), { id: 'q2', project: 'projB' });
});

test('a question from a room the agent cannot post in (removed, or the room is gone) is skipped', () => {
  seed([ask('q1', 'projB', 'mara', 5)]);
  assert.equal(messages.owedElsewhere('mara', 'projA', NOW, { canPostIn: (p) => p !== 'projB' }), null);
  assert.equal(messages.owedElsewhere('mara', 'projA', NOW, { canPostIn: () => { throw new Error('boom'); } }), null,
    'a predicate that throws counts as cannot-post, never as a hold into an unknown room');
  // CONTROL: the same record with the room postable holds.
  assert.deepEqual(messages.owedElsewhere('mara', 'projA', NOW, { canPostIn: () => true }), { id: 'q1', project: 'projB' });
});

test('a skipped room falls back to the next owed room', () => {
  seed([ask('q1', 'projC', 'mara', 20), ask('q2', 'projB', 'mara', 5)]);
  assert.deepEqual(messages.owedElsewhere('mara', 'projA', NOW, { canPostIn: (p) => p !== 'projB' }), { id: 'q1', project: 'projC' });
});

test('a question with no id, or an id or project that is not a plain id shape, is skipped (and falls back)', () => {
  const noId = ask('x', 'projB', 'mara', 2); delete noId.id;
  const quoted = ask('q"2', 'projB', 'mara', 3);
  seed([ask('q1', 'projC', 'mara', 20), noId, quoted]);
  assert.deepEqual(messages.owedElsewhere('mara', 'projA', NOW), { id: 'q1', project: 'projC' });
});

