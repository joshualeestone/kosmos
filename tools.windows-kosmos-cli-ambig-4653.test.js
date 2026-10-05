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
