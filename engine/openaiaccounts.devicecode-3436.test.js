'use strict';
/**
 * #3436: on Windows, "Connect for OpenAI" (ChatGPT subscription) opened codex's
 * sign-in page BEHIND the Kosmos window. codex opens it from a background process and
 * Windows' foreground-lock rules stop a background process from bringing a window
 * forward. The fix runs codex's DEVICE-CODE sign-in on win32: the board shows the link
 * and the one-time code and opens the link itself. Pinned here:
 *
 *   - chatgptLoginMode: win32 is always device; every other platform keeps what the
 *     caller asked for (so a Mac's browser sign-in is unchanged).
 *   - parseChatgptLoginOutput reads the REAL, COLOURED device-auth output. The fixture
 *     is the byte shape measured 2026-09-25 from codex 0.149.1 on win32 with stdout
 *     piped (only the code is replaced). Before the fix the URL kept a trailing
 *     `\x1b[0m` and the code was not found at all.
 *   - chatgptLoginInstructions: the fallback text when no code can be read.
 *   - the driver, end to end with a stand-in codex: an injected win32 platform spawns
 *     `login --device-auth` even when the page asked for browser, and status carries the
 *     parsed URL + code; an unparseable code comes back as codex's own instructions; an
 *     injected darwin platform keeps browser mode and never carries instructions.
 *
 * The stand-in codex is THIS node binary with a NODE_OPTIONS --require preload that
 * prints and waits, so the driver arms run the same on Windows and on a Mac (a bash
 * mock is not runnable on Windows).
 *
 *   node --test engine/openaiaccounts.devicecode-3436.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-devicecode-3436-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;

const openai = require('./openaiaccounts');

// Measured 2026-09-25, codex-cli 0.149.1, win32, `codex login --device-auth` with
// stdio ['ignore','pipe','pipe']. The one-time code is replaced by a same-shape fake.
const MEASURED_DEVICE_OUT = '\nWelcome to Codex [v\u001b[90m0.149.1\u001b[0m]\n\u001b[90mOpenAI\'s command-line coding agent\u001b[0m\n\n'
  + 'Follow these steps to sign in with ChatGPT using device code authorization:\n\n'
  + '1. Open this link in your browser and sign in to your account\n   \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m\n\n'
  + '2. Enter this one-time code \u001b[90m(expires in 15 minutes)\u001b[0m\n   \u001b[94mQ7RT-4KXWZ\u001b[0m\n\n'
  + '\u001b[90mContinue only if you started this login in Codex. If a website or another person gave you this code, cancel.\u001b[0m\n\n';

test('win32 always signs in by device code; other platforms keep what was asked', () => {
  assert.equal(openai.chatgptLoginMode('browser', 'win32'), 'device');
  assert.equal(openai.chatgptLoginMode(undefined, 'win32'), 'device');
  assert.equal(openai.chatgptLoginMode('device', 'win32'), 'device');
  assert.equal(openai.chatgptLoginMode('browser', 'darwin'), 'browser');
  assert.equal(openai.chatgptLoginMode(undefined, 'darwin'), 'browser');
  assert.equal(openai.chatgptLoginMode('anything', 'darwin'), 'browser');
  assert.equal(openai.chatgptLoginMode('device', 'darwin'), 'device');
  assert.equal(openai.chatgptLoginMode('browser', 'linux'), 'browser');
});

test('the measured, coloured device-auth output parses to a clean URL and the code', () => {
  const got = openai.parseChatgptLoginOutput(MEASURED_DEVICE_OUT);
  assert.equal(got.authUrl, 'https://auth.openai.com/codex/device', 'the URL kept a colour code or was not found');
  assert.equal(got.userCode, 'Q7RT-4KXWZ', 'the code behind a colour sequence was not found');
});

test('the version number in the banner is not read as the URL or the code', () => {
  // Only the banner arrived so far: nothing to show yet, and nothing wrong shown.
  const banner = '\nWelcome to Codex [v\u001b[90m0.149.1\u001b[0m]\n';
  assert.deepEqual(openai.parseChatgptLoginOutput(banner), {});
});

test('output with no colour parses exactly as before', () => {
  const plain = 'Sign in at https://auth.openai.com/device and enter code WXYZ-1234';
  assert.deepEqual(openai.parseChatgptLoginOutput(plain), { authUrl: 'https://auth.openai.com/device', userCode: 'WXYZ-1234' });
});

test('the fallback instructions are codex\'s words without colour or control characters, and bounded', () => {
  const said = openai.chatgptLoginInstructions(MEASURED_DEVICE_OUT);
  assert.ok(!/\u001b/.test(said), 'a colour code reached the screen text');
  assert.match(said, /^Welcome to Codex \[v0\.149\.1\]/);
  assert.match(said, /https:\/\/auth\.openai\.com\/codex\/device\n/);
  assert.ok(!/\n{3,}/.test(said), 'blank runs were not collapsed');
  const long = openai.chatgptLoginInstructions('x'.repeat(5000) + '\u0007');
  assert.ok(long.length <= 1201, 'the fallback text is not bounded');
  assert.ok(long.endsWith('…'));
  assert.equal(openai.chatgptLoginInstructions('\u001b[0m\r\n  \u0000'), '');
});

/* ---- the driver, with a stand-in codex ---------------------------------------- */

const MOCK_PRELOAD = nodePath.join(SANDBOX, 'codex-standin.cjs');
fs.writeFileSync(MOCK_PRELOAD, `
const fs = require('node:fs');
// node resolves the first arg (login) to a script path in argv[1]; keep its name.
if (process.env.STANDIN_ARGS_OUT) fs.writeFileSync(process.env.STANDIN_ARGS_OUT, JSON.stringify(process.argv.slice(1).map((a, i) => (i === 0 ? require('node:path').basename(a) : a))));
// node then tries to run login as a script; answer that with this (already loaded)
// file so the stand-in stays up, printing and waiting, the way codex does.
const Module = require('node:module');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  return require('node:path').basename(String(req)) === 'login' ? __filename : resolve.call(this, req, ...rest);
};
process.stdout.write(process.env.STANDIN_SAY || '');
setTimeout(() => process.exit(0), 30000);
`);

async function waitFor(sessionId, pred, ms = 8000) {
  const start = Date.now();
  for (;;) {
    const s = openai.chatgptLoginStatus(sessionId);
    if (pred(s)) return s;
    if (Date.now() - start > ms) throw new Error(`timeout; last ${JSON.stringify(s)}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

// Start a sign-in against the stand-in. NODE_OPTIONS is set only across the
// synchronous spawn (the child copies the env there), so nothing else inherits it.
function startWithStandin({ say, platform, mode }) {
  const argsOut = nodePath.join(SANDBOX, 'args-' + Math.random().toString(16).slice(2) + '.json');
  const saved = { NODE_OPTIONS: process.env.NODE_OPTIONS, STANDIN_SAY: process.env.STANDIN_SAY, STANDIN_ARGS_OUT: process.env.STANDIN_ARGS_OUT };
  // Forward slashes: NODE_OPTIONS reads a backslash inside quotes as an escape.
  process.env.NODE_OPTIONS = '--require "' + MOCK_PRELOAD.replace(/\\/g, '/') + '"';
  process.env.STANDIN_SAY = say;
  process.env.STANDIN_ARGS_OUT = argsOut;
  try {
    return { r: openai.startChatgptLogin({ codexBin: process.execPath, mode, platform }), argsOut };
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const readArgs = async (file) => {
  for (let i = 0; i < 200 && !fs.existsSync(file); i++) await new Promise((r) => setTimeout(r, 25));
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};

test('on win32 a browser request runs --device-auth, and status carries the clean link and code', async () => {
  const { r, argsOut } = startWithStandin({ say: MEASURED_DEVICE_OUT, platform: 'win32', mode: 'browser' });
  assert.equal(r.ok, true, r.because);
  assert.equal(r.mode, 'device', 'the page is not told this is a device sign-in');
  try {
    assert.deepEqual(await readArgs(argsOut), ['login', '--device-auth']);
    const s = await waitFor(r.sessionId, (x) => x.userCode);
    assert.equal(s.state, 'awaiting-code');
    assert.equal(s.authUrl, 'https://auth.openai.com/codex/device');
    assert.equal(s.userCode, 'Q7RT-4KXWZ');
    assert.equal(s.instructions, undefined, 'a parsed code should not also carry the fallback text');
  } finally { openai.cancelChatgptLogin(r.sessionId); }
});

test('on win32, a code that cannot be read comes back as codex\'s own instructions', async () => {
  const odd = 'To sign in, visit \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m and type the word shown in the Codex window.\n';
  const { r } = startWithStandin({ say: odd, platform: 'win32', mode: 'browser' });
  assert.equal(r.ok, true, r.because);
  try {
    const s = await waitFor(r.sessionId, (x) => x.instructions);
    assert.equal(s.userCode, undefined);
    assert.equal(s.authUrl, 'https://auth.openai.com/codex/device');
    assert.equal(s.instructions, 'To sign in, visit https://auth.openai.com/codex/device and type the word shown in the Codex window.');
  } finally { openai.cancelChatgptLogin(r.sessionId); }
});

test('on a Mac a browser request stays a browser sign-in and never carries instructions', async () => {
  const say = 'Starting local login server on http://localhost:1455.\nIf your browser did not open, navigate to this URL to authenticate:\n\nhttps://auth.openai.com/oauth/authorize?x=1\n';
  const { r, argsOut } = startWithStandin({ say, platform: 'darwin', mode: 'browser' });
  assert.equal(r.ok, true, r.because);
  assert.equal(r.mode, 'browser');
  try {
    assert.deepEqual(await readArgs(argsOut), ['login']);
    const s = await waitFor(r.sessionId, (x) => x.authUrl);
    assert.equal(s.state, 'awaiting-browser');
    assert.equal(s.authUrl, 'https://auth.openai.com/oauth/authorize?x=1');
    assert.equal(s.instructions, undefined);
    assert.deepEqual(Object.keys(s).sort(), ['account', 'authUrl', 'error', 'ok', 'state', 'userCode'], 'the browser-mode status answer changed shape');
  } finally { openai.cancelChatgptLogin(r.sessionId); }
});

test.after(async () => {
  // Let cancelled children exit so their slots free before the sandbox goes.
  await new Promise((r) => setTimeout(r, 300));
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});
