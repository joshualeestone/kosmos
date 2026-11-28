'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * #3391 part 2: signing a Grok subscription account in AGAIN (startGrokLogin with
 * `reauthDir`). The sign-in runs in a staging slot, and only one that finishes as the
 * SAME email is moved over the live auth.json. Driven against a FAKE grok that signs in
 * as $FAKE_EMAIL, fails, finishes with no sign-in, or hangs.
 *
 *   node --test engine/grokaccounts.reauth-3391.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-grok-reauth-3391-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
delete process.env.AGENT_WORKFORCE_GROK_HOME;
const grok = require('./grokaccounts');
const { eventually } = require('../test-support/eventually');
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const FAKE = nodePath.join(SANDBOX, 'fake-grok.js');
fs.writeFileSync(FAKE, [
  '#!/usr/bin/env node',
  "'use strict';",
  "const fs = require('fs');",
  // Every write is synchronous, so nothing printed or written is lost when the script exits right after it. A failed
  // file write is reported on stderr and the script carries on, as a failed bash redirect does.
  "const say = (s) => fs.writeSync(1, s);",
  "const put = (file, text) => { try { fs.writeFileSync(file, text); } catch (e) { fs.writeSync(2, String(e.message) + '\\n'); } };",
  "const home = process.env.GROK_HOME || '';",
  "say('\\nTo sign in, open this URL in your browser:\\n\\n  https://accounts.x.ai/oauth2/device?user_code=QWER-TYUI\\n\\nConfirm this code in your browser:\\n\\n  QWER-TYUI\\n\\n');",
  "const mode = process.env.FAKE_MODE;",
  "if (mode === 'approve') setTimeout(() => {",
  "  try { fs.mkdirSync(home + '/logs', { recursive: true }); } catch (e) { fs.writeSync(2, String(e.message) + '\\n'); }",
  "  put(home + '/auth.json', '{\"https://auth.x.ai::u2\":{\"email\":\"' + (process.env.FAKE_EMAIL || '') + '\",\"refresh_token\":\"NEW\"}}');",
  "  process.exit(0);",
  "}, 200);",
  "else if (mode === 'fail') setTimeout(() => process.exit(1), 200);",
  "else if (mode === 'noauth') setTimeout(() => process.exit(0), 200);",
  "else if (mode === 'hang') setTimeout(() => process.exit(0), 30000);",
].join('\n') + '\n', { mode: 0o755 });
fs.chmodSync(FAKE, 0o755);   // runnable on the Mac by its mode; Windows runs it by its .js name (PATHEXT)

/* kosmos#9269: FAKE is a node script named .js, so it runs on every platform: startGrokLogin starts a .js grok as
   this node with the script as its first argument (engine/tunnelcommand.js), and Windows counts a .js file as
   runnable by its extension (PATHEXT) where the Mac needs its 0755 mode. So the arms that sign in again run on
   Windows too. A start refused before anything is spawned needs only a runner Windows counts as runnable: PRESENT. */
/* kosmos#9269: the two arms that fail a rename lock the account folder with chmod on the Mac and Linux. Windows does
   not enforce chmod, so there the same call the chmod makes fail (fs.renameSync in promoteReauth, which reaches fs
   through the module object at call time) is made to fail instead, with the code the chmod gives it (EACCES), for a
   rename into or out of that folder only. Each arm asserts the same outcome either way.
   KOSMOS_TEST_CHMOD_STUB=1 takes the Windows path on any platform, so it can be run (and broken) on the Mac. */
const CHMOD_VIA_STUB = process.platform === 'win32' || process.env.KOSMOS_TEST_CHMOD_STUB === '1';
function lockedFolder(dir) {
  const locked = nodePath.resolve(dir);
  if (!CHMOD_VIA_STUB) { fs.chmodSync(dir, 0o500); return () => fs.chmodSync(dir, 0o700); }
  const orig = fs.renameSync;
  const inside = (p) => nodePath.dirname(nodePath.resolve(String(p))) === locked;
  fs.renameSync = function renameSync(from, to) {
    if (inside(from) || inside(to)) throw Object.assign(new Error('EACCES: permission denied, rename (a stand-in for chmod 0500, kosmos#9269)'), { code: 'EACCES' });
    return orig.apply(this, arguments);
  };
  return () => { fs.renameSync = orig; };
}
const PRESENT = require('../test-support/runnerstub').writeRunnerStub(nodePath.join(SANDBOX, 'bin'), 'grok');

const OLD = JSON.stringify({ 'https://auth.x.ai::u1': { email: 'me@example.com', refresh_token: 'OLD' } });
function account(name, body = OLD) {
  const d = nodePath.join(SANDBOX, name);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(nodePath.join(d, 'auth.json'), body, { mode: 0o600 });
  fs.writeFileSync(nodePath.join(d, '.kosmos-name'), 'Work');
  return d;
}
const auth = (d) => fs.readFileSync(nodePath.join(d, 'auth.json'), 'utf8');
/* Every grok dir in the home: a staging slot left behind, or a second account, shows here. */
const grokDirs = () => fs.readdirSync(SANDBOX).filter((n) => n === '.grok' || n.startsWith('.grok-')).sort();

// #5727: delegate to the shared load-aware poll helper. At scale 1 this is
// byte-identical to the former hand-rolled loop (25ms step, resolves the first
// truthy pred() value, fails at ms); under load the deadline scales with the box.
function waitFor(pred, ms = 15000) {
  return eventually(pred, (v) => v, { timeoutMs: ms, stepMs: 25 });
}
const settled = (id) => waitFor(() => { const s = grok.grokLoginStatus(id); return s.state === 'connected' || s.state === 'error' || s.state === 'cancelled' ? s : null; });
const NO_SYMLINK = require('../test-support/skip-on-win32').skipOnWin32('it makes a symlink, which needs elevation or Developer Mode on Windows');   // kosmos#8378
function withMode(mode, email, fn) {
  process.env.FAKE_MODE = mode;
  process.env.FAKE_EMAIL = email;
  return fn();
}

test('sign in again as the same email replaces the live sign-in and makes no second account', () => withMode('approve', 'me@example.com', async () => {
  const live = account('.grok-work');
  const before = grokDirs();
  const out = grok.startGrokLogin({ grokBin: FAKE, reauthDir: live, label: 'ignored' });
  assert.equal(out.ok, true);
  const s = await settled(out.sessionId);
  assert.equal(s.state, 'connected', JSON.stringify(s));
  assert.equal(s.account.dir, live, 'the row is the live account, not the staging slot');
  assert.equal(s.account.name, 'Work', 'the account keeps its own name; the label is ignored');
  assert.match(auth(live), /"NEW"/, 'the new sign-in is in the live account');
  await waitFor(() => grokDirs().join() === before.join());
  assert.deepEqual(grokDirs(), before, 'the staging slot is gone and no account was added');
  assert.equal(grok.list().filter((a) => a.email === 'me@example.com').length, 1);
}));

test('a sign-in as a DIFFERENT email leaves the live account byte for byte', () => withMode('approve', 'someone-else@example.com', async () => {
  const live = account('.grok-swap');
  const before = grokDirs();
  const out = grok.startGrokLogin({ grokBin: FAKE, reauthDir: live });
  const s = await settled(out.sessionId);
  assert.equal(s.state, 'error');
  assert.match(s.error, /different account/);
  assert.equal(auth(live), OLD);
  await waitFor(() => grokDirs().join() === before.join());
  assert.ok(!grok.list().some((a) => a.email === 'someone-else@example.com'), 'the other sign-in is not left behind as an account');
}));

test('a failed, empty or cancelled sign-in again never touches the live account', async () => {
  for (const mode of ['fail', 'noauth']) {
    await withMode(mode, 'me@example.com', async () => {
      const live = account('.grok-' + mode);
      const before = grokDirs();
      const out = grok.startGrokLogin({ grokBin: FAKE, reauthDir: live });
      const s = await settled(out.sessionId);
      assert.equal(s.state, 'error', mode);
      if (mode === 'noauth') assert.match(s.error, /could not confirm/);
      assert.equal(auth(live), OLD, mode);
      await waitFor(() => grokDirs().join() === before.join());
    });
  }
  await withMode('hang', 'me@example.com', async () => {
    grok.setGrokTimers({ forceKill: 200 });
    const live = account('.grok-held');
    const before = grokDirs();
    const out = grok.startGrokLogin({ grokBin: FAKE, reauthDir: live });
    await waitFor(() => grok.grokLoginStatus(out.sessionId).userCode);
    // #6000: a forget or remove of the account now CANCELS its own sign-in again instead of refusing
    // (engine/grokaccounts.reauthcancel-6000.test.js); a second sign-in again is still refused while it runs, and any
    // other hold still refuses forget/remove (grokaccounts.subscription-3391.test.js, a pending named sign-in).
    const twice = grok.startGrokLogin({ grokBin: FAKE, reauthDir: live });
    assert.equal(twice.ok, false);
    assert.match(twice.because, /already in progress/);
    grok.cancelGrokLogin(out.sessionId);
    await waitFor(() => grokDirs().join() === before.join());
    assert.equal(auth(live), OLD);
    assert.equal(grok.isSignInPending(live), false, 'released once the sign-in ended');
    assert.equal(grok.forgetAccount(live, []).ok, true, 'the account can be forgotten after a cancelled sign-in again');
  });
});

test('the DEFAULT ~/.grok can be signed in again, and stays the default', () => withMode('approve', 'me@example.com', async () => {
  const live = account('.grok');
  const out = grok.startGrokLogin({ grokBin: FAKE, reauthDir: live });
  const s = await settled(out.sessionId);
  assert.equal(s.state, 'connected', JSON.stringify(s));
  assert.equal(s.account.isDefault, true);
  assert.match(auth(live), /"NEW"/);
  fs.rmSync(live, { recursive: true, force: true });
}));

test('reauthTarget refuses what is not a Grok subscription account with an email', () => {
  const keyed = account('.grok-keyed');
  grok.storeKey(keyed, 'xai-key-1234567890');
  assert.match(grok.reauthTarget(keyed).error, /API key/);
  const noEmail = account('.grok-noemail', JSON.stringify({ 'https://auth.x.ai::u': { refresh_token: 'r' } }));
  assert.match(grok.reauthTarget(noEmail).error, /identity/);
  const outside = account('not-grok');
  assert.match(grok.reauthTarget(outside).error, /not a Grok account/);
  const codex = account('.codex-work');
  assert.match(grok.reauthTarget(codex).error, /not a Grok account/);
  const empty = nodePath.join(SANDBOX, '.grok-empty');
  fs.mkdirSync(empty, { recursive: true });
  assert.match(grok.reauthTarget(empty).error, /no readable sign-in/);
  assert.equal(grok.reauthTarget(account('.grok-ok')).expectEmail, 'me@example.com', 'CONTROL: a real one is accepted');
  const r = grok.startGrokLogin({ grokBin: PRESENT, reauthDir: keyed });
  assert.equal(r.ok, false, 'the driver refuses before anything runs');
  assert.ok(!grokDirs().some((n) => /^\.grok-work\d/.test(n)), 'no staging slot was made for a refused target');
});

test('the same email in different capitals is the same account', () => withMode('approve', 'Me@Example.COM', async () => {
  const live = account('.grok-caps');
  const out = grok.startGrokLogin({ grokBin: FAKE, reauthDir: live });
  const s = await settled(out.sessionId);
  assert.equal(s.state, 'connected', JSON.stringify(s));
  assert.match(auth(live), /"NEW"/);
}));

test('a symlinked account dir is refused, so the rename cannot write through the link', { skip: NO_SYMLINK }, () => {
  const real = account('real-target');
  const link = nodePath.join(SANDBOX, '.grok-linked');
  fs.rmSync(link, { force: true });
  fs.symlinkSync(real, link);
  assert.equal(grok.identityOf(link).email, 'me@example.com', 'CONTROL: through the link it reads as an account');
  assert.match(grok.reauthTarget(link).error, /not a Grok account/);
});

test('a sign-in again the watchdog ends leaves the live account and frees it', () => withMode('hang', 'me@example.com', async () => {
  grok.setGrokTimers({ timeout: 300, forceKill: 200 });
  try {
    const live = account('.grok-slow');
    const before = grokDirs();
    const out = grok.startGrokLogin({ grokBin: FAKE, reauthDir: live });
    const s = await settled(out.sessionId);
    assert.equal(s.state, 'error');
    assert.match(s.error, /timed out/);
    await waitFor(() => grokDirs().join() === before.join());
    assert.equal(auth(live), OLD);
    await waitFor(() => grok.forgetAccount(live, []).ok === true || null);
  } finally {
    grok.setGrokTimers({ timeout: 5 * 60 * 1000 });
  }
}));

test('a rename that fails reports it and leaves the live account as it was', () => withMode('approve', 'me@example.com', async () => {
  const live = account('.grok-ro');
  const before = grokDirs();
  const unlock = lockedFolder(live);   // the live dir cannot take a new file, so the rename fails
  try {
    const out = grok.startGrokLogin({ grokBin: FAKE, reauthDir: live });
    const s = await settled(out.sessionId);
    assert.equal(s.state, 'error', JSON.stringify(s));
    assert.match(s.error, /could not update this account/);
    assert.equal(auth(live), OLD);
    await waitFor(() => grokDirs().join() === before.join());
  } finally {
    unlock();
  }
}));

/* Review pass 3: a NEW sign-in as someone who already has an account here (a lapsed
   ~/.grok, which first run offers Connect for) refreshes that account, not a second one. */
test('a new sign-in as an email already here refreshes that account instead of adding one', () => withMode('approve', 'SOLO@example.com', async () => {
  // Its own email: earlier tests leave several me@example.com accounts, which is the no-guess case.
  const live = account('.grok', JSON.stringify({ 'https://auth.x.ai::u1': { email: 'solo@example.com', expires_at: '2000-01-01T00:00:00Z' } }));
  const before = grokDirs();
  const out = grok.startGrokLogin({ grokBin: FAKE });
  const s = await settled(out.sessionId);
  assert.equal(s.state, 'connected', JSON.stringify(s));
  assert.equal(s.account.dir, live, 'the existing account, not a new slot');
  assert.equal(s.account.isDefault, true);
  assert.match(auth(live), /"NEW"/, 'its lapsed sign-in is replaced');
  await waitFor(() => grokDirs().join() === before.join());
  assert.equal(grok.list().filter((a) => (a.email || '').toLowerCase() === 'solo@example.com').length, 1, 'one account for that person');
  fs.rmSync(live, { recursive: true, force: true });
}));

test('two accounts with that email, or one being signed in, leave the new sign-in as its own account', async () => {
  await withMode('approve', 'twice@example.com', async () => {
    const both = JSON.stringify({ 'https://auth.x.ai::u1': { email: 'twice@example.com', refresh_token: 'OLD' } });
    const a = account('.grok-twa', both);
    const b = account('.grok-twb', both);
    const out = grok.startGrokLogin({ grokBin: FAKE });
    const s = await settled(out.sessionId);
    assert.equal(s.state, 'connected');
    assert.ok(s.account.dir !== a && s.account.dir !== b, 'no guess between two');
    assert.equal(auth(a), both);
    assert.equal(auth(b), both);
    fs.rmSync(s.account.dir, { recursive: true, force: true });
  });
  grok.setGrokTimers({ forceKill: 200 });
  // Its own email, so only the hold (not two matches) can stop the merge.
  const HELD = JSON.stringify({ 'https://auth.x.ai::u1': { email: 'held@example.com', refresh_token: 'OLD' } });
  const held = account('.grok-held2', HELD);
  process.env.FAKE_MODE = 'hang';
  const pending = grok.startGrokLogin({ grokBin: FAKE, reauthDir: held });
  await waitFor(() => grok.grokLoginStatus(pending.sessionId).userCode);
  await withMode('approve', 'held@example.com', async () => {
    const out = grok.startGrokLogin({ grokBin: FAKE });
    const s = await settled(out.sessionId);
    assert.equal(s.state, 'connected');
    assert.notEqual(s.account.dir, held, 'an account mid-sign-in is not written into');
    assert.equal(auth(held), HELD);
    fs.rmSync(s.account.dir, { recursive: true, force: true });
  });
  grok.cancelGrokLogin(pending.sessionId);
});

/* Review pass 4: a typed name asks for a separate account; a merge whose rename fails keeps
   the finished sign-in as its own account instead of throwing it away. */
test('a NAMED new sign-in is never merged, even with an email already here', () => withMode('approve', 'named@example.com', async () => {
  const there = account('.grok-namedthere', JSON.stringify({ 'https://auth.x.ai::u1': { email: 'named@example.com', refresh_token: 'OLD' } }));
  const out = grok.startGrokLogin({ grokBin: FAKE, label: 'second' });
  const s = await settled(out.sessionId);
  assert.equal(s.state, 'connected', JSON.stringify(s));
  assert.equal(s.account.dir, nodePath.join(SANDBOX, '.grok-second'), 'the named account the person asked for');
  assert.equal(s.account.name, 'second');
  assert.match(auth(there), /"OLD"/, 'the other account is untouched');
  fs.rmSync(s.account.dir, { recursive: true, force: true });
}));

test('a merge whose rename fails keeps the new sign-in as its own account', () => withMode('approve', 'rofail@example.com', async () => {
  const BODY = JSON.stringify({ 'https://auth.x.ai::u1': { email: 'rofail@example.com', refresh_token: 'OLD' } });
  const there = account('.grok-rofail', BODY);
  const unlock = lockedFolder(there);
  try {
    const out = grok.startGrokLogin({ grokBin: FAKE });
    const s = await settled(out.sessionId);
    assert.equal(s.state, 'connected', 'the finished sign-in is kept: ' + JSON.stringify(s));
    assert.notEqual(s.account.dir, there);
    assert.match(auth(s.account.dir), /"NEW"/);
    assert.equal(auth(there), BODY);
    fs.rmSync(s.account.dir, { recursive: true, force: true });
  } finally {
    unlock();
  }
}));
