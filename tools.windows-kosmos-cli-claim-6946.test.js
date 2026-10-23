'use strict';
/**
 * #6946: the Windows twin of `kosmos claim` (tools/windows/kosmos-cli.js verbClaim), against a scripted board, as
 * tools.windows-kosmos-cli-570.test.js tests the other verbs. Same words and exit codes as install/kosmos cmd_claim
 * (cli.claim-6946.test.js).
 *
 *   node --test tools.windows-kosmos-cli-claim-6946.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { PassThrough } = require('node:stream');

const cli = require('./tools/windows/kosmos-cli');

const AGENT = 'ab'.repeat(32);
const BOARD = 'cd'.repeat(32);
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => BOARD, agentToken: (env) => (/^[0-9a-f]+$/.test(env.KOSMOS_AGENT_TOKEN || '') ? env.KOSMOS_AGENT_TOKEN : null) };

/* Run one command against a scripted board. `answer(route, init)` returns
   { status, body } (an object is sent as JSON) or throws to simulate a failure. */
async function run(argv, answer, env, readStdin) {
  const calls = [];
  const out = [];
  const err = [];
  const code = await cli.main(argv, {
    env: env || { KOSMOS_AGENT_TOKEN: AGENT },
    hook: hookStub,
    readStdin,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    fetch: async (url, init) => {
      const route = url.replace('http://127.0.0.1:1', '');
      calls.push({ route, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) });
      const a = answer ? answer(route, init) : { status: 200, body: {} };
      const text = typeof a.body === 'string' ? a.body : JSON.stringify(a.body);
      return { status: a.status || 200, text: async () => text };
    },
  });
  return { code, calls, out: out.join('\n'), err: err.join('\n') };
}

const refusedWith = (e) => () => { throw e; };

test('claim: /api/react with claim, never an emoji, and the agent token; each answer in words', async () => {
  const r = await run(['claim', 'proj-1', 'm3'], () => ({ body: { ok: true, op: 'add', emoji: '\u{1F64B}' } }));
  assert.equal(r.code, 0);
  assert.equal(r.calls[0].route, '/api/react');
  assert.deepEqual(r.calls[0].body, { project: 'proj-1', of: 'm3', claim: 'claim', from_pane: '' });
  assert.equal(r.calls[0].headers['x-kosmos-agent-token'], AGENT);
  assert.equal(r.out, 'Claimed: that post is yours, and the room shows it. Say in the room what you are doing with it.');
  const again = await run(['claim', 'proj-1', 'm3'], () => ({ body: { ok: true, op: 'already' } }));
  assert.equal(again.code, 0);
  assert.equal(again.out, 'That post is already yours.');
});

test('claim --release: sent as release in either position; given back, or nothing to give back, both exit 0', async () => {
  for (const argv of [['claim', 'proj-1', 'm3', '--release'], ['claim', '--release', 'proj-1', 'm3']]) {
    const r = await run(argv, () => ({ body: { ok: true, op: 'remove' } }));
    assert.deepEqual(r.calls[0].body, { project: 'proj-1', of: 'm3', claim: 'release', from_pane: '' }, argv.join(' '));
    assert.equal(r.out, 'Gave that post back: it is no longer claimed by you.');
    assert.equal(r.code, 0);
  }
  const none = await run(['claim', 'proj-1', 'm3', '--release'], () => ({ body: { ok: true, op: 'none' } }));
  assert.equal(none.code, 0, 'a retried release that already landed must not read as a failure');
  assert.equal(none.out, 'That post is not claimed by you, so there was nothing to give back.');
  const held = await run(['claim', 'proj-1', 'm3', '--release'], () => ({ body: { ok: true, op: 'none', claimedBy: 'ann' } }));
  assert.equal(held.out, 'That post is not claimed by you, so there was nothing to give back. ann holds it.');
});

test('claim: a post somebody else holds exits 1 naming them; a refused release says it was not given back', async () => {
  const because = 'ann claimed that post 3 minutes ago, so do not post that you are taking it: read the room, and ask ann if you can help';
  const no = await run(['claim', 'proj-1', 'm3'], () => ({ body: { ok: false, claimedBy: 'ann', because } }));
  assert.equal(no.code, 1);
  assert.equal(no.err, 'Not claimed: ' + because + '.');
  const rel = await run(['claim', 'proj-1', 'm3', '--release'], () => ({ body: { ok: false, because: 'you are not on that project, so this room is not yours to react in' } }));
  assert.equal(rel.code, 1);
  assert.equal(rel.err, 'Not given back: you are not on that project, so this room is not yours to react in.');
});

test('claim: an answer with no ok field is not read as a refusal, and a missing post id is a usage error that sends nothing', async () => {
  const odd = await run(['claim', 'proj-1', 'm3'], () => ({ body: { something: 'else' } }));
  assert.equal(odd.code, 1);
  assert.match(odd.err, /we cannot tell whether the claim changed/);
  const e = await run(['claim', 'proj-1']);
  assert.equal(e.code, 2);
  assert.equal(e.calls.length, 0);
});

test('claim: a timeout says running it again is safe (a claim never toggles) and exits 3', async () => {
  const slow = await run(['claim', 'proj-1', 'm3'], refusedWith(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
  assert.equal(slow.code, 3);
  assert.equal(slow.err, 'Kosmos was slow to answer and we stopped waiting. Run the same command again: it is safe, and it says whether the claim is yours.');
});

test('#6952: kosmos react with a raised hand says it made a claim; control: another emoji says reacted', async () => {
  const hand = await run(['react', 'proj-1', 'm3', '\u{1F64B}\u{1F3FD}'], () => ({ body: { ok: true, op: 'add', emoji: '\u{1F64B}', of: 'm3' } }));
  assert.equal(hand.code, 0);
  assert.match(hand.out, /^Claimed: a raised hand is a claim/);
  const fire = await run(['react', 'proj-1', 'm3', '\u{1F525}'], () => ({ body: { ok: true, op: 'add', emoji: '\u{1F525}', of: 'm3' } }));
  assert.equal(fire.out, 'Reacted \u{1F525} to that post.');
});
