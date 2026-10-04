'use strict';

/* #4771: the Windows `kosmos project pause`, the twin of cli.project-pause-4771.test.js, driven through the CLI's own
   main() with an injected fetch (as the #4784 inbox test does). */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');
const realHook = require('./engine/kosmos-report-hook');
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'BOARD4771', agentToken: realHook.agentToken };

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

test('#4771 Windows: project pause PUTs {paused:true} with both tokens, and says who resumes it', async () => {
  const r = await run(['project', 'pause', 'p1'], () => ({ body: JSON.stringify({ project: { id: 'p1', paused: true } }) }));
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Paused p1\. Kosmos will not nudge anyone about its tasks or hand them out until it is resumed on the screen\. Do not resume it yourself\./);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].method, 'PUT');
  assert.equal(r.calls[0].route, '/api/project/p1');
  assert.deepEqual(JSON.parse(r.calls[0].body), { paused: true });
  assert.equal(r.calls[0].headers['x-kosmos-agent-token'], AGENT, 'without the agent token the board cannot tell it is an agent\'s pause');
  assert.equal(r.calls[0].headers['x-kosmos-board-token'], 'BOARD4771');
  // A 200 whose re-read came back empty still paused it (review 1).
  const empty = await run(['project', 'pause', 'p1'], () => ({ body: JSON.stringify({ project: null, agentsUnreadable: false }) }));
  assert.equal(empty.code, 0, empty.err);
  // Token-only agents too: the board token opens this route, so it rides whatever the switch says (as create).
  const only = await run(['project', 'pause', 'p1'], () => ({ body: JSON.stringify({ project: { id: 'p1' } }) }), { KOSMOS_AGENT_TOKEN_ONLY: '1' });
  assert.equal(only.calls[0].headers['x-kosmos-board-token'], 'BOARD4771');
});

test('#4771 Windows: a refusal says the board\'s reason and exits 1; bad calls and resume send nothing', async () => {
  const refused = await run(['project', 'pause', 'nosuch'], () => ({ status: 404, body: JSON.stringify({ error: 'there is no project by that name' }) }));
  assert.equal(refused.code, 1);
  assert.match(refused.err, /could not pause that project: there is no project by that name/);
  for (const [argv, code] of [[['project', 'pause'], 2], [['project', 'pause', 'a', 'b'], 2], [['project', 'resume', 'p1'], 2], [['project', 'unpause', 'p1'], 2],
    [['project', 'pause', '..'], 1], [['project', 'pause', 'bad id!'], 1], [['project', 'pause', 'my proj'], 1]]) {
    const r = await run(argv, () => ({ body: '{}' }));
    assert.equal(r.code, code, argv.join(' ') + ': ' + r.err);
    assert.equal(r.calls.length, 0, argv.join(' ') + ' sent a request');
  }
});
