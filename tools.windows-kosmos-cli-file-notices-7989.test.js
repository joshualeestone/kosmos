'use strict';

/* kosmos#7989 slice 3: the Windows `kosmos file-notices [--hook]`, the twin of install/kosmos cmd_file_notices. Driven
   through the CLI's own main() with an injected fetch, as the inbox test does. */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');
const realHook = require('./engine/kosmos-report-hook');
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'BOARD7989', agentToken: realHook.agentToken };

const AGENT = 'ef'.repeat(16);
const HOOKJSON = JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'Kosmos file-owner notice' } });
async function run(argv, answer) {
  const calls = []; const out = []; const err = [];
  const code = await cli.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: AGENT },
    hook: hookStub,
    out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: async (url, init) => {
      calls.push({ route: url.replace('http://127.0.0.1:1', ''), method: init.method, headers: init.headers });
      const a = answer();
      if (a.throws) throw new Error('ECONNREFUSED');
      return { status: a.status || 200, text: async () => a.body };
    },
  });
  return { code, calls, out: out.join('\n'), err: err.join('\n') };
}

test('Windows kosmos file-notices takes with a POST, the agent token and the text form, and prints it', async () => {
  const r = await run(['file-notices'], () => ({ body: 'No file notices are waiting for you.\n' }));
  assert.equal(r.code, 0, r.err);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].route, '/api/file-notices/take?as=text&from_pane=');
  assert.equal(r.calls[0].method, 'POST');
  assert.equal(r.calls[0].headers['x-kosmos-agent-token'], AGENT);
  assert.equal(r.out, 'No file notices are waiting for you.');
});

test('Windows --hook prints only the hook JSON on a 200, and exits 0 on every answer', async () => {
  const ok = await run(['file-notices', '--hook'], () => ({ body: HOOKJSON }));
  assert.deepEqual([ok.code, ok.out], [0, HOOKJSON]);
  assert.equal(ok.calls[0].route, '/api/file-notices/take?as=hook&from_pane=');
  for (const a of [{ status: 403, body: HOOKJSON }, { body: 'not json' }, { body: '' }, { throws: true }]) {
    const r = await run(['file-notices', '--hook'], () => a);
    assert.deepEqual([r.code, r.out], [0, ''], JSON.stringify(a));
  }
});

test('Windows kosmos file-notices: a refusal exits 1, and an unknown argument sends nothing', async () => {
  const refused = await run(['file-notices'], () => ({ status: 403, body: 'refused\n' }));
  assert.equal(refused.code, 1);
  const bad = await run(['file-notices', '--all'], () => ({ body: '' }));
  assert.equal(bad.code, 2);
  assert.equal(bad.calls.length, 0);
});
