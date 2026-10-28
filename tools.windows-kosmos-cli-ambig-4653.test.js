'use strict';
/**
 * #4653 on Windows: `kosmos post` prints the board's ambiguousNote after its verdict, like install/kosmos,
 * so a Windows agent whose @-word named two members is told it reached neither.
 *
 *   node --test tools.windows-kosmos-cli-ambig-4653.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');

const AGENT = 'ab'.repeat(32);
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'cd'.repeat(32), agentToken: () => AGENT };
const NOTE = '@Sub-Zero could mean Sub Zero (@frost) or Sub-Zero (@subzero), so it reached neither as a request. To ask one of them, use the exact name, like @frost.';

async function post(delivery) {
  const out = []; const err = [];
  const code = await cli.main(['post', 'proj', '@Sub-Zero look'], {
    env: { KOSMOS_AGENT_TOKEN: AGENT }, hook: hookStub,
    out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: async () => ({ status: 200, text: async () => JSON.stringify({ delivery }) }),
  });
  return { code, out, err };
}

test('#4653: a placed post prints the verdict, then the note, and exits 0', async () => {
  const r = await post({ state: 'placed', id: 'm1', outcomes: {}, ambiguousNote: NOTE });
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, ['Posted to proj. Everyone on it has it waiting.', NOTE]);
});

test('#4653: an unconfirmed post says it too and keeps exit 3', async () => {
  const r = await post({ state: 'unconfirmed', because: 'one pane did not answer', id: 'm1', outcomes: {}, ambiguousNote: NOTE });
  assert.equal(r.code, 3);
  assert.equal(r.err[r.err.length - 1], NOTE);
});

test('#4653 control: no note, or an empty or non-string one, prints only the verdict', async () => {
  for (const extra of [{}, { ambiguousNote: '' }, { ambiguousNote: { x: 1 } }]) {
    const r = await post({ state: 'placed', id: 'm1', outcomes: {}, ...extra });
    assert.equal(r.code, 0);
    assert.deepEqual(r.out, ['Posted to proj. Everyone on it has it waiting.'], JSON.stringify(extra));
  }
});

test('kosmos#7246 slice 2: a post that left members quiet says so and how to address one; a because is printed', async () => {
  const r = await post({ state: 'placed', outcomes: { mara: 'placed', april: 'quiet' } });
  assert.equal(r.out[0], 'Posted to proj. It reached only the members it addresses; the others can read it in the room. To reach someone, start with \'YourName -> Their Name:\', @-name them, or use @all.');
  const paused = await post({ state: 'placed', outcomes: { mara: 'quiet' }, because: 'your post is in the room, but it woke no one' });
  assert.deepEqual(paused.out, ['Posted to proj.', 'Note: your post is in the room, but it woke no one.'], 'round 4: a paused post DID address them; no advice to address');
  const all = await post({ state: 'placed', outcomes: { mara: 'placed', april: 'placed' } });
  assert.deepEqual(all.out, ['Posted to proj. Everyone on it has it waiting.'], 'CONTROL: nobody quiet, the old sentence');
});

test('kosmos#7246 round 5: a post that woke no one says so, and a folded retry of a quiet post never says everyone has it', async () => {
  const none = await post({ state: 'placed', outcomes: { mara: 'quiet', april: 'quiet' } });
  assert.equal(none.out[0], 'Posted to proj. It woke no one: it addresses no member, so it is only in the room. To reach someone, start with \'YourName -> Their Name:\', @-name them, or use @all.');
  const dup = await post({ state: 'placed', outcomes: { mara: 'placed', april: 'quiet' }, duplicate: true });
  assert.match(dup.out[0], /It reached only the members it addresses/);
  const dupAll = await post({ state: 'placed', outcomes: { mara: 'placed' }, duplicate: true });
  assert.match(dupAll.out[0], /it was not posted twice/, 'CONTROL: a folded post that reached everyone keeps its sentence');
});

test('kosmos#7414: an unconfirmed post names who is not confirmed and who was not reached, and says nothing is lost', async () => {
  const r = await post({ state: 'unconfirmed', because: null, id: 'm1', outcomes: { mara: 'placed', april: 'unconfirmed', leo: 'could_not', kit: 'unconfirmed' }, text: 'x' });
  assert.equal(r.code, 3);
  assert.deepEqual(r.err, [
    "Posted, but not everyone is confirmed.",
    "Kosmos may have typed it in, but could not confirm it, for: april, kit. It may well have arrived.",
    "Not reached: leo. Kosmos could not type into their session, so they will see it only when they read the room (kosmos room proj).",
    "To reach one of them sooner, message them directly (it goes to them alone): kosmos msg leo \"...\"",
    "If that fails too, they are not running: start them, then message them.",
    "Nothing is lost: the post is in the room for every member, so each of them can read it there. Do not re-post: anyone who has it could get it twice."
]);
});

test('kosmos#7414: only a post the room could not record is said to be missing from the room', async () => {
  const unrec = await post({ state: 'unconfirmed', because: 'it reached the room but could not be recorded', unrecorded: true, id: 'm1', outcomes: { mara: 'placed' }, text: 'x' });
  assert.deepEqual(unrec.err, ['Posted, but not everyone is confirmed: it reached the room but could not be recorded.', "It is not in the room: the room could not record it. Do not re-post: anyone it reached could get it twice."]);
  // A folded retry and a paused room carry a reason too, and those posts ARE in the room.
  for (const because of ["this was sent a moment ago and was not confirmed then", 'your post is in the room, but it woke no one']) {
    const r = await post({ state: 'unconfirmed', because, id: 'm1', outcomes: { mara: 'unconfirmed' }, duplicate: true, text: 'x' });
    assert.equal(r.err.at(-1), "Nothing is lost: the post is in the room for every member, so each of them can read it there. Do not re-post: anyone who has it could get it twice.", because);
  }
  // A twin can answer with no outcomes at all: no name lists, and still nothing lost.
  for (const outcomes of [null, {}]) {
    const r = await post({ state: 'unconfirmed', because: null, id: 'm1', outcomes, text: 'x' });
    assert.deepEqual(r.err, ['Posted, but not everyone is confirmed.', "Nothing is lost: the post is in the room for every member, so each of them can read it there. Do not re-post: anyone who has it could get it twice."], JSON.stringify(outcomes));
  }
  // A reason with the mark false is read as in the room.
  {
    const r = await post({ state: 'unconfirmed', because: 'x', id: 'm1', outcomes: {}, unrecorded: false, text: 'y' });
    assert.equal(r.err.at(-1), 'Nothing is lost: the post is in the room for every member, so each of them can read it there. Do not re-post: anyone who has it could get it twice.');
  }
  // Documentation more than a control: the board escapes a post's quotes, so its text can never hold the mark.
  const spoof = await post({ state: 'unconfirmed', because: 'x', id: 'm1', outcomes: {}, text: '","unrecorded":true' });
  assert.equal(spoof.err.at(-1), "Nothing is lost: the post is in the room for every member, so each of them can read it there. Do not re-post: anyone who has it could get it twice.");
});

test('kosmos#7414 review 3: a member not reached for a post the room could not record is told they have no copy', async () => {
  const r = await post({ state: 'unconfirmed', because: 'it reached the room but could not be recorded', unrecorded: true, id: 'm1', outcomes: { mara: 'placed', leo: 'could_not' }, text: 'x' });
  assert.equal(r.code, 3);
  assert.deepEqual(r.err, [
    'Posted, but not everyone is confirmed: it reached the room but could not be recorded.',
    'Not reached: leo. Kosmos could not type into their session and the room could not record it, so they do not have it.',
    'Message them directly (it goes to them alone): kosmos msg leo "..."',
    'If that fails too, they are not running: start them, then message them.',
    'It is not in the room: the room could not record it. Do not re-post: anyone it reached could get it twice.',
  ]);
});
