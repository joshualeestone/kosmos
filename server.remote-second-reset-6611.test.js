'use strict';
/* kosmos#6611: the /api/remote/second-reset route passes on what the coordinator cleared. The page says the sign-out
   only for a kind, "nobody was signed out" only for null, and claims nothing when `had` is absent, so the route must
   keep the three apart: a kind and null pass through as they are, and absent stays absent (never null). This pins the
   route between the engine and the page, against the real server, with the engine's secondReset replaced. */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-remote-second-reset-6611-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TUNNEL_BIN = '/usr/bin/false';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const remote = require('./engine/remote');

let base;
let answer = null;
const realReset = remote.secondReset;
remote.secondReset = async () => answer;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  remote.secondReset = realReset;
  server.closeAllConnections(); server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
const post = async () => {
  const res = await fetch(base + '/api/remote/second-reset', { method: 'POST' });
  return { status: res.status, body: await res.json() };
};

test('#6611: a cleared kind passes through', async () => {
  answer = { ok: true, because: null, had: 'totp' };
  const got = await post();
  assert.equal(got.status, 200);
  assert.deepEqual(got.body, { ok: true, had: 'totp' });
});

test('#6611: nothing cleared passes through as null, not dropped', async () => {
  answer = { ok: true, because: null, had: null };
  const got = await post();
  assert.equal(got.status, 200);
  assert.ok(Object.prototype.hasOwnProperty.call(got.body, 'had'), 'the route dropped had: null, so the page would claim nothing');
  assert.equal(got.body.had, null);
});

test('#6611: an answer the engine could not read stays absent, never null', async () => {
  answer = { ok: true, because: null, had: undefined };
  const got = await post();
  assert.equal(got.status, 200);
  assert.ok(!Object.prototype.hasOwnProperty.call(got.body, 'had'), 'an unknown had reached the page as a value: ' + JSON.stringify(got.body));
});

test('#6611: a refusal is still the engine\'s words, with no had', async () => {
  answer = { ok: false, because: 'this computer is not set up for Plus, so it cannot reset a second factor' };
  const got = await post();
  assert.equal(got.status, 400);
  assert.deepEqual(got.body, { error: answer.because });
});
