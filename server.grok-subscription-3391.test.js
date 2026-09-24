'use strict';
/**
 * #3391 subscription half: the routes
 *   POST /api/accounts/grok/subscription/start
 *   GET  /api/accounts/grok/subscription/status?sessionId=
 *   POST /api/accounts/grok/subscription/cancel
 * driven end to end against a FAKE grok (never the machine's grok, never xAI). The
 * driver's own edge cases are covered by engine/grokaccounts.subscription-3391.test.js.
 *
 *   node --test server.grok-subscription-3391.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-grok-sub-routes-3391-'));
const mkTemp = (p) => fs.mkdtempSync(nodePath.join(os.tmpdir(), p));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkTemp('aw-gsr-workers-');
process.env.AGENT_WORKFORCE_PROJECTS = mkTemp('aw-gsr-projects-');
process.env.AGENT_WORKFORCE_LAUNCH = mkTemp('aw-gsr-launch-');
process.env.AGENT_WORKFORCE_GROK_HOME = nodePath.join(SANDBOX, '.grok');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');

const runners = require('./engine/runners');
const { start, server } = require('./server');

const FAKE = nodePath.join(SANDBOX, 'fake-grok.sh');
fs.writeFileSync(FAKE, [
  '#!/bin/bash',
  'printf "\\nTo sign in, open this URL in your browser:\\n\\n  https://accounts.x.ai/oauth2/device?user_code=ZXCV-BNMM\\n\\nConfirm this code in your browser:\\n\\n  ZXCV-BNMM\\n\\nWaiting for authorization...\\n"',
  'sleep 0.3',
  'printf \'{"https://auth.x.ai::u9":{"email":"route@example.com","refresh_token":"r"}}\' > "$GROK_HOME/auth.json"',
  'exit 0',
].join('\n') + '\n', { mode: 0o755 });

const _origResolveBin = runners.resolveBin;
let grokPresent = true;
runners.resolveBin = (p) => (p === 'grok' ? { present: grokPresent, bin: FAKE } : _origResolveBin(p));

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  runners.resolveBin = _origResolveBin;
  try { server.close(); } catch { /* best effort */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const post = (p, obj) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
async function poll(sessionId, want, ms = 5000) {
  const until = Date.now() + ms;
  for (;;) {
    const r = await fetch(`${base}/api/accounts/grok/subscription/status?sessionId=${sessionId}`);
    const b = await r.json();
    if (want(b)) return { status: r.status, body: b };
    if (Date.now() > until) throw new Error('timed out; last: ' + JSON.stringify(b));
    await new Promise((res) => setTimeout(res, 50));
  }
}

test('start -> status shows the URL and code -> connected; the account is in GET /api/accounts', async () => {
  const r = await post('/api/accounts/grok/subscription/start', { label: 'routed' });
  assert.equal(r.status, 200);
  const { sessionId } = await r.json();
  assert.match(sessionId, /^[0-9a-f]{32}$/);
  const mid = await poll(sessionId, (b) => b.userCode);
  assert.equal(mid.body.userCode, 'ZXCV-BNMM');
  assert.equal(mid.body.authUrl, 'https://accounts.x.ai/oauth2/device?user_code=ZXCV-BNMM');
  const done = await poll(sessionId, (b) => b.state === 'connected');
  assert.equal(done.body.account.authMode, 'subscription');
  assert.equal(done.body.account.email, 'route@example.com');
  const all = await (await fetch(`${base}/api/accounts`)).json();
  const rows = JSON.stringify(all);
  assert.ok(rows.includes('route@example.com'), 'GET /api/accounts carries the new subscription account');
});

test('an unknown session is a 404 on status and on cancel', async () => {
  const s = await fetch(`${base}/api/accounts/grok/subscription/status?sessionId=nope`);
  assert.equal(s.status, 404);
  const c = await post('/api/accounts/grok/subscription/cancel', { sessionId: 'nope' });
  assert.equal(c.status, 404);
});

test('no grok runner on this computer -> 400 with needsRunner', async () => {
  grokPresent = false;
  try {
    const r = await post('/api/accounts/grok/subscription/start', { label: 'norunner' });
    assert.equal(r.status, 400);
    const b = await r.json();
    assert.equal(b.needsRunner, true);
    assert.equal(b.provider, 'grok');
  } finally { grokPresent = true; }
});

test('a body that is not an object is refused', async () => {
  const r = await fetch(base + '/api/accounts/grok/subscription/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '"x"' });
  assert.equal(r.status, 400);
});
