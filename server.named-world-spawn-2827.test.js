'use strict';
/*
 * #2827 / world-guard-lift-1704: a board booted into a NAMED world runs its agents.
 *
 * #2849 refused every spawn route with a 409 on a named-world board, because an
 * agent's launch identity was not yet keyed by its Kosmos and a named world's agent
 * collided with Kosmos 1's. Both platforms are world-keyed now (#2845, #2874), so the
 * refusal is lifted: each spawn route must answer on a named-world board exactly as
 * it answers on the default world. The engine-level proof that every act lands on the
 * named world's own identity is engine/world-guard-lift-1704.test.js.
 *
 * Driven through the real routes on a sandboxed board. `worldenv.bootedWorld()` is
 * stubbed per request (the server reads it live), and KOSMOS_WORLD is set with it,
 * as a real boot into that world sets both.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-named-world-2827-'));
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_CODEX_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
// Sandbox Claude Code's own config: these routes can create an agent, which would
// otherwise read/write the operator's real ~/.claude.json (fixture-discipline
// enforces this for every suite that can create an agent).
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const { start, server } = require('./server');
const worldenv = require('./engine/worldenv');
const worlds = require('./engine/worlds');

let base;
const realBooted = worldenv.bootedWorld;
const savedWorld = process.env.KOSMOS_WORLD;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  worldenv.bootedWorld = realBooted;
  if (savedWorld === undefined) delete process.env.KOSMOS_WORLD; else process.env.KOSMOS_WORLD = savedWorld;
  try { server.closeAllConnections(); server.close(); } catch { /* going away */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

function bootInto(id) {
  worldenv.bootedWorld = () => id;
  if (id === worlds.DEFAULT_ID) delete process.env.KOSMOS_WORLD; else process.env.KOSMOS_WORLD = id;
}
async function post(route, body) {
  const res = await fetch(base + route, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/* The sentence #2849 answered with. It must never come back on any route. */
const OLD_REFUSAL = /named world, which does not run agents|does not run agents yet/i;

/* Each spawn route, with a request built per world so the two worlds never collide
   on a name (a second create of one name is refused for an unrelated reason). */
const SPAWN_ROUTES = [
  { what: 'create an agent', route: '/api/agents', body: (w) => ({ name: `rocky-${w}` }) },
  { what: 'create a team', route: '/api/team', body: (w) => ({ members: [{ name: `ta-${w}` }, { name: `tb-${w}` }] }) },
  { what: 'connect a discovered agent', route: '/api/connect-agent', body: () => ({ dir: path.join(SANDBOX, 'no-such-agent-folder') }) },
  { what: 'restore a removed agent', route: '/api/agent/nobody/restore', body: () => ({}) },
  { what: 'set agents to start on their own', route: '/api/register', body: () => ({}) },
];

for (const spec of SPAWN_ROUTES) {
  test(`${spec.route} (${spec.what}) answers on a NAMED-world board exactly as on Kosmos 1: no named-world refusal`, async () => {
    bootInto(worlds.DEFAULT_ID);
    const onDefault = await post(spec.route, spec.body('one'));
    bootInto('mars');
    const onNamed = await post(spec.route, spec.body('mars'));
    bootInto(worlds.DEFAULT_ID);

    assert.doesNotMatch(JSON.stringify(onNamed.body), OLD_REFUSAL, 'the #2849 refusal is back');
    assert.equal(onNamed.status, onDefault.status,
      `a named world answered ${onNamed.status} where Kosmos 1 answers ${onDefault.status}: ${JSON.stringify(onNamed.body)}`);
  });
}

test('the old refusal sentence is gone from server.js', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.doesNotMatch(src, OLD_REFUSAL);
});
