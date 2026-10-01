'use strict';
/* #4491 slice 4: the Windows CLI's reads (`kosmos room`, `kosmos task list`, `kosmos agent roles`,
   `kosmos agent role-draft`) present the agent's own token as well as the board token, the parity half of
   cli.agent-token-verbs-4491.test.js. fetch is injected (tools.windows-kosmos-cli-project-4581.test.js's harness). */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');

const AGENT = 'ab'.repeat(32);
const BOARD = 'cd'.repeat(32);
/* The REAL token check (engine/kosmos-report-hook.js agentToken), so the junk-token test below judges the rule the
   CLI ships with, not a copy of it written here. */
const realHook = require('./engine/kosmos-report-hook');
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => BOARD, agentToken: realHook.agentToken };
async function run(argv, answer, env = { KOSMOS_AGENT_TOKEN: AGENT }) {
  const calls = []; const out = []; const err = [];
  const code = await cli.main(argv, {
    env, hook: hookStub,
    out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: async (url, init) => {
      const route = url.replace('http://127.0.0.1:1', '');
      calls.push({ route, method: init.method, headers: init.headers });
      const a = answer(route);
      return { status: a.status || 200, text: async () => (typeof a.body === 'string' ? a.body : JSON.stringify(a.body)) };
    },
  });
  return { code, calls, out: out.join('\n'), err: err.join('\n') };
}

const ROLES = { roles: [{ key: 'builder', label: 'Builder' }], own: { instructions: 'You are {{NAME}}.' } };
const READS = [
  [['room', 'p4491'], '/api/project/p4491/room?as=text', { body: 'nothing here yet\n' }],
  [['task', 'list', 'p4491'], '/api/tasks?project=p4491', { body: { tasks: [], count: 0 } }],
  [['agent', 'roles'], '/api/roles?catalogue=1', { body: ROLES }],
  [['agent', 'role-draft'], '/api/roles', { body: ROLES }],
];

for (const [argv, route, answer] of READS) {
  test(`#4491 Windows kosmos ${argv.slice(0, argv[0] === 'room' ? 1 : 2).join(' ')} reads with the agent's own token and still the board token`, async () => {
    const r = await run(argv, () => answer);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.calls.length, 1, 'one request');
    assert.equal(r.calls[0].route, route);
    assert.equal(r.calls[0].method, 'GET');
    assert.equal(r.calls[0].headers['x-kosmos-agent-token'], AGENT, 'the agent\'s own token (#4491 slice 4)');
    assert.equal(r.calls[0].headers['x-kosmos-board-token'], BOARD, 'the board token is still sent (dropping it is a later slice)');
  });

  test(`#4491 Windows kosmos ${argv.slice(0, argv[0] === 'room' ? 1 : 2).join(' ')} sends no agent header when the launch gave none or a junk one`, async () => {
    for (const env of [{}, { KOSMOS_AGENT_TOKEN: 'not-hex; rm -rf' }, { KOSMOS_AGENT_TOKEN: '' }]) {
      const r = await run(argv, () => answer, env);
      assert.equal(r.calls.length, 1);
      assert.equal(r.calls[0].headers['x-kosmos-agent-token'], undefined, 'forwarded ' + JSON.stringify(env));
      assert.equal(r.calls[0].headers['x-kosmos-board-token'], BOARD);
    }
  });
}

test('CONTROL: a verb that still presents the board token alone (project create) sends no agent header', async () => {
  const r = await run(['project', 'create', 'My Project', '/tmp/mp'], () => ({ body: { project: { id: 'my-project' }, told: [], id: 'my-project', agentsUnreadable: false } }));
  assert.equal(r.calls.length, 1, r.err);
  assert.equal(r.calls[0].route, '/api/projects');
  assert.equal(r.calls[0].headers['x-kosmos-agent-token'], undefined, 'so this harness can see a missing agent header, and the four reads above really send one');
  assert.equal(r.calls[0].headers['x-kosmos-board-token'], BOARD);
});
