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
