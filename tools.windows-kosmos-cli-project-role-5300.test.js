'use strict';

/* #5300: the Windows `kosmos project role`, the twin of cli.project-role-5300.test.js, driven through the CLI's own
   main() with an injected fetch (as the #4771 pause test does). */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');
const realHook = require('./engine/kosmos-report-hook');
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'BOARD5300', agentToken: realHook.agentToken };

const AGENT = 'cd'.repeat(16);
async function run(argv, answer, env) {
  const calls = []; const out = []; const err = [];
  const code = await cli.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: AGENT, ...(env || {}) },
    hook: hookStub,
    out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: async (url, init) => {
      calls.push({ route: url.replace('http://127.0.0.1:1', ''), method: init.method, body: init.body, headers: init.headers });
      const a = answer();
      return { status: a.status || 200, text: async () => a.body };
    },
  });
  return { code, calls, out: out.join('\n'), err: err.join('\n') };
}

test('#5300 Windows: project role POSTs the words with the agent token, set and cleared', async () => {
  const r = await run(['project', 'role', 'p1', 'Researcher'], () => ({ body: JSON.stringify({ ok: true, role: 'Researcher' }) }));
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Set your role on p1\. kosmos project show p1 prints it beside your name\./);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].method, 'POST');
  assert.equal(r.calls[0].route, '/api/project/p1/role');
  assert.deepEqual(JSON.parse(r.calls[0].body), { role: 'Researcher' });
  assert.equal(r.calls[0].headers['x-kosmos-agent-token'], AGENT);
  const c = await run(['project', 'role', 'p1', ''], () => ({ body: JSON.stringify({ ok: true, role: null }) }));
  assert.equal(c.code, 0, c.err);
  assert.match(c.out, /Cleared your role on p1\./);
});

test('#5300 Windows: a refusal says the board\'s reason; bad calls are refused before any request', async () => {
  const no = await run(['project', 'role', 'p1', 'Writer'], () => ({ status: 403, body: JSON.stringify({ error: 'that agent is not on this project' }) }));
  assert.equal(no.code, 1);
  assert.match(no.err, /did not set that role: that agent is not on this project/);
  for (const [args, code] of [[['project', 'role', 'p1'], 2], [['project', 'role', 'p1', 'a', 'b'], 2], [['project', 'role', 'bad id!', 'x'], 1], [['project', 'role', 'p1', '--clear'], 2]]) {
    const r = await run(args, () => ({ body: '{}' }));
    assert.equal(r.code, code, args.join(' ') + ': ' + r.err);
    assert.equal(r.calls.length, 0, args.join(' ') + ' reached the board');
  }
  // The option refusal says what the Mac says: the sentence, then the usage line (the shared refuseOption).
  const opt = await run(['project', 'role', 'p1', '--clear'], () => ({ body: '{}' }));
  assert.match(opt.err, /--clear is not an option of kosmos project role, so nothing was done\.\nUsage: kosmos project role <project-id> "<what you do here>"/, opt.err);
});
