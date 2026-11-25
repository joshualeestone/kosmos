'use strict';

/* kosmos#8548: the Windows `kosmos away [--hook]`, the twin of install/kosmos cmd_away. Driven through the CLI's own
   main() with an injected fetch, as the file-notices test does. */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');
const realHook = require('./engine/kosmos-report-hook');
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'BOARD8548', agentToken: realHook.agentToken };

const AGENT = 'ef'.repeat(16);
const HOOKJSON = JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'Kosmos: while this agent was not running x' } });
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

test('Windows kosmos away reads with a GET, the agent token and the text form, and prints it', async () => {
  const r = await run(['away'], () => ({ body: 'Nothing arrived for you while you were not running.\n' }));
  assert.equal(r.code, 0, r.err);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].route, '/api/away?as=text&from_pane=');
  assert.equal(r.calls[0].method, 'GET');
  assert.equal(r.calls[0].headers['x-kosmos-agent-token'], AGENT);
  assert.equal(r.out, 'Nothing arrived for you while you were not running.');
});

test('Windows --hook asks for the startup window, prints only the hook JSON on a 200, and exits 0 on every answer', async () => {
  const ok = await run(['away', '--hook'], () => ({ body: HOOKJSON }));
  assert.deepEqual([ok.code, ok.out], [0, HOOKJSON]);
  assert.equal(ok.calls[0].route, '/api/away?as=hook&at=startup&from_pane=');
  for (const a of [{ status: 403, body: HOOKJSON }, { body: 'not json' }, { body: '' }, { throws: true }]) {
    const r = await run(['away', '--hook'], () => a);
    assert.deepEqual([r.code, r.out], [0, ''], JSON.stringify(a));
  }
});

/* kosmos#9049: --hook --wait-only, as the Mac CLI; --wait-only alone is a usage error. */
test('Windows --hook --wait-only asks for the wait alone; --wait-only alone sends nothing', async () => {
  const ok = await run(['away', '--hook', '--wait-only'], () => ({ body: HOOKJSON }));
  assert.deepEqual([ok.code, ok.out], [0, HOOKJSON]);
  assert.equal(ok.calls[0].route, '/api/away?as=waithook&from_pane=');
  assert.equal((await run(['away', '--hook', '--wait-only'], () => ({ body: '{"pending":true}' }))).out, '{"pending":true}');
  assert.equal((await run(['away', '--hook'], () => ({ body: '{"pending":true}' }))).out, '');
  const bad = await run(['away', '--wait-only'], () => ({ body: '' }));
  assert.equal(bad.code, 2);
  assert.equal(bad.calls.length, 0);
});

test('Windows kosmos away --help prints the usage and sends nothing; a refusal exits 1; an unknown argument sends nothing', async () => {
  for (const args of [['away', '--help'], ['away', '-h']]) {
    const r = await run(args, () => ({ body: '' }));
    assert.equal(r.calls.length, 0, args.join(' '));
    assert.match(r.out + r.err, /Usage: kosmos away \[--hook \[--wait-only\]\]/, args.join(' '));
  }
  assert.equal((await run(['away'], () => ({ status: 403, body: 'refused\n' }))).code, 1);
  const bad = await run(['away', '--all'], () => ({ body: '' }));
  assert.equal(bad.code, 2);
  assert.equal(bad.calls.length, 0);
});
