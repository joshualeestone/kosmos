'use strict';
/*
 * #2827: named (non-default) worlds do not run agents in v1, so the two spawn routes
 * -- POST /api/agents and POST /api/team -- refuse when the board is BOOTED into a
 * named world, before writing anything. engine/worlds.js scopes named-world agents
 * out (DATA/WORKERS/PROJECTS are redirected but LAUNCH is not), so an agent created
 * there has a board token that is refused and its reports/replies fail; the guard
 * prevents that broken state.
 *
 * Driven through the real routes on a sandboxed board. `worldenv.bootedWorld()` is
 * stubbed per-test (the server reads it live on each request), so no worlds.json /
 * env gymnastics are needed. Restoring it proves the guard is CONDITIONAL: on the
 * default world the same request sails past the guard (and is refused, if at all, for
 * an unrelated reason -- never with the named-world message).
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

const { start, server } = require('./server');
const worldenv = require('./engine/worldenv');
const worlds = require('./engine/worlds');

let base;
const realBooted = worldenv.bootedWorld;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  worldenv.bootedWorld = realBooted;
  try { server.closeAllConnections(); server.close(); } catch { /* going away */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const post = (route, body) => fetch(base + route, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
});
const stubBooted = (id) => { worldenv.bootedWorld = () => id; };

const NAMED_MSG = /named world, which does not run agents yet/i;

test('POST /api/agents in a named world is refused (409) before any agent is written', async () => {
  stubBooted('mars');
  const res = await post('/api/agents', { name: 'rocky' });
  assert.equal(res.status, 409, 'a named-world spawn is a state conflict');
  const body = await res.json();
  assert.match(String(body.error || ''), NAMED_MSG, 'the message names the cause and the remedy');
  // Nothing was written: the guard returns before createAgent. The workers dir holds
  // no agent folder for the refused name.
  const workerDir = path.join(SANDBOX, 'workers', 'rocky');
  assert.equal(fs.existsSync(workerDir), false, 'the refused agent left no worker directory');
});

test('POST /api/team in a named world is refused (409) before any team is spawned', async () => {
  stubBooted('mars');
  const res = await post('/api/team', { members: [{ name: 'a' }, { name: 'b' }] });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(String(body.error || ''), NAMED_MSG);
});

test('CONTROL: the DEFAULT world (bootedWorld = DEFAULT_ID) is allowed past the guard', async () => {
  stubBooted(worlds.DEFAULT_ID);
  const res = await post('/api/agents', { name: 'defaultworldagent' });
  // The guard does not fire on the default world: the response is NOT the named-world
  // 409. It may still be refused downstream (no connectable account in the sandbox),
  // but never with the named-world message -- that is what proves the guard is gated.
  assert.notEqual(res.status, 409, 'the default world is not a named-world conflict');
  const body = await res.json().catch(() => ({}));
  assert.doesNotMatch(String(body.error || ''), NAMED_MSG, 'the default world never gets the named-world refusal');
});

test('CONTROL: a never-bootstrapped board (bootedWorld = null) is allowed past the guard', async () => {
  stubBooted(null);
  const res = await post('/api/agents', { name: 'nullworldagent' });
  assert.notEqual(res.status, 409);
  const body = await res.json().catch(() => ({}));
  assert.doesNotMatch(String(body.error || ''), NAMED_MSG);
});
