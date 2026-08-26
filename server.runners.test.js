'use strict';

/**
 * The runner routes (#979), driven against the real server.
 *
 * A separate file from `server.test.js` for the same reason as
 * `server.connect.test.js`: that file's blocks are a standing merge hazard,
 * and this feature can add a file instead of a conflict.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (the server fixes paths at
 * load), plus the two this feature adds: the managed runners dir, and the
 * codex override -- which resolveBin treats as AUTHORITATIVE, so pointing
 * it at a sandbox path is what makes present/absent deterministic here
 * (this Mac genuinely has a hand-installed codex at the legacy path).
 *
 *   node --test server.runners.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-runner-routes-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_RUNNERS_DIR = path.join(SANDBOX, 'runners');
const MISSING_CODEX = path.join(SANDBOX, 'no-such-codex');
process.env.AGENT_WORKFORCE_CODEX_BIN = MISSING_CODEX; // absent by default; tests flip it

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function req(p, options) {
  const res = await fetch(base + p, options);
  return { status: res.status, type: res.headers.get('content-type') || '', body: await res.text() };
}
const json = (r) => JSON.parse(r.body);

async function post(p, body, origin) {
  return req(p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: origin || base },
    body: JSON.stringify(body || {}),
  });
}

test('#979: GET /api/runners answers the documented shape, absent runner and honest numbers', async () => {
  const got = await req('/api/runners');
  assert.equal(got.status, 200);
  assert.match(got.type, /application\/json/);
  const r = json(got).runners;
  assert.ok(r.openai, 'the openai runner is listed');
  assert.equal(r.openai.present, false, 'the sandboxed override names a missing path, so absent');
  assert.equal(r.openai.bin, MISSING_CODEX, 'and the bin is the path the operator set, not a fallback');
  assert.equal(typeof r.openai.pinnedVersion, 'string');
  assert.ok(r.openai.downloadBytes === null || typeof r.openai.downloadBytes === 'number');
  assert.equal(r.openai.job, null, 'no install has run');
});

test('#979: a prototype-chain provider name in the URL is a refusal, not a job', async () => {
  const got = await post('/api/runners/constructor/install');
  assert.equal(got.status, 400);
  const j = json(got).job;
  assert.equal(j.phase, 'failed');
  assert.match(j.because, /do not know/);
});

test('#979: install on an already-present runner answers installed without a job or a download', async () => {
  process.env.AGENT_WORKFORCE_CODEX_BIN = '/bin/echo'; // exists on every Mac
  try {
    const got = await post('/api/runners/openai/install');
    assert.equal(got.status, 200);
    assert.equal(json(got).job.phase, 'installed');
  } finally {
    process.env.AGENT_WORKFORCE_CODEX_BIN = MISSING_CODEX;
  }
});

test('#979: Add with the runner missing is a STRUCTURED refusal the screen can act on, never a silent no-op', async () => {
  const got = await post('/api/accounts/openai', { key: 'sk-test-not-a-real-key' });
  assert.equal(got.status, 400);
  const j = json(got);
  // The exact legacy sentence is load-bearing: today's UI matches on it,
  // and it keeps working until the flow binds the richer shape.
  assert.equal(j.error, 'we could not find the OpenAI runner on this computer, so there is nothing to sign in to');
  assert.equal(j.needsRunner, true);
  assert.equal(j.provider, 'openai');
});

test('#979: Add with the runner present passes the runner gate (no needsRunner in the answer)', async () => {
  process.env.AGENT_WORKFORCE_CODEX_BIN = '/bin/echo';
  try {
    const got = await post('/api/accounts/openai', { key: 'sk-test-not-a-real-key' });
    // /bin/echo is not a real codex, so the add itself may still fail
    // downstream -- the assertion here is ONLY that the runner gate
    // opened: whatever came back, it is not the needs-install shape.
    const j = json(got);
    assert.equal(j.needsRunner, undefined, 'a present runner must never answer needsRunner');
  } finally {
    process.env.AGENT_WORKFORCE_CODEX_BIN = MISSING_CODEX;
  }
});
