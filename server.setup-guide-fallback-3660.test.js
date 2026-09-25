'use strict';

/**
 * #3660 fallback through the real server (Josh, 2026-09-25 07:22): a guide whose card shows one of the
 * three #3723 states makes GET /api/setup-guide say `hosted: true, hostedWhy: 'own_model_failing'` with the
 * problem and runner, and POST /api/setup-guide/hosted then answers. A guide that answers keeps the old
 * shape and the hosted route refuses with `own_model`.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-guide-fallback-route-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
// A connected model (an OpenAI key, listed by the real account module): a guide exists only once one is.
fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_HOME, '.codex'), { recursive: true });
fs.writeFileSync(path.join(process.env.AGENT_WORKFORCE_HOME, '.codex', 'auth.json'),
  JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-testtestFALLBACK1' }), { mode: 0o600 });

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const setupAssistant = require('./engine/setup-assistant');
const remote = require('./engine/remote');

const GUIDE = 'guidebot';
const restore = [];
function stub(obj, key, value) { const was = obj[key]; obj[key] = value; restore.push(() => { obj[key] = was; }); }

const bin = path.join(SANDBOX, 'tunnel.sh');
fs.writeFileSync(bin, `#!/bin/bash\ncat >/dev/null; printf '{"status":200,"body":{"reply":"Add credits at OpenAI, then try again.","remaining":29}}'\n`, { mode: 0o755 });
process.env.AGENT_WORKFORCE_TUNNEL_BIN = bin;

let base;
test.before(async () => {
  stub(setupAssistant, 'guideName', () => GUIDE);
  stub(setupAssistant, 'isGuideFolder', (n) => n === GUIDE);
  stub(remote, 'hostedAvailable', () => true);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  for (const undo of restore.reverse()) undo();
  try { server.close(); } catch { /* best effort */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const status = async () => (await fetch(base + '/api/setup-guide')).json();
const ask = () => fetch(base + '/api/setup-guide/hosted', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'why is nothing answering?' }] }) });

for (const state of ['rate_limited', 'auth_failed', 'connection_lost']) {
  test(`#3660 a guide that is ${state} falls back: GET says so with the problem and runner, and the hosted route answers`, async () => {
    const board = fleet.install([fleet.agent(GUIDE, { state })]);
    try {
      const g = await status();
      assert.equal(g.ok, true);
      assert.equal(g.name, GUIDE);
      assert.equal(g.hosted, true, JSON.stringify(g));
      assert.equal(g.hostedWhy, 'own_model_failing');
      assert.equal(g.problem, state);
      assert.equal(g.runner, 'claude');
      const r = await ask();
      assert.equal(r.status, 200, 'the hosted route refused a chat while the guide was failing');
      assert.match((await r.json()).reply, /Add credits/);
    } finally { board.restore(); }
  });
}

test('#3660 a guide that answers keeps the old shape, and the hosted route refuses with own_model (it flips back)', async () => {
  assert.equal(setupAssistant.listedModels().rows.length, 1, 'CONTROL: the sandbox lists one model of their own');
  const board = fleet.install([fleet.agent(GUIDE, { state: 'idle' })]);
  try {
    assert.deepEqual(await status(), { ok: true, name: GUIDE }, 'a working guide was offered the hosted fallback');
    const r = await ask();
    assert.equal(r.status, 409);
    assert.equal((await r.json()).code, 'own_model');
  } finally { board.restore(); }
});

test('#3660 a failing guide with no connector says what is wrong, and hosted is false', async () => {
  stub(remote, 'hostedAvailable', () => false);
  const board = fleet.install([fleet.agent(GUIDE, { state: 'auth_failed' })]);
  try {
    const g = await status();
    assert.equal(g.hosted, false);
    assert.equal(g.hostedWhy, 'no_connector');
    assert.equal(g.problem, 'auth_failed');
    assert.equal(g.runner, 'claude', 'an agent with no recorded runner is claude, as its card says');
  } finally { board.restore(); remote.hostedAvailable = () => true; }
});
