'use strict';

/**
 * The /api/usage route (#853), driven against the real server.
 *
 * The scanning/bucketing logic itself is covered exhaustively in
 * engine/usage.test.js (a private second reader of the same question at
 * this layer would be exactly the class of drift this codebase calls its
 * worst-shipped habit). This file only proves the ROUTE: it exists, it
 * returns the shape engine/usage.js produces, `?days=` is honored, and a
 * hostile value cannot crash it -- not a re-derivation of the scan itself.
 *
 *   node --test server.usage.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-usage-route-'));
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
process.env.AGENT_WORKFORCE_TMUX_BIN = require('node:path').join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
// engine/usage.js's transcript root -- sandboxed the same way
// engine/usage.test.js sandboxes it, so this route never touches the
// operator's real ~/.claude*.
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SANDBOX, 'claude-projects');

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { server.closeAllConnections(); server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

function seedTranscript(day, model, tokens) {
  const dir = path.join(process.env.AGENT_WORKFORCE_CONFIG_ROOT, 'projects', 'proj');
  fs.mkdirSync(dir, { recursive: true });
  const row = JSON.stringify({ timestamp: `${day}T09:00:00.000Z`, isSidechain: false, sessionId: 'sess', message: { model, usage: tokens } });
  fs.writeFileSync(path.join(dir, 'sess.jsonl'), row + '\n', 'utf8');
}

test('GET /api/usage returns the four buckets separately, by day and model, never blended', async () => {
  const today = new Date().toISOString().slice(0, 10);
  seedTranscript(today, 'claude-sonnet-5', { input_tokens: 10, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 4000 });
  const res = await fetch(base + '/api/usage?days=1');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.byDay[today], 'today is missing from the response');
  const b = body.byDay[today]['claude-sonnet-5'];
  assert.equal(b.input_tokens, 10);
  assert.equal(b.output_tokens, 2);
  assert.equal(b.cache_creation_input_tokens, 3);
  assert.equal(b.cache_read_input_tokens, 4000);
  assert.ok(Array.isArray(body.rootsRead) && body.rootsRead.length >= 1, 'rootsRead is missing');
});

test('GET /api/usage?days= with a hostile value does not crash the route', async () => {
  const res = await fetch(base + '/api/usage?days=not-a-number');
  assert.equal(res.status, 200, 'a non-numeric days value should fall back, not error');
  const res2 = await fetch(base + '/api/usage?days=999999999999');
  assert.equal(res2.status, 200, 'an absurdly large days value should be clamped inside dailyUsageByModel, not crash the route');
});
