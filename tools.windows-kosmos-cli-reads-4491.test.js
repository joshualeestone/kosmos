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
  [['task', 'list', 'p4491'], '/api/tasks?project=p4491&order=state', { body: { tasks: [], count: 0 } }],
  [['task', 'activity', 'p4491', '1'], '/api/project/p4491/task/1/activity?words=1', { body: { events: [], count: 0 } }],   // #5874
  [['agent', 'roles'], '/api/roles?catalogue=1', { body: ROLES }],
  [['agent', 'list'], '/api/agents/list', { body: { agents: [] } }],   // #7748
  [['agent', 'role-draft'], '/api/roles', { body: ROLES }],
];

/* #7748: the Windows arms of the roles word, the agent list and the mkdir line. */
test('#7748 Windows agent roles takes one word, says when nothing matches, and refuses an option', async () => {
  const body = { roles: [{ key: 'pm', label: 'Project Manager', group: 'Core' }, { key: 'writer', label: 'Writer', group: 'Words' }] };
  const hit = await run(['agent', 'roles', 'writ'], () => ({ body }));
  assert.equal(hit.code, 0);
  assert.match(hit.out, /writer {2}Writer/);
  assert.doesNotMatch(hit.out, /Project Manager/);
  const miss = await run(['agent', 'roles', 'zebra'], () => ({ body }));
  assert.equal(miss.code, 1);
  assert.match(miss.out, /No role matches "zebra"/);
  const opt = await run(['agent', 'roles', '--x'], () => ({ body }));
  assert.equal(opt.code, 2);
  assert.doesNotMatch(opt.err, /put -- before it/);
});

test('#7748 Windows agent list says each agent and takes no words', async () => {
  const r = await run(['agent', 'list'], () => ({ body: { agents: [{ name: 'Ada', role: 'Writer', state: 'Not running' }] } }));
  assert.equal(r.code, 0);
  assert.match(r.out, /^Ada {2}Writer {2}Not running$/m);
  const roster = await run(['agent', 'list'], () => ({ body: { agents: [{ name: 'Ada', role: 'Writer' }] } }));
  assert.match(roster.out, /^Ada {2}Writer$/m, 'what an agent token gets: no third column');
  assert.equal((await run(['agent', 'list', 'x'], () => ({ body: { agents: [] } }))).code, 2);
  const partial = await run(['agent', 'list'], () => ({ body: { agents: [], partial: true } }));
  assert.match(partial.out, /may be incomplete/);
  assert.doesNotMatch(partial.out, /no agents/);
  const refused = await run(['agent', 'list'], () => ({ status: 500, body: { error: 'we could not read the agents just now' } }));
  assert.equal(refused.code, 1);
  assert.match(refused.err, /Kosmos could not list the agents: we could not read the agents just now\./);
});

test('#7748 Windows project create names the command for a missing folder', async () => {
  const r = await run(['project', 'create', 'P', 'C:\\a b'], () => ({ status: 400, body: { error: 'there is no folder at that path' } }));
  assert.equal(r.code, 1);
  assert.match(r.err, /mkdir "C:\\a b"/);
});

/* The CLIs match the board's sentence to add the hint, so a reworded sentence would drop it with every stub still green. */
test('#7748 both CLIs match the sentence the board really says', () => {
  const fs = require('node:fs');
  const said = /throw new Error\('(there is no folder at that path)'\)/.exec(fs.readFileSync(require.resolve('./engine/projects'), 'utf8'))[1];
  assert.ok(fs.readFileSync(require.resolve('./tools/windows/kosmos-cli'), 'utf8').includes(`=== '${said}'`));
  assert.ok(fs.readFileSync(require('node:path').join(__dirname, 'install', 'kosmos'), 'utf8').includes(`= "${said}"`));
});

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

test('CONTROL: a verb that still presents the board token alone (room reopen) sends no agent header', async () => {
  const r = await run(['room', 'reopen', 'p4491'], () => ({ body: { ok: true } }));
  assert.equal(r.calls.length, 1, r.err);
  assert.equal(r.calls[0].route, '/api/project/p4491/room/reopen');
  assert.equal(r.calls[0].headers['x-kosmos-agent-token'], undefined, 'so this harness can see a missing agent header, and the four reads above really send one');
  assert.equal(r.calls[0].headers['x-kosmos-board-token'], BOARD);
});
