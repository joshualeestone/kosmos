'use strict';

/**
 * #1026: GET /api/accounts/openai/models?dir=<dir> serves the chat models a
 * specific OpenAI account can run, sourced from that account's /v1/models via
 * the engine (openaiaccounts.accountModels). Driven against the real server.
 *
 * A separate file from server.test.js for the reason server.connect.test.js
 * gives: that file's blocks are a standing merge hazard, so a feature adds a
 * file instead of a conflict.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE. openaiaccounts reads ~/.codex*
 * under AGENT_WORKFORCE_HOME, so that seam must point at the sandbox before the
 * module loads, or the enumeration reads the operator's real codex accounts.
 * The /v1/models call is mocked through the module's own setFetcher seam, so no
 * network and no real key ever leave this test.
 *
 *   node --test server.openai-models-1026.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-openai-models-'));
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
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const openai = require('./engine/openaiaccounts');

const ACCOUNT_DIR = path.join(HOME, '.codex');

let base;
test.before(async () => {
  // A real, enumerable OpenAI account under the sandbox home, so the route's
  // known-account guard passes for its dir.
  fs.mkdirSync(ACCOUNT_DIR, { recursive: true });
  fs.writeFileSync(path.join(ACCOUNT_DIR, 'auth.json'),
    JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-routekeyROUTE1' }), 'utf8');
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  openai.setFetcher(null);
  server.closeAllConnections();
  server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function get(p) {
  const res = await fetch(base + p);
  return { status: res.status, type: res.headers.get('content-type') || '', body: await res.text() };
}
const json = (r) => JSON.parse(r.body);

test('#1026 serves a known account\'s chat models, filtered and defaulted, sourced from /v1/models', async () => {
  openai.setFetcher(async () => ({ status: 200, body: { object: 'list', data: [
    { id: 'gpt-4o' }, { id: 'gpt-5' }, { id: 'text-embedding-3-large' }, { id: 'gpt-4o-realtime-preview' },
  ] } }));
  try {
    const got = await get('/api/accounts/openai/models?dir=' + encodeURIComponent(ACCOUNT_DIR));
    assert.equal(got.status, 200);
    assert.match(got.type, /application\/json/);
    const out = json(got);
    assert.equal(out.ok, true);
    assert.deepEqual(out.models.map((m) => m.arg), ['gpt-5', 'gpt-4o'],
      'embeddings and the realtime variant are filtered out; chat models ranked');
    assert.equal(out.models.filter((m) => m.default).length, 1);
    // #2191: runnableKeys is a server-side validation input, never shipped to the
    // display route -- the collapse's whole point is a small menu/payload.
    assert.ok(!('runnableKeys' in out), 'the display route must not ship the full un-collapsed runnableKeys to the client');
  } finally { openai.setFetcher(null); }
});

test('#1026 CONTROL: an unknown dir is refused 404, never fetched', async () => {
  let fetched = false;
  openai.setFetcher(async () => { fetched = true; return { status: 200, body: { data: [] } }; });
  try {
    const got = await get('/api/accounts/openai/models?dir=' + encodeURIComponent(path.join(HOME, '.codex-nope')));
    assert.equal(got.status, 404);
    assert.equal(json(got).ok, false);
    assert.equal(fetched, false, 'an unknown account is rejected before any /v1/models call');
  } finally { openai.setFetcher(null); }
});

test('#1026/#2140 a missing dir resolves to the DEFAULT OpenAI account (Surface 2)', async () => {
  // #2140 Surface 2: a default-codex agent (no configDir) has no dir to name, so
  // an empty dir now means the default OpenAI account (here HOME/.codex) rather
  // than a 400. The route still validates the resolved dir is a known account, so
  // this is not the arbitrary-path enumeration the fail-closed posture guarded.
  openai.setFetcher(async () => ({ status: 200, body: { data: [{ id: 'gpt-4o' }] } }));
  try {
    const got = await get('/api/accounts/openai/models');
    assert.equal(got.status, 200);
    assert.equal(json(got).ok, true, 'a missing dir should resolve to the default account and list its models');
  } finally { openai.setFetcher(null); }
});

test('#1026 the route never 500s: a non-200 from OpenAI is a plain ok:false answer', async () => {
  openai.setFetcher(async () => ({ status: 500, body: null }));
  try {
    const got = await get('/api/accounts/openai/models?dir=' + encodeURIComponent(ACCOUNT_DIR));
    assert.equal(got.status, 200);
    const out = json(got);
    assert.equal(out.ok, false);
    assert.deepEqual(out.models, []);
  } finally { openai.setFetcher(null); }
});
