'use strict';
/* kosmos#4926 N7 (still on 0.7.50, the Meta seat only): a post told to a member at its turn end "again as new" after it
   answered it. Two causes fit, and the board log could tell neither: the member answered without citing the post (so
   staleHeld never counts it answered), or something else re-told it. This diagnostic says, on each "told of" line, what
   the member had posted in the room after each post: cited, uncited, or none. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'roomhold-n7diag-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
const messages = require('./messages');
const roomhold = require('./roomhold');
const chat = require('./chat');

const P = 'proj-1';
const at = (m) => new Date(Date.UTC(2026, 9, 15, 12, m)).toISOString();
const LOG = [
  { kind: 'post', id: 'm1', project: P, from: 'ann', at: at(0), text: 'one' },
  { kind: 'post', id: 'm2', project: P, from: 'bob', at: at(1), text: 'two' },
  { kind: 'post', id: 'm3', project: P, from: 'ann', at: at(2), text: 'three' },
  { kind: 'post', id: 'm4', project: P, from: 'meta', at: at(3), text: 'answers m2', replyTo: 'm2' },
  { kind: 'post', id: 'm5', project: P, from: 'meta', at: at(4), text: 'a reply with no citation' },
  { kind: 'post', id: 'm6', project: P, from: 'ann', at: at(5), text: 'after meta spoke' },
  { kind: 'post', id: 'm9', project: 'other', from: 'meta', at: at(6), text: 'another room' },
];

test('#4926 N7: memberAfter says cited, uncited or none for each post, in its room only', () => {
  assert.deepEqual(messages.memberAfter(P, ['m1', 'm2', 'm3', 'm6', 'm404'], 'meta', LOG),
    { m1: 'uncited', m2: 'cited', m3: 'uncited', m6: 'none' });
  // CONTROL: a member who never posted has none for all; another room's post does not count.
  assert.deepEqual(messages.memberAfter(P, ['m1', 'm6'], 'zoe', LOG), { m1: 'none', m6: 'none' });
  assert.deepEqual(messages.memberAfter('other', ['m1'], 'meta', LOG), {}, 'a post of another room');
  assert.deepEqual(messages.memberAfter(P, ['m1'], 'meta', 'not a log'), {}, 'an unreadable log says nothing');
});

test('#4926 N7: the "told of" line says it; a refused one, or none given, says nothing more', () => {
  const told = roomhold.toldLine('meta', { n: 2, projectId: P, state: chat.DELIVERY.PLACED, after: { m1: 'uncited', m2: 'cited', bad: 'cited', m7: 'weird' } });
  assert.match(told, /told of 2 held post\(s\) in proj-1, delivery=placed, since each: m1 uncited, m2 cited\n$/);
  assert.match(roomhold.toldLine('meta', { n: 1, projectId: P, state: chat.DELIVERY.PLACED }), /delivery=placed\n$/, 'CONTROL: no diagnostic, no suffix');
  assert.doesNotMatch(roomhold.toldLine('meta', { n: 1, projectId: P, state: chat.DELIVERY.COULD_NOT, after: { m1: 'none' } }), /since each/);
});

test('#4926 N7: the idle flush asks afterOf for the ids it told and hands the answer on', async () => {
  roomhold.hold('meta', P, 'm1');
  roomhold.hold('meta', P, 'm3');
  const asked = [];
  const done = await roomhold.flushOnIdle('meta', {
    deliver: async () => ({ state: chat.DELIVERY.PLACED }), roster: [], DELIVERY: chat.DELIVERY, env: {},
    shownOf: () => 'Room', afterOf: (p, ids, who) => { asked.push([p, ids, who]); return { m1: 'uncited', m3: 'uncited' }; },
  });
  assert.deepEqual(asked, [[P, ['m1', 'm3'], 'meta']]);
  assert.deepEqual(done.map((d) => d.after), [{ m1: 'uncited', m3: 'uncited' }]);
  // CONTROL: without afterOf, the result has no `after`.
  roomhold.hold('meta', P, 'm6');
  const plain = await roomhold.flushOnIdle('meta', { deliver: async () => ({ state: chat.DELIVERY.PLACED }), roster: [], DELIVERY: chat.DELIVERY, env: {}, shownOf: () => 'Room' });
  assert.equal('after' in plain[0], false);
});

test('#4926 N7: both of the board\'s flushes (turn end and the timed retry) pass the diagnostic (source pin)', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const wired = SRC.split('afterOf: (p, ids, who2) => messages.memberAfter(p, ids, who2),').length - 1;
  assert.equal(wired, 2, 'the turn-end flush and flushReleased should each pass afterOf');
});
