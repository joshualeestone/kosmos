'use strict';
/* #4491 slice 5: the Windows CLI's `kosmos task add` and `kosmos task close` present the agent's own token as well as
   the board token, the parity half of cli.agent-token-verbs-4491.test.js. fetch is injected
   (tools.windows-kosmos-cli-reads-4491.test.js's harness); the token check is the hook's real one. */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');
const realHook = require('./engine/kosmos-report-hook');

const AGENT = 'ab'.repeat(32);
const BOARD = 'cd'.repeat(32);
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => BOARD, agentToken: realHook.agentToken };
async function run(argv, answer, env = { KOSMOS_AGENT_TOKEN: AGENT }) {
  const calls = []; const out = []; const err = [];
  const code = await cli.main(argv, {
    env, hook: hookStub,
    out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: async (url, init) => {
      const route = url.replace('http://127.0.0.1:1', '');
      calls.push({ route, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
      const a = answer(route);
      return { status: a.status || 200, text: async () => (typeof a.body === 'string' ? a.body : JSON.stringify(a.body)) };
    },
  });
  return { code, calls, out: out.join('\n'), err: err.join('\n') };
}

const WRITES = [
  [['task', 'add', 'p4491', 'write the docs'], '/api/project/p4491/tasks', { body: { task: { number: 1 } } }],
  [['task', 'close', 'p4491', '1'], '/api/project/p4491/task/1/close', { body: { task: { number: 1, state: 'closed' } } }],
];

for (const [argv, route, answer] of WRITES) {
  test(`#4491 Windows kosmos ${argv.slice(0, 2).join(' ')} presents the agent's own token and still the board token`, async () => {
    const r = await run(argv, () => answer);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.calls.length, 1, 'one request');
    assert.equal(r.calls[0].route, route);
    assert.equal(r.calls[0].method, 'POST');
    assert.equal(r.calls[0].headers['x-kosmos-agent-token'], AGENT, 'the agent\'s own token (#4491 slice 5)');
    assert.equal(r.calls[0].headers['x-kosmos-board-token'], BOARD, 'the board token is still sent (dropping it is a later slice)');
  });

  test(`#4491 Windows kosmos ${argv.slice(0, 2).join(' ')} sends no agent header when the launch gave none or a junk one`, async () => {
    for (const env of [{}, { KOSMOS_AGENT_TOKEN: 'not-hex; rm -rf' }, { KOSMOS_AGENT_TOKEN: '' }]) {
      const r = await run(argv, () => answer, env);
      assert.equal(r.calls.length, 1);
      assert.equal(r.calls[0].headers['x-kosmos-agent-token'], undefined, 'forwarded ' + JSON.stringify(env));
      assert.equal(r.calls[0].headers['x-kosmos-board-token'], BOARD);
    }
  });

  test(`#4491 Windows kosmos ${argv.slice(0, 2).join(' ')} prints the board's refusal for an agent that is not on the project, and exits 1`, async () => {
    const verb = argv[1] === 'add' ? 'add tasks to it' : 'close its tasks';
    const r = await run(argv, () => ({ status: 403, body: { error: 'that agent is not on this project, so it cannot ' + verb } }));
    assert.equal(r.code, 1);
    assert.match(r.err, new RegExp('that agent is not on this project, so it cannot ' + verb));
  });
}

/* Slice 5b: project create presents the agent's own token too, so the board names the maker and puts it on the
   project. The board token is still what opens the route. */
test('#4491 Windows kosmos project create presents the agent\'s own token and still the board token', async () => {
  const okBody = { project: { id: 'my-project' }, told: [], id: 'my-project', agentsUnreadable: false };
  const r = await run(['project', 'create', 'My Project', 'C:\\p\\mp'], () => ({ body: okBody }));
  assert.equal(r.code, 0, r.err);
  assert.equal(r.calls[0].route, '/api/projects');
  assert.equal(r.calls[0].headers['x-kosmos-agent-token'], AGENT);
  assert.equal(r.calls[0].headers['x-kosmos-board-token'], BOARD);
  for (const env of [{}, { KOSMOS_AGENT_TOKEN: 'not-hex; rm -rf' }, { KOSMOS_AGENT_TOKEN: '' }]) {
    const none = await run(['project', 'create', 'My Project', 'C:\\p\\mp'], () => ({ body: okBody }), env);
    assert.equal(none.calls[0].headers['x-kosmos-agent-token'], undefined, 'forwarded ' + JSON.stringify(env));
    assert.equal(none.calls[0].headers['x-kosmos-board-token'], BOARD);
  }
});

