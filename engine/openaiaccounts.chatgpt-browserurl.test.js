'use strict';
/**
 * codex-login BROWSER-mode URL parsing on Windows. codex 0.149.1 `codex login`
 * prints its OWN local callback server first and the REAL sign-in URL second, so
 * the parser must pick the second (non-loopback) one. The client sets its
 * open-page link to authUrl (web/index.html: openA.href = authUrl), so grabbing
 * the loopback URL pointed that link at a dead local address and browser sign-in
 * stalled at awaiting-browser. FIXTURES ARE THE REAL OUTPUT MEASURED 2026-09-21
 * against codex 0.149.1 on win32 (x86_64-pc-windows-msvc).
 *
 *   node --test engine/openaiaccounts.chatgpt-browserurl.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// The module reads a home at require time; give it a sandbox like the sibling tests.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-chatgpt-browserurl-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
const openai = require('./openaiaccounts');
const { parseChatgptLoginOutput } = openai;

// VERBATIM stderr of `codex login` (browser mode), codex 0.149.1 on win32, 2026-09-21.
const REAL_BROWSER = [
  'Starting local login server on http://localhost:1455.',
  'If your browser did not open, navigate to this URL to authenticate:',
  '',
  'https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_EMoamEEZ73f0CkXaXp7hrann&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&scope=openid%20profile%20email%20offline_access&code_challenge=jRkXcE3doEAst8PlOOA9cu2N1HMgRbmHvUg0-DEHjkE&code_challenge_method=S256&state=q4OV2kyToODIuLlVRXTrxNIF3PLiia_hxZ190cEKyM0&originator=codex_cli_rs',
  '',
  'On a remote or headless machine? Use `codex login --device-auth` instead.',
].join('\n');

test('browser mode picks the real auth.openai.com URL, not the loopback callback server', () => {
  const out = parseChatgptLoginOutput(REAL_BROWSER);
  assert.ok(out.authUrl, 'an authUrl is captured');
  assert.ok(out.authUrl.startsWith('https://auth.openai.com/oauth/authorize'), `got ${out.authUrl}`);
  // The chosen URL's HOST is the sign-in host, not the loopback server. (The real
  // URL legitimately contains "localhost" inside its redirect_uri query param, so a
  // naive substring check would be wrong -- assert on the host.)
  assert.equal(new URL(out.authUrl).host, 'auth.openai.com', 'the loopback server URL is never chosen');
});

test('an early streamed chunk with only the loopback line yields NO authUrl (so the session keeps waiting)', () => {
  // codex streams: the first data event can hold just the local-server line, and
  // even a partial one without the port. Neither must lock in as the sign-in URL.
  assert.equal(parseChatgptLoginOutput('Starting local login server on http://localhost:1455.').authUrl, undefined);
  assert.equal(parseChatgptLoginOutput('Starting local login server on http://localhost').authUrl, undefined);
});

test('loopback hosts are all skipped (localhost, 127.0.0.1, [::1], with or without port)', () => {
  for (const u of ['http://localhost:1455/cb', 'http://127.0.0.1:1455/cb', 'http://[::1]:1455/cb', 'http://localhost']) {
    assert.equal(parseChatgptLoginOutput(`server at ${u}`).authUrl, undefined, `${u} must be skipped`);
  }
});

test('device-auth output is unaffected: real non-loopback URL and hyphenated code (measured 2026-09-09)', () => {
  const out = parseChatgptLoginOutput('Go to https://auth.openai.com/codex/device and enter 3PI3-2LM3M');
  assert.equal(out.authUrl, 'https://auth.openai.com/codex/device');
  assert.equal(out.userCode, '3PI3-2LM3M');
});

test('trailing sentence punctuation is still trimmed from the chosen URL', () => {
  assert.equal(parseChatgptLoginOutput('navigate to https://auth.openai.com/AB12CD34.').authUrl, 'https://auth.openai.com/AB12CD34');
});
