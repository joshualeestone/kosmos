'use strict';
/* #4491 slice 7: the Windows CLI's half of KOSMOS_AGENT_TOKEN_ONLY (cli.agent-token-verbs-4491.test.js is the Mac's).
   With the switch exactly '1' and a usable agent token, an agent's everyday verb sends that token alone and does not
   read the board token; the person's verbs keep the board token whatever the switch says. fetch and the hook are
   injected (tools.windows-kosmos-cli-reads-4491.test.js's harness); the agent-token rule is the REAL one. */
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');
const realHook = require('./engine/kosmos-report-hook');

const AGENT = 'ab'.repeat(32);
const BOARD = 'cd'.repeat(32);

async function run(argv, env) {
  const calls = [];
  let boardReads = 0;
  const hook = {
    resolveUrl: () => 'http://127.0.0.1:1',
    readBoardToken: () => { boardReads += 1; return BOARD; },
    agentToken: realHook.agentToken,
  };
  await cli.main(argv, {
    env, hook,
    out: () => {}, err: () => {},
    fetch: async (url, init) => {
      calls.push({ route: url.replace('http://127.0.0.1:1', ''), headers: init.headers });
      return { status: 200, text: async () => JSON.stringify({ ok: true, delivery: { state: 'placed' }, tasks: [], count: 0, roles: [], projects: [] }) };
    },
  });
  return { calls, boardReads };
}

/* [argv, the route its first request goes to] */
const AGENT_VERBS = [
  [['msg', 'mara', 'hello'], '/api/msg'],
  [['reply', 'hello'], '/api/reply'],
  [['post', 'p4491', 'hello'], '/api/post'],
  [['react', 'p4491', 'm1', 'thumbsup'], '/api/react'],
  [['report', 'working', 'on it'], '/api/report'],
  [['whoami'], '/api/whoami'],
  [['room', 'p4491'], '/api/project/p4491/room?as=text'],
  [['task', 'list', 'p4491'], '/api/tasks?project=p4491'],
  [['task', 'add', 'p4491', 'write the docs'], '/api/project/p4491/tasks'],
  [['task', 'close', 'p4491', '1'], '/api/project/p4491/task/1/close'],
  [['task', 'message', 'p4491', '1', 'hello'], '/api/project/p4491/task/1/message'],
  [['agent', 'roles'], '/api/roles?catalogue=1'],
  [['project', 'list'], '/api/projects/overview'],
];
const PERSON_VERBS = [
  [['project', 'create', 'My Project', 'C:\\kosmos-4491-no-such-folder'], '/api/projects'],
  [['community', 'post', 'hello'], '/api/community/post'],
  [['community', 'read'], '/api/community/read'],
  [['room', 'reopen', 'p4491'], '/api/project/p4491/room/reopen'],
];
const name = (argv) => argv.filter((a) => /^[a-z-]+$/.test(a)).slice(0, 2).join(' ');

for (const [argv, route] of AGENT_VERBS) {
  test(`#4491 slice 7, Windows: token-only kosmos ${name(argv)} sends the agent's token alone and never reads the board token`, async () => {
    /* CONTROL: the switch off sends both, so the absence below is the switch and not a verb that never sent it. */
    const off = await run(argv, { KOSMOS_AGENT_TOKEN: AGENT });
    assert.ok(off.calls.length >= 1, 'kosmos ' + name(argv) + ' made no request');
    assert.equal(off.calls[0].route, route);
    assert.deepEqual([off.calls[0].headers['x-kosmos-agent-token'], off.calls[0].headers['x-kosmos-board-token']], [AGENT, BOARD], 'control: the switch off did not send both');
    const on = await run(argv, { KOSMOS_AGENT_TOKEN: AGENT, KOSMOS_AGENT_TOKEN_ONLY: '1' });
    assert.equal(on.calls[0].route, route);
    assert.equal(on.calls[0].headers['x-kosmos-agent-token'], AGENT);
    assert.equal(on.calls[0].headers['x-kosmos-board-token'], undefined, 'token-only: the board token was still sent');
    assert.equal(on.boardReads, 0, 'token-only: the board token was read although nothing sent it');
  });

  test(`#4491 slice 7, Windows: kosmos ${name(argv)} keeps the board token with no usable agent token, or a switch that is not exactly 1`, async () => {
    for (const env of [{ KOSMOS_AGENT_TOKEN_ONLY: '1' }, { KOSMOS_AGENT_TOKEN_ONLY: '1', KOSMOS_AGENT_TOKEN: 'not-hex; rm -rf' },
      { KOSMOS_AGENT_TOKEN: AGENT, KOSMOS_AGENT_TOKEN_ONLY: 'true' }, { KOSMOS_AGENT_TOKEN: AGENT, KOSMOS_AGENT_TOKEN_ONLY: ' 1' }]) {
      const r = await run(argv, env);
      assert.equal(r.calls[0].headers['x-kosmos-board-token'], BOARD, 'dropped the board token for ' + JSON.stringify(env));
    }
  });
}

for (const [argv, route] of PERSON_VERBS) {
  test(`#4491 slice 7, Windows: kosmos ${name(argv)} is the person's and keeps the board token when the switch is on`, async () => {
    const r = await run(argv, { KOSMOS_AGENT_TOKEN: AGENT, KOSMOS_AGENT_TOKEN_ONLY: '1' });
    assert.ok(r.calls.length >= 1, 'kosmos ' + name(argv) + ' made no request');
    assert.equal(r.calls[0].route.split('?')[0], route);
    assert.equal(r.calls[0].headers['x-kosmos-board-token'], BOARD, 'token-only: the person\'s verb lost the board token that opens its route');
  });
}
