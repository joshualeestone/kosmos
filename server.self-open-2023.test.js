'use strict';

/**
 * #2023: POST /api/self-open, the token-EXEMPT reconnect that un-breaks a
 * bookmarked board on an updated machine. The BOARD process mints a nonce and
 * opens the OWNER's browser at ?boot=<nonce>; the nonce is NEVER returned to the
 * caller, so a foreign loopback caller can only pop the owner's tab. This pins:
 *   - it is reachable WITHOUT the board token (the exemption), and returns nothing;
 *   - the exemption is SCOPED to self-open (a control: another /api/* still 403s);
 *   - the crossSiteWrite/Origin guard STAYS ON (a cross-site POST is refused);
 *   - the opened URL is the board's OWN dashboard with a ?boot nonce, never a
 *     caller-supplied target;
 *   - it debounces, so a second local account cannot storm the owner with tabs.
 *
 * Same posture as server.board-nonce-1979.test.js: boot fully-sandboxed, then flip
 * enforcement on in memory. A recording stub stands in for /usr/bin/open, so the
 * test observes the open without a real browser.
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-selfopen-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

// A recording stub for KOSMOS_OPEN_CMD: append its url arg to a file, so the open
// is observed WITHOUT popping a real browser. execFile inherits process.env, so the
// stub sees SELF_OPEN_RECORD.
const RECORD = path.join(SANDBOX, 'opens.txt');
const STUB = path.join(SANDBOX, 'open-stub.sh');
fs.writeFileSync(STUB, '#!/bin/sh\nprintf "%s\\n" "$1" >> "$SELF_OPEN_RECORD"\n');
fs.chmodSync(STUB, 0o755);
process.env.KOSMOS_OPEN_CMD = STUB;
process.env.SELF_OPEN_RECORD = RECORD;

const { start, server, boardAuthState } = require('./server');

const TOK = 'SELFOPEN_test_0123456789abcdef';
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = TOK;
});

test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

function recorded() {
  try { return fs.readFileSync(RECORD, 'utf8').trim().split('\n').filter(Boolean); } catch { return []; }
}
async function waitForOpens(n, ms = 2000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (recorded().length >= n) return recorded();
    await new Promise((r) => setTimeout(r, 25));
  }
  return recorded();
}

test('self-open on an enforcing board WITHOUT the token is NOT 403, and returns NOTHING', async () => {
  const r = await fetch(`${base}/api/self-open`, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } });
  assert.equal(r.status, 204, 'self-open must be reachable without the board token (the exemption)');
  const body = await r.text();
  assert.equal(body, '', 'the response body must be empty');
  assert.doesNotMatch(body, /[0-9a-f]{64}/, 'the nonce must NEVER appear in the response');
});

test('self-open opens the board OWN dashboard with a ?boot nonce, never a caller target', async () => {
  const opens = await waitForOpens(1);
  assert.ok(opens.length >= 1, 'the board should have opened the browser');
  const url = opens[opens.length - 1];
  assert.match(
    url,
    new RegExp(`^http://127\\.0\\.0\\.1:${server.address().port}/\\?boot=[0-9a-f]{64}$`),
    'the opened url must be the board\'s own dashboard with a fresh boot nonce, not a caller-supplied target',
  );
});

test('CONTROL: another protected /api/* route without the token still 403s (exemption is scoped)', async () => {
  const r = await fetch(`${base}/api/projects`, { headers: { 'sec-fetch-site': 'same-origin' } });
  assert.equal(r.status, 403, 'a non-self-open protected route must still require the board token');
});

test('the same-origin guard STAYS ON: a cross-site POST /api/self-open is refused', async () => {
  const r = await fetch(`${base}/api/self-open`, { method: 'POST', headers: { origin: 'http://evil.example.com' } });
  assert.equal(r.status, 403, 'a cross-site (non-loopback origin) self-open must be refused by crossSiteWrite, or it is a CSRF hole');
});

test('debounce: a second self-open within the window does NOT open a second tab', async () => {
  await waitForOpens(1); // ensure the first open (from the earlier test) has landed
  const before = recorded().length;
  await fetch(`${base}/api/self-open`, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } });
  await new Promise((r) => setTimeout(r, 300));
  const after = recorded().length;
  assert.equal(after, before, 'a self-open within 5s of the last must be debounced (no new open), so a caller cannot storm the owner');
});
