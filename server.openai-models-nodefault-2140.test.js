'use strict';

/**
 * #2140 Surface 2, the fail-closed corner: GET /api/accounts/openai/models with
 * an EMPTY dir resolves to the default OpenAI account -- but when there is NO
 * default account with a readable identity, it must stay a 400, never resolve to
 * something unsafe and never throw.
 *
 * WHY A SEPARATE FILE. server.openai-models-1026.test.js seeds a default ~/.codex
 * account in its before() so the known-account guard can pass, so it cannot also
 * exercise the no-default case. This file sandboxes a HOME with NO ~/.codex
 * identity, so openaiaccounts.list() is empty (rowFor returns null without an
 * auth.json, and add() drops a null row), the empty-dir resolution finds no
 * isDefault, and the second `if (!dir)` guard 400s. A positive control then seeds
 * a default account and shows the SAME empty-dir request becomes a 200 -- so the
 * 400 is the missing account, not a broken route (this fleet's fail-closed
 * branches are a repeated false-zero axis; an instrument that only ever returns
 * the safe answer proves nothing).
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE. openaiaccounts reads ~/.codex* under
 * the home seam, so it must point at the sandbox before the module loads.
 *
 *   node --test server.openai-models-nodefault-2140.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-openai-nodefault-'));
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

let base;
test.before(async () => {
  // Deliberately seed NOTHING: HOME has no ~/.codex, so list() is empty.
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
  return { status: res.status, body: await res.text() };
}
const json = (r) => JSON.parse(r.body);

test('#2140 an empty dir with NO default OpenAI account is a fail-closed 400, never fetched', async () => {
  let fetched = false;
  openai.setFetcher(async () => { fetched = true; return { status: 200, body: { data: [] } }; });
  try {
    // Sanity: the sandbox really has no account, so this is the no-default case.
    assert.equal(openai.list().length, 0, 'control: the sandbox seeds no OpenAI account');
    const got = await get('/api/accounts/openai/models');
    assert.equal(got.status, 400, 'an empty dir with no default account must fail closed, not resolve to something unsafe');
    assert.equal(json(got).ok, false);
    assert.equal(fetched, false, 'the route must not call /v1/models when it has no account to name');
  } finally { openai.setFetcher(null); }
});

test('#2140 CONTROL: once a default account exists, the SAME empty-dir request becomes a 200', async () => {
  // Prove the 400 above is the missing account, not a route that always 400s.
  const codex = path.join(HOME, '.codex');
  fs.mkdirSync(codex, { recursive: true });
  fs.writeFileSync(path.join(codex, 'auth.json'),
    JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-nodefaultCONTROL1' }), 'utf8');
  openai.setFetcher(async () => ({ status: 200, body: { data: [{ id: 'gpt-4o' }] } }));
  try {
    assert.ok(openai.list().some((a) => a.isDefault), 'control: a default account now exists');
    const got = await get('/api/accounts/openai/models');
    assert.equal(got.status, 200, 'with a default account, the empty dir resolves and lists its models');
    assert.equal(json(got).ok, true);
  } finally { openai.setFetcher(null); }
});
