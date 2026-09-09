'use strict';
/**
 * #2338: the ChatGPT (subscription) sign-in DRIVER lifecycle -- spawn `codex login`
 * async into a fresh isolated CODEX_HOME, watch it, and on a clean exit hand off to
 * finishChatgptLogin (the connected gate). This drives the whole lifecycle against a
 * MOCK codex (a tiny executable that writes a chatgpt auth.json and exits, or fails,
 * or sleeps): the device-auth stdout URL/code PARSER IS exercised here -- the mock
 * prints a real-format URL + device code (measured against codex 0.149.1, 2026-09-09)
 * and the test asserts chatgptLoginStatus surfaces them -- so only the BROWSER-mode
 * output remains verified at the release gate under a real ChatGPT subscription.
 * Everything else -- session state machine, exit -> connected, failure cleanup, cancel
 * cleanup, non-runnable refusal -- is pinned here.
 *
 *   node --test engine/openaiaccounts.chatgpt-driver-2338.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-chatgpt-driver-2338-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;

const openai = require('./openaiaccounts');

// A ChatGPT id_token whose middle segment (base64url) carries the email.
function idToken(email) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ email })}.`;
}
const ID_TOKEN = idToken('pete@example.com');

// A mock `codex`: prints a URL + code, then (normal) writes a chatgpt auth.json into
// CODEX_HOME and exits 0; (FAIL) exits 1 with no auth.json; (SLEEP) prints then sleeps
// so a cancel can kill it mid-flight.
const MOCK = nodePath.join(SANDBOX, 'codex-mock.sh');
fs.writeFileSync(MOCK, `#!/bin/bash
if [ "$FAKE_CODEX_FAIL" = "1" ]; then echo "sign-in failed" >&2; exit 1; fi
if [ "$FAKE_CODEX_IGNORE_TERM" = "1" ]; then trap '' TERM; echo "waiting..."; sleep 60; exit 0; fi
if [ "$FAKE_CODEX_TRICKY" = "1" ]; then
  # a URL with trailing punctuation, and an 8-char alnum token INSIDE the URL that
  # must NOT be mistaken for the real hyphenated device code that follows it. The
  # code is the REAL 4-5 shape measured 2026-09-09 (3PI3-2LM3M), which the old
  # fixed {4}-{4} regex missed -- this fixture would return userCode:null pre-fix.
  echo "Go to https://auth.openai.com/AB12CD34. Then enter 3PI3-2LM3M"
else
  echo "Sign in at https://auth.openai.com/device and enter code WXYZ-1234"
fi
if [ "$FAKE_CODEX_SLEEP" = "1" ]; then sleep 30; exit 0; fi
if [ "$FAKE_CODEX_APIKEY" = "1" ]; then printf '{"auth_mode":"apikey","OPENAI_API_KEY":"sk-x"}' > "$CODEX_HOME/auth.json"; exit 0; fi
printf '{"auth_mode":"chatgpt","tokens":{"id_token":"%s"}}' "$FAKE_ID_TOKEN" > "$CODEX_HOME/auth.json"
exit 0
`);
fs.chmodSync(MOCK, 0o755);
process.env.FAKE_ID_TOKEN = ID_TOKEN;

// Poll chatgptLoginStatus until predicate(status) or a timeout.
async function waitFor(sessionId, pred, ms = 4000) {
  const start = Date.now();
  for (;;) {
    const s = openai.chatgptLoginStatus(sessionId);
    if (pred(s)) return s;
    if (Date.now() - start > ms) throw new Error(`timeout; last state=${s.state} error=${s.error}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('start spawns codex login and, on a clean exit with a chatgpt auth.json, reaches connected with the account', async () => {
  delete process.env.FAKE_CODEX_FAIL; delete process.env.FAKE_CODEX_SLEEP;
  const r = openai.startChatgptLogin({ codexBin: MOCK, mode: 'browser' });
  assert.equal(r.ok, true, r.because);
  assert.equal(r.mode, 'browser');
  const s = await waitFor(r.sessionId, (x) => x.state === 'connected' || x.state === 'error');
  assert.equal(s.state, 'connected', s.error);
  assert.equal(s.account.authMode, 'chatgpt');
  assert.equal(s.account.email, 'pete@example.com');
  assert.equal(s.account.keyTail, null);
});

test('device mode passes --device-auth and the account lands connected', async () => {
  delete process.env.FAKE_CODEX_FAIL; delete process.env.FAKE_CODEX_SLEEP;
  const r = openai.startChatgptLogin({ codexBin: MOCK, mode: 'device', label: 'Side' });
  assert.equal(r.ok, true, r.because);
  assert.equal(r.mode, 'device');
  const s = await waitFor(r.sessionId, (x) => x.state === 'connected' || x.state === 'error');
  assert.equal(s.state, 'connected', s.error);
  assert.equal(s.account.authMode, 'chatgpt');
});

test('a failed codex login (nonzero exit) reaches error and removes the dir it created', async () => {
  process.env.FAKE_CODEX_FAIL = '1';
  const r = openai.startChatgptLogin({ codexBin: MOCK, label: 'willfail' });
  assert.equal(r.ok, true, r.because);
  const s = await waitFor(r.sessionId, (x) => x.state === 'error' || x.state === 'connected');
  assert.equal(s.state, 'error');
  assert.equal(fs.existsSync(nodePath.join(SANDBOX, '.codex-willfail')), false, 'a failed sign-in leaves no half-made account');
  delete process.env.FAKE_CODEX_FAIL;
});

test('cancel kills the child and removes the created dir', async () => {
  process.env.FAKE_CODEX_SLEEP = '1';
  const r = openai.startChatgptLogin({ codexBin: MOCK, label: 'cancelme' });
  assert.equal(r.ok, true, r.because);
  await waitFor(r.sessionId, (x) => x.state === 'awaiting-browser' || x.state === 'awaiting-code' || x.state === 'starting');
  const c = openai.cancelChatgptLogin(r.sessionId);
  assert.equal(c.ok, true);
  assert.equal(c.cancelled, true);
  assert.equal(openai.chatgptLoginStatus(r.sessionId).state, 'cancelled');
  // The dir is removed when the KILLED child actually exits (async), not
  // synchronously in cancel -- so a concurrent start can never reuse a dir the
  // dying child still owns. Poll for it.
  const dirGone = async () => {
    for (let i = 0; i < 200; i += 1) {
      if (!fs.existsSync(nodePath.join(SANDBOX, '.codex-cancelme'))) return true;
      await new Promise((res) => setTimeout(res, 20));
    }
    return false;
  };
  assert.equal(await dirGone(), true, 'cancel removes the dir it created once the child exits');
  delete process.env.FAKE_CODEX_SLEEP;
});

test('a non-runnable codexBin is refused', () => {
  const r = openai.startChatgptLogin({ codexBin: nodePath.join(SANDBOX, 'no-such-codex'), mode: 'browser' });
  assert.equal(r.ok, false);
  assert.match(r.because, /runner/i);
});

test('status for an unknown session is a clean refusal', () => {
  const r = openai.chatgptLoginStatus('deadbeef');
  assert.equal(r.ok, false);
});

// #2338 iter-1 (resource bounds). Always restore the real timers after a test
// that shrank them, so a later test is never run with a 60ms watchdog.
const REAL_TIMERS = { timeout: 5 * 60 * 1000, ttl: 2 * 60 * 1000 };
test.afterEach(() => { openai.setChatgptTimers(REAL_TIMERS); });

test('an ABANDONED sign-in (never cancelled) is killed by the watchdog and errors, not left running forever', async () => {
  openai.setChatgptTimers({ timeout: 60, ttl: 100000 }); // 60ms watchdog; long ttl so the errored session lingers to be read
  process.env.FAKE_CODEX_SLEEP = '1'; // the mock prints, then sleeps 30s (never exits on its own)
  const r = openai.startChatgptLogin({ codexBin: MOCK, label: 'abandoned' });
  assert.equal(r.ok, true, r.because);
  const s = await waitFor(r.sessionId, (x) => x.state === 'error' || x.state === 'connected');
  assert.equal(s.state, 'error', 'the watchdog terminates a sign-in the user walked away from');
  assert.match(s.error, /timed out/);
  // The watchdog kills the child; the dir is removed when that child actually
  // exits (async), so poll for it.
  const dirGone = async () => {
    for (let i = 0; i < 200; i += 1) {
      if (!fs.existsSync(nodePath.join(SANDBOX, '.codex-abandoned'))) return true;
      await new Promise((res) => setTimeout(res, 20));
    }
    return false;
  };
  assert.equal(await dirGone(), true, 'the watchdog removes the dir it created once the killed child exits');
  delete process.env.FAKE_CODEX_SLEEP;
});

test('a SETTLED session is dropped from the Map after the read-grace TTL (no unbounded growth)', async () => {
  openai.setChatgptTimers({ timeout: 100000, ttl: 200 }); // long watchdog; 200ms grace
  delete process.env.FAKE_CODEX_FAIL; delete process.env.FAKE_CODEX_SLEEP;
  const r = openai.startChatgptLogin({ codexBin: MOCK, label: 'reapme' });
  assert.equal(r.ok, true, r.because);
  const s = await waitFor(r.sessionId, (x) => x.state === 'connected' || x.state === 'error');
  assert.equal(s.state, 'connected', s.error);
  assert.equal(openai.chatgptLoginStatus(r.sessionId).ok, true, 'readable within the grace window');
  await new Promise((res) => setTimeout(res, 400)); // > ttl
  assert.equal(openai.chatgptLoginStatus(r.sessionId).ok, false, 'the session is reaped once the TTL elapses');
});

test('concurrent UNLABELLED starts get DIFFERENT work slots (no shared CODEX_HOME)', async () => {
  process.env.FAKE_CODEX_SLEEP = '1'; // both stay pending, holding their slots
  const before = new Set(fs.readdirSync(SANDBOX).filter((n) => n.startsWith('.codex-work')));
  const a = openai.startChatgptLogin({ codexBin: MOCK });
  const b = openai.startChatgptLogin({ codexBin: MOCK });
  assert.equal(a.ok, true, a.because);
  assert.equal(b.ok, true, b.because);
  assert.notEqual(a.sessionId, b.sessionId);
  const created = fs.readdirSync(SANDBOX).filter((n) => n.startsWith('.codex-work') && !before.has(n));
  assert.equal(created.length, 2, 'two concurrent unlabelled starts reserved two distinct slots, not one shared dir');
  openai.cancelChatgptLogin(a.sessionId);
  openai.cancelChatgptLogin(b.sessionId);
  delete process.env.FAKE_CODEX_SLEEP;
});

test('cancelling an ALREADY-CONNECTED session does not regress it (cancelled:false, account kept)', async () => {
  openai.setChatgptTimers({ timeout: 100000, ttl: 100000 }); // keep the session readable
  delete process.env.FAKE_CODEX_FAIL; delete process.env.FAKE_CODEX_SLEEP; delete process.env.FAKE_CODEX_TRICKY;
  const r = openai.startChatgptLogin({ codexBin: MOCK, label: 'keepme' });
  const s = await waitFor(r.sessionId, (x) => x.state === 'connected' || x.state === 'error');
  assert.equal(s.state, 'connected', s.error);
  const c = openai.cancelChatgptLogin(r.sessionId);
  assert.equal(c.ok, true);
  assert.equal(c.cancelled, false, 'a settled session has nothing to cancel');
  const after = openai.chatgptLoginStatus(r.sessionId);
  assert.equal(after.state, 'connected', 'cancel must NOT overwrite a connected state');
  assert.ok(after.account, 'the real account is preserved');
});

test('the auth prompt is parsed cleanly: no trailing URL punctuation, and a URL token is not the device code', async () => {
  delete process.env.FAKE_CODEX_FAIL; delete process.env.FAKE_CODEX_SLEEP;
  process.env.FAKE_CODEX_TRICKY = '1';
  const r = openai.startChatgptLogin({ codexBin: MOCK, mode: 'device', label: 'tricky' });
  assert.equal(r.ok, true, r.because);
  // Wait specifically until the PARSER has produced the code (the field this test
  // asserts), never merely on 'connected' -- exit can be observed before the final
  // stdout flush is parsed, which would read authUrl/userCode as undefined.
  const s = await waitFor(r.sessionId, (x) => !!x.userCode || x.state === 'error');
  assert.equal(s.authUrl, 'https://auth.openai.com/AB12CD34', 'the trailing period is trimmed from the URL');
  assert.equal(s.userCode, '3PI3-2LM3M', 'the real 4-5 hyphenated code (measured 2026-09-09), not the AB12CD34 token inside the URL');
  delete process.env.FAKE_CODEX_TRICKY;
});

test('a child that IGNORES SIGTERM is SIGKILLed, so its slot and dir are still freed (no slot exhaustion)', async () => {
  openai.setChatgptTimers({ timeout: 40, forceKill: 60, ttl: 100000 }); // 40ms watchdog, 60ms force-kill
  process.env.FAKE_CODEX_IGNORE_TERM = '1';
  const r = openai.startChatgptLogin({ codexBin: MOCK, label: 'stubborn' });
  assert.equal(r.ok, true, r.because);
  const s = await waitFor(r.sessionId, (x) => x.state === 'error');
  assert.match(s.error, /timed out/);
  // SIGTERM is trapped/ignored by the mock; only the SIGKILL escalation makes it
  // exit, and only the exit frees the dir. Poll for it (proving the escalation ran).
  const dirGone = async () => {
    for (let i = 0; i < 300; i += 1) {
      if (!fs.existsSync(nodePath.join(SANDBOX, '.codex-stubborn'))) return true;
      await new Promise((res) => setTimeout(res, 20));
    }
    return false;
  };
  assert.equal(await dirGone(), true, 'SIGKILL escalation frees the slot even when SIGTERM is ignored');
  delete process.env.FAKE_CODEX_IGNORE_TERM;
});

test('a REUSED auth-less slot where codex writes a non-subscription auth.json is not left as a spurious account', async () => {
  openai.setChatgptTimers({ timeout: 100000, ttl: 100000 });
  delete process.env.FAKE_CODEX_SLEEP; delete process.env.FAKE_CODEX_FAIL; delete process.env.FAKE_CODEX_IGNORE_TERM;
  process.env.FAKE_CODEX_APIKEY = '1';
  // Pre-create the labelled dir WITHOUT an auth.json, so the driver REUSES it
  // (madeDir=false via EEXIST) rather than creating it.
  const dir = nodePath.join(SANDBOX, '.codex-reuse');
  fs.mkdirSync(dir, { recursive: true });
  const before = openai.list().length;
  const r = openai.startChatgptLogin({ codexBin: MOCK, label: 'reuse' });
  assert.equal(r.ok, true, r.because);
  const s = await waitFor(r.sessionId, (x) => x.state === 'error' || x.state === 'connected');
  assert.equal(s.state, 'error', 'an api-key login is refused as not a subscription');
  assert.equal(fs.existsSync(nodePath.join(dir, 'auth.json')), false, 'the refused api-key auth.json is removed from the reused slot');
  assert.equal(openai.list().length, before, 'the reused slot did not become a spurious listed account');
  delete process.env.FAKE_CODEX_APIKEY;
});

test('the api-key flow will not write into a slot a live ChatGPT sign-in holds (no cross-flow credential clobber)', async () => {
  openai.setChatgptTimers({ timeout: 100000, ttl: 100000 });
  delete process.env.FAKE_CODEX_APIKEY; delete process.env.FAKE_CODEX_FAIL;
  process.env.FAKE_CODEX_SLEEP = '1'; // the chatgpt child stays pending, HOLDING .codex-crossflow
  const cg = openai.startChatgptLogin({ codexBin: MOCK, label: 'crossflow' });
  assert.equal(cg.ok, true, cg.because);
  await waitFor(cg.sessionId, (x) => x.state !== 'starting'); // spawned + slot reserved
  // Without the fix, addWithKey would write an api-key auth.json into .codex-crossflow,
  // and the sign-in's later anti-litter would then destroy that api-key account.
  const ak = openai.addWithKey({ key: 'sk-testkeytestkeytestkey', codexBin: MOCK, label: 'crossflow' });
  assert.equal(ak.ok, false, 'the api-key add cannot target a name a live sign-in holds');
  assert.match(ak.because, /in progress/);
  assert.equal(fs.existsSync(nodePath.join(SANDBOX, '.codex-crossflow', 'auth.json')), false, 'no api-key credential was written into the reserved sign-in slot');
  openai.cancelChatgptLogin(cg.sessionId);
  delete process.env.FAKE_CODEX_SLEEP;
});

test.after(() => { openai.setChatgptTimers({ timeout: 5 * 60 * 1000, ttl: 2 * 60 * 1000 }); try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
