'use strict';
/**
 * #3391 subscription half: a Grok account signed in with `grok login --device-auth`
 * (auth.json, no key file). Covers identity + listing, the OFFLINE verdict, the free
 * work slot, and the sign-in driver end to end against a FAKE grok that prints the
 * device output measured from grok 1.0.41 and then approves, fails, exits without a
 * sign-in, or hangs.
 *
 *   node --test engine/grokaccounts.subscription-3391.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-grok-sub-3391-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
delete process.env.AGENT_WORKFORCE_GROK_HOME;
const grok = require('./grokaccounts');
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const ENTRY = (extra) => ({ 'https://auth.x.ai::0000-uuid': { email: 'person@example.com', auth_mode: 'oidc', ...extra } });
function writeAuth(dir, data) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'auth.json'), typeof data === 'string' ? data : JSON.stringify(data), { mode: 0o600 });
}
function fresh(name) {
  const d = nodePath.join(SANDBOX, name);
  fs.rmSync(d, { recursive: true, force: true });
  return d;
}

/* ---- identity + listing ---------------------------------------------------- */

test('an auth.json with one auth.x.ai entry is a subscription account, identified by its email', () => {
  const d = fresh('.grok-sub');
  writeAuth(d, ENTRY({ refresh_token: 'r' }));
  assert.deepEqual(grok.identityOf(d), { authMode: 'subscription', email: 'person@example.com', keyTail: null });
  const row = grok.list().find((a) => a.dir === d);
  assert.ok(row, 'the account is listed');
  assert.equal(row.authMode, 'subscription');
  assert.equal(row.email, 'person@example.com');
  assert.equal(row.keyTail, null);
});

test('the key file wins over an auth.json in the same dir (an api-key account)', () => {
  const d = fresh('.grok-both');
  writeAuth(d, ENTRY({ refresh_token: 'r' }));
  grok.storeKey(d, 'xai-key-9876');
  assert.deepEqual(grok.identityOf(d), { authMode: 'apikey', email: null, keyTail: '9876' });
});

test('two auth.x.ai entries, no entry, or bad JSON is not an account (we cannot say which sign-in grok uses)', () => {
  const two = fresh('.grok-two');
  writeAuth(two, { 'https://auth.x.ai::a': { email: 'a@x' }, 'https://auth.x.ai::b': { email: 'b@x' } });
  assert.equal(grok.identityOf(two), null);
  const none = fresh('.grok-none');
  writeAuth(none, { 'https://other.example::a': { email: 'a@x' } });
  assert.equal(grok.identityOf(none), null);
  const bad = fresh('.grok-bad');
  writeAuth(bad, '{not json');
  assert.equal(grok.identityOf(bad), null);
});

test('the DEFAULT ~/.grok with a subscription sign-in is listed as the default account', () => {
  const d = nodePath.join(SANDBOX, '.grok');
  fs.rmSync(d, { recursive: true, force: true });
  assert.equal(grok.list().find((a) => a.isDefault), undefined, 'CONTROL: no default row without a sign-in or key');
  writeAuth(d, ENTRY({ refresh_token: 'r' }));
  const row = grok.list()[0];
  assert.equal(row.isDefault, true);
  assert.equal(row.email, 'person@example.com');
  fs.rmSync(d, { recursive: true, force: true });
});

/* ---- the offline verdict ---------------------------------------------------- */

test('checkLive: a sign-in with a refresh token is CONNECTED', async () => {
  const d = fresh('.grok-live-refresh');
  writeAuth(d, ENTRY({ refresh_token: 'r', expires_at: '2000-01-01T00:00:00.000000Z' }));
  const v = await grok.checkLive(d);
  assert.equal(v.state, grok.STATE.CONNECTED, 'renewable even though the access token expired');
});

test('checkLive: no refresh token is CONNECTED before expiry and NONE after it', async () => {
  const d = fresh('.grok-live-exp');
  writeAuth(d, ENTRY({ expires_at: new Date(Date.now() + 3600e3).toISOString() }));
  assert.equal((await grok.checkLive(d)).state, grok.STATE.CONNECTED);
  writeAuth(d, ENTRY({ expires_at: '2000-01-01T00:00:00.123456Z' }));
  const lapsed = await grok.checkLive(d);
  assert.equal(lapsed.state, grok.STATE.NONE);
  assert.match(lapsed.because, /expired/);
});

test('checkLive: an unparseable expiry, or a file we cannot read, is UNKNOWN, never NONE', async () => {
  const d = fresh('.grok-live-unk');
  writeAuth(d, ENTRY({ expires_at: 'soon' }));
  assert.equal((await grok.checkLive(d)).state, grok.STATE.UNKNOWN);
  writeAuth(d, '{not json');
  assert.equal((await grok.checkLive(d)).state, grok.STATE.UNKNOWN);
});

test('checkLive: a dir with neither a key nor a sign-in is NONE (unchanged)', async () => {
  const d = fresh('.grok-empty');
  fs.mkdirSync(d, { recursive: true });
  assert.equal((await grok.checkLive(d)).state, grok.STATE.NONE);
});

test('nextWorkDir: a slot holding a sign-in is taken, not free', () => {
  for (const n of [1, 2, 3]) fs.rmSync(nodePath.join(SANDBOX, `.grok-work${n}`), { recursive: true, force: true });
  writeAuth(nodePath.join(SANDBOX, '.grok-work1'), ENTRY({ refresh_token: 'r' }));
  assert.equal(grok.nextWorkDir().label, 'work2');
  fs.rmSync(nodePath.join(SANDBOX, '.grok-work1'), { recursive: true, force: true });
});

/* ---- the output parser ------------------------------------------------------ */

test('parseGrokLoginOutput reads the measured device output; the code is not taken from inside the URL', () => {
  const measured = '\nTo sign in, open this URL in your browser:\n\n  https://accounts.x.ai/oauth2/device?user_code=JBXC-XGGR\n\nConfirm this code in your browser:\n\n  JBXC-XGGR\n\n\u001b[90mOnly continue with a code you requested.\u001b[0m\n\nWaiting for authorization...\n';
  assert.deepEqual(grok.parseGrokLoginOutput(measured), { authUrl: 'https://accounts.x.ai/oauth2/device?user_code=JBXC-XGGR', userCode: 'JBXC-XGGR' });
  // The URL alone carries a code-shaped token; it must not be read as the code.
  assert.deepEqual(grok.parseGrokLoginOutput('open https://accounts.x.ai/oauth2/device?user_code=AAAA-BBBB\n'), { authUrl: 'https://accounts.x.ai/oauth2/device?user_code=AAAA-BBBB' });
});

/* ---- the sign-in driver, against a fake grok -------------------------------- */

const FAKE = nodePath.join(SANDBOX, 'fake-grok.sh');
fs.writeFileSync(FAKE, [
  '#!/bin/bash',
  'printf "%s\\n" "$*" > "$FAKE_REC.argv"',
  'printf "%s\\n" "${XAI_API_KEY-<unset>}" > "$FAKE_REC.key"',
  'printf "%s\\n" "$GROK_HOME" > "$FAKE_REC.home"',
  'printf "\\nTo sign in, open this URL in your browser:\\n\\n  https://accounts.x.ai/oauth2/device?user_code=QWER-TYUI\\n\\nConfirm this code in your browser:\\n\\n  QWER-TYUI\\n\\nWaiting for authorization...\\n"',
  'case "$FAKE_MODE" in',
  '  approve) sleep 0.3; printf \'{"https://auth.x.ai::u1":{"email":"sub@example.com","refresh_token":"r"}}\' > "$GROK_HOME/auth.json"; exit 0 ;;',
  '  fail) sleep 0.2; exit 1 ;;',
  '  noauth) sleep 0.2; exit 0 ;;',
  '  hang) exec sleep 30 ;;',
  'esac',
].join('\n') + '\n', { mode: 0o755 });

function waitFor(pred, ms = 5000) {
  const until = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => {
      let v; try { v = pred(); } catch (e) { reject(e); return; }
      if (v) { resolve(v); return; }
      if (Date.now() > until) { reject(new Error('timed out waiting')); return; }
      setTimeout(tick, 25);
    };
    tick();
  });
}
function withMode(mode, fn) {
  const rec = nodePath.join(SANDBOX, `rec-${mode}-${Math.random().toString(36).slice(2)}`);
  process.env.FAKE_MODE = mode;
  process.env.FAKE_REC = rec;
  process.env.XAI_API_KEY = 'ambient-key-must-not-reach-grok';
  return fn(rec).finally(() => { delete process.env.XAI_API_KEY; });
}

test('driver: approve -> awaiting-code with the URL and code -> connected with a subscription row', () => withMode('approve', async (rec) => {
  const out = grok.startGrokLogin({ label: 'mine', grokBin: FAKE });
  assert.equal(out.ok, true);
  const dir = nodePath.join(SANDBOX, '.grok-mine');
  const mid = await waitFor(() => { const s = grok.grokLoginStatus(out.sessionId); return s.userCode ? s : null; });
  assert.equal(mid.userCode, 'QWER-TYUI');
  assert.equal(mid.authUrl, 'https://accounts.x.ai/oauth2/device?user_code=QWER-TYUI');
  const done = await waitFor(() => { const s = grok.grokLoginStatus(out.sessionId); return s.state === 'connected' ? s : null; });
  assert.equal(done.account.authMode, 'subscription');
  assert.equal(done.account.email, 'sub@example.com');
  assert.equal(done.account.name, 'mine', 'the typed name is kept');
  assert.equal(fs.readFileSync(rec + '.key', 'utf8').trim(), '<unset>', 'grok ran with XAI_API_KEY REMOVED, not blanked');
  assert.equal(fs.readFileSync(rec + '.home', 'utf8').trim(), dir, 'GROK_HOME is the new account dir');
  const argv = fs.readFileSync(rec + '.argv', 'utf8').trim();
  assert.equal(argv, `login --device-auth --leader-socket ${nodePath.join(dir, 'leader-kosmos.sock')}`, 'its leader socket is inside the account dir, not ~/.grok');
  assert.ok(grok.list().some((a) => a.dir === dir), 'the account is listed afterwards');
}));

test('driver: a non-zero exit is an error and the dir it made is removed', () => withMode('fail', async () => {
  const out = grok.startGrokLogin({ label: 'failing', grokBin: FAKE });
  const s = await waitFor(() => { const x = grok.grokLoginStatus(out.sessionId); return x.state === 'error' ? x : null; });
  assert.match(s.error, /did not complete/);
  await waitFor(() => !fs.existsSync(nodePath.join(SANDBOX, '.grok-failing')));
}));

test('driver: exit 0 without a usable sign-in is an error, not a connected account', () => withMode('noauth', async () => {
  const out = grok.startGrokLogin({ label: 'hollow', grokBin: FAKE });
  const s = await waitFor(() => { const x = grok.grokLoginStatus(out.sessionId); return x.state === 'error' ? x : null; });
  assert.equal(s.account, null);
  await waitFor(() => !fs.existsSync(nodePath.join(SANDBOX, '.grok-hollow')));
}));

test('driver: cancel ends a pending sign-in, frees its slot, and removes its dir; forget/remove refuse it while pending', () => withMode('hang', async () => {
  grok.setGrokTimers({ forceKill: 200 });
  const out = grok.startGrokLogin({ label: 'pending', grokBin: FAKE });
  const dir = nodePath.join(SANDBOX, '.grok-pending');
  await waitFor(() => grok.grokLoginStatus(out.sessionId).userCode);
  assert.match(grok.forgetAccount(dir, []).because, /still in progress/);
  assert.match(grok.removeAccount(dir, []).because, /still in progress/);
  const again = grok.startGrokLogin({ label: 'pending', grokBin: FAKE });
  assert.equal(again.ok, false, 'a second sign-in for the same name is refused while one is pending');
  assert.deepEqual(grok.cancelGrokLogin(out.sessionId), { ok: true, cancelled: true });
  assert.equal(grok.grokLoginStatus(out.sessionId).state, 'cancelled');
  await waitFor(() => !fs.existsSync(dir));
  assert.deepEqual(grok.cancelGrokLogin(out.sessionId), { ok: true, cancelled: false }, 'cancelling a settled sign-in claims nothing');
}));

test('driver: the watchdog ends an abandoned sign-in as an error', () => withMode('hang', async () => {
  grok.setGrokTimers({ timeout: 300, forceKill: 200 });
  const out = grok.startGrokLogin({ label: 'abandoned', grokBin: FAKE });
  const s = await waitFor(() => { const x = grok.grokLoginStatus(out.sessionId); return x.state === 'error' ? x : null; });
  assert.match(s.error, /timed out/);
  await waitFor(() => !fs.existsSync(nodePath.join(SANDBOX, '.grok-abandoned')));
  grok.setGrokTimers({ timeout: 5 * 60 * 1000 });
}));

test('driver: a name that already holds an account is refused before anything runs', () => {
  const d = fresh('.grok-taken');
  writeAuth(d, ENTRY({ refresh_token: 'r' }));
  const out = grok.startGrokLogin({ label: 'taken', grokBin: FAKE });
  assert.equal(out.ok, false);
  assert.match(out.because, /already a Grok account/);
  assert.ok(fs.existsSync(nodePath.join(d, 'auth.json')), 'the existing account is untouched');
});

test('driver: no runner binary is refused', () => {
  assert.equal(grok.startGrokLogin({ label: 'x', grokBin: '' }).ok, false);
});
