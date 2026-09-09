'use strict';
/**
 * #2584: the chatgpt-subscription REAUTH-IN-PLACE driver mode. Signing in again
 * AS an existing account must REFRESH it, never duplicate it (#1492) and never
 * destroy it -- even when the reauth fails, is cancelled, times out, or lands a
 * DIFFERENT account. The mechanism: run the sign-in in a throwaway STAGING dir
 * exactly like a new sign-in, and promote its auth.json into the live dir ONLY on
 * success + an identity match, so the live account is never in the failure path.
 *
 * These are the failing controls that property needs: each destructive/abnormal
 * path asserts the LIVE account's auth.json is byte-identical to before.
 *
 *   node --test engine/openaiaccounts.chatgpt-reauth-2584.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-chatgpt-reauth-2584-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;

const openai = require('./openaiaccounts');

function idToken(email) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ email })}.`;
}
// Write a live chatgpt account dir directly (no sign-in), so a reauth has a real
// existing account to refresh and we hold its exact pre-reauth bytes.
function writeChatgptAccount(dirName, email) {
  const dir = nodePath.join(SANDBOX, dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'auth.json'),
    JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: idToken(email) } }));
  return dir;
}
function authBytes(dir) {
  try { return fs.readFileSync(nodePath.join(dir, 'auth.json'), 'utf8'); } catch { return null; }
}
function workSlots() {
  return fs.readdirSync(SANDBOX).filter((n) => /^\.codex-work/.test(n));
}

// Mock codex: prints a URL+code, then writes a chatgpt auth.json for FAKE_ID_TOKEN
// into CODEX_HOME and exits 0; FAIL exits 1 with no auth.json; SLEEP prints then
// sleeps so a cancel can kill it mid-flight.
const MOCK = nodePath.join(SANDBOX, 'codex-mock.sh');
fs.writeFileSync(MOCK, `#!/bin/bash
if [ "$FAKE_CODEX_FAIL" = "1" ]; then echo "sign-in failed" >&2; exit 1; fi
echo "Sign in at https://auth.openai.com/device and enter code WXYZ-1234"
if [ "$FAKE_CODEX_SLEEP" = "1" ]; then sleep 30; exit 0; fi
printf '{"auth_mode":"chatgpt","tokens":{"id_token":"%s"}}' "$FAKE_ID_TOKEN" > "$CODEX_HOME/auth.json"
exit 0
`);
fs.chmodSync(MOCK, 0o755);

async function waitFor(sessionId, pred, ms = 4000) {
  const start = Date.now();
  for (;;) {
    const s = openai.chatgptLoginStatus(sessionId);
    if (pred(s)) return s;
    if (Date.now() - start > ms) throw new Error(`timeout; last state=${s.state} error=${s.error}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
const terminal = (x) => x.state === 'connected' || x.state === 'error';

test('happy path: a matching reauth refreshes the SAME account in place, and leaves no staging dir', async () => {
  const dir = writeChatgptAccount('.codex-refresh', 'sam@example.com');
  const before = authBytes(dir);
  process.env.FAKE_ID_TOKEN = idToken('sam@example.com'); // same identity signs in again
  const slotsBefore = workSlots().length;
  const r = openai.startChatgptLogin({ codexBin: MOCK, mode: 'browser', reauthDir: dir });
  assert.equal(r.ok, true, r.because);
  const s = await waitFor(r.sessionId, terminal);
  assert.equal(s.state, 'connected', s.error);
  // The account handed back IS the live dir, not a new one (no #1492 duplicate).
  assert.equal(s.account.dir, dir);
  assert.equal(s.account.authMode, 'chatgpt');
  assert.equal(s.account.email, 'sam@example.com');
  // The live auth.json was refreshed (re-written), and still parses as the account.
  assert.notEqual(authBytes(dir), null);
  // No staging .codex-work* slot persists.
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(workSlots().length, slotsBefore, 'the throwaway staging dir was cleaned up');
});

test('identity mismatch: a reauth that lands a DIFFERENT account is refused and the live account is UNCHANGED', async () => {
  const dir = writeChatgptAccount('.codex-mine', 'owner@example.com');
  const before = authBytes(dir);
  process.env.FAKE_ID_TOKEN = idToken('someone-else@example.com'); // a different account signs in
  const r = openai.startChatgptLogin({ codexBin: MOCK, mode: 'browser', reauthDir: dir });
  assert.equal(r.ok, true, r.because);
  const s = await waitFor(r.sessionId, terminal);
  assert.equal(s.state, 'error', 'a different-account sign-in must not be promoted');
  assert.match(s.error, /different account/i);
  assert.equal(authBytes(dir), before, 'the live account auth.json is byte-identical: never swapped');
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(workSlots().length, 0, 'the staging dir was cleaned up');
});

test('a FAILED reauth (codex nonzero exit) leaves the live account byte-identical and no staging litter', async () => {
  const dir = writeChatgptAccount('.codex-keepme', 'keep@example.com');
  const before = authBytes(dir);
  process.env.FAKE_CODEX_FAIL = '1';
  process.env.FAKE_ID_TOKEN = idToken('keep@example.com');
  const r = openai.startChatgptLogin({ codexBin: MOCK, mode: 'browser', reauthDir: dir });
  assert.equal(r.ok, true, r.because);
  const s = await waitFor(r.sessionId, terminal);
  assert.equal(s.state, 'error');
  assert.equal(authBytes(dir), before, 'a failed reauth must not touch the live account');
  delete process.env.FAKE_CODEX_FAIL;
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(workSlots().length, 0, 'a failed reauth leaves no staging account behind');
});

test('a CANCELLED reauth leaves the live account byte-identical', async () => {
  const dir = writeChatgptAccount('.codex-cancel', 'c@example.com');
  const before = authBytes(dir);
  process.env.FAKE_CODEX_SLEEP = '1';
  process.env.FAKE_ID_TOKEN = idToken('c@example.com');
  const r = openai.startChatgptLogin({ codexBin: MOCK, mode: 'browser', reauthDir: dir });
  assert.equal(r.ok, true, r.because);
  await waitFor(r.sessionId, (x) => x.state === 'awaiting-browser' || x.state === 'awaiting-code' || x.state === 'starting');
  const c = openai.cancelChatgptLogin(r.sessionId);
  assert.equal(c.ok, true);
  assert.equal(authBytes(dir), before, 'a cancelled reauth must not touch the live account');
  delete process.env.FAKE_CODEX_SLEEP;
  // staging cleaned once the killed child exits
  for (let i = 0; i < 200 && workSlots().length; i += 1) await new Promise((res) => setTimeout(res, 20));
  assert.equal(workSlots().length, 0, 'cancel removes the staging dir once the child exits');
});

test('a bogus reauth target is refused up front (not an account / an api-key account)', () => {
  // not a codex home at all
  const bad = openai.startChatgptLogin({ codexBin: MOCK, reauthDir: nodePath.join(SANDBOX, 'not-an-account') });
  assert.equal(bad.ok, false);
  assert.match(bad.because, /not an OpenAI account/i);
  // an api-key account cannot be reauthed via this flow
  const keyDir = nodePath.join(SANDBOX, '.codex-key');
  fs.mkdirSync(keyDir, { recursive: true });
  fs.writeFileSync(nodePath.join(keyDir, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-abc' }));
  const key = openai.startChatgptLogin({ codexBin: MOCK, reauthDir: keyDir });
  assert.equal(key.ok, false);
  assert.match(key.because, /API key/i);
});
