'use strict';

/* kosmos#4784: the Windows `kosmos inbox`, the twin of install/kosmos cmd_inbox (review 2: it had no behavioural
   test). Driven through the CLI's own main() with an injected fetch, as the #4491 reads test does. */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');
const realHook = require('./engine/kosmos-report-hook');
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'BOARD4784', agentToken: realHook.agentToken };

const AGENT = 'ef'.repeat(16);
async function run(argv, answer) {
  const calls = []; const out = []; const err = [];
  const code = await cli.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: AGENT },
    hook: hookStub,
    out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: async (url, init) => {
      calls.push({ route: url.replace('http://127.0.0.1:1', ''), method: init.method, headers: init.headers });
      const a = answer();
      return { status: a.status || 200, text: async () => a.body };
    },
  });
  return { code, calls, out: out.join('\n'), err: err.join('\n') };
}

test('#4784 Windows kosmos inbox asks for the text form with the agent token and prints it', async () => {
  const r = await run(['inbox', '--limit', '3'], () => ({ body: 'x the person: hello\n' }));
  assert.equal(r.code, 0, r.err);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].route, '/api/inbox?as=text&limit=3&from_pane=');
  assert.equal(r.calls[0].method, 'GET');
  assert.equal(r.calls[0].headers['x-kosmos-agent-token'], AGENT);
  assert.equal(r.out, 'x the person: hello');
});

test('#4784 Windows kosmos inbox: a refusal exits 1, and a bad limit sends nothing', async () => {
  const refused = await run(['inbox'], () => ({ status: 403, body: 'this board only shows an agent its messages with its own agent token\n' }));
  assert.equal(refused.code, 1);
  for (const bad of [['inbox', '--limit', '0'], ['inbox', '--limit', '51'], ['inbox', '--limit'], ['inbox', 'extra']]) {
    const r = await run(bad, () => ({ body: '' }));
    assert.equal(r.code, 2, bad.join(' '));
    assert.equal(r.calls.length, 0, bad.join(' ') + ' sent a request');
  }
});
