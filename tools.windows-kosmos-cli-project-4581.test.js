'use strict';
/* #4581: `kosmos project list` / `show` on the Windows CLI, the parity half of cli.project-show-4581.test.js. fetch
   is injected (tools.windows-kosmos-cli-570.test.js's harness); the renderer is the real engine/projectview.js. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');
const v = require('./engine/projectview');

const AGENT = 'ab'.repeat(32);
const BOARD = 'cd'.repeat(32);
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => BOARD, agentToken: (env) => (/^[0-9a-f]+$/.test(env.KOSMOS_AGENT_TOKEN || '') ? env.KOSMOS_AGENT_TOKEN : null) };
async function run(argv, answer) {
  const calls = []; const out = []; const err = [];
  const code = await cli.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: AGENT }, hook: hookStub,
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
/* Real member rows: fleet's cards through projects.describe, never hand-built (fixture-discipline). The data root
   is a temp folder, set before the engine is loaded. */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-project-4581-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
const projects = require('./engine/projects');
const fleet = require('./test-support/fleet');
const FLEET = fleet.install([fleet.agent('mark', { state: 'idle' }), fleet.agent('sam', { state: 'idle', runner: 'codex', command: 'node', screen: '\u203a Ask Codex to do anything' })]);
const RAW = { id: 'ff', name: 'Five Families', folder: 'C:\\p\\ff', agents: ['mark', 'sam'], tasks: [{ number: 1, sentence: 'rank', state: 'open' }] };
const DESCRIBED = projects.describe(RAW, FLEET.agents, [RAW]);
FLEET.restore();
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
const LIST = { projects: v.listOf([DESCRIBED]) };
const SHOW = { project: v.overviewOf(DESCRIBED, [], { folderOf: () => null, readBrief: () => ({ goal: null, done: null, found: false }) }) };

test('#4581 Windows project list and show: the routes, both tokens, the same words as the Mac', async () => {
  const l = await run(['project', 'list'], () => ({ body: LIST }));
  assert.equal(l.code, 0, l.err);
  assert.equal(l.calls[0].route, '/api/projects/overview');
  assert.equal(l.calls[0].method, 'GET');
  assert.equal(l.calls[0].headers['x-kosmos-agent-token'], AGENT, 'the agent\'s own token (#4491)');
  assert.equal(l.calls[0].headers['x-kosmos-board-token'], BOARD);
  assert.equal(l.out, v.renderList(LIST).join('\n'));
  const s = await run(['project', 'show', 'ff'], () => ({ body: SHOW }));
  assert.equal(s.code, 0, s.err);
  assert.equal(s.calls[0].route, '/api/project/ff/overview');
  assert.equal(s.out, v.renderShow(SHOW).join('\n'));
});

test('#4581 Windows show: a garbled id is refused, never stripped; an unknown one is the board\'s sentence', async () => {
  for (const dots of ['.', '..', '...']) {
    const d = await run(['project', 'show', dots], () => { throw new Error('no request may be made'); });
    assert.equal(d.code, 1, dots); assert.equal(d.calls.length, 0, dots);
  }
  const g = await run(['project', 'show', 'ff!!!'], () => { throw new Error('no request may be made'); });
  assert.equal(g.code, 1);
  assert.equal(g.calls.length, 0);
  assert.match(g.err, /there is no project by that name/);
  const u = await run(['project', 'show', 'nope'], () => ({ status: 404, body: { error: 'there is no project by that name' } }));
  assert.equal(u.code, 1);
  assert.match(u.err, /Kosmos refused that: there is no project by that name\./);
});

test('#4581 Windows usage and subcommands', async () => {
  assert.deepEqual(cli.SUBCOMMANDS.project, ['list', 'show', 'create']);
  for (const argv of [['project', 'list', 'x'], ['project', 'show'], ['project', 'show', 'a', 'b']]) {
    const r = await run(argv, () => { throw new Error('no request may be made'); });
    assert.equal(r.code, 2, argv.join(' '));
    assert.equal(r.calls.length, 0);
  }
});
