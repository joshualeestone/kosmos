'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * #6000 (the #5994 shape, on Grok): removing or forgetting a Grok account cancels the account's OWN unfinished
 * "Sign in again" instead of refusing until the watchdog ends it. Any other hold still refuses, a refused call (or a
 * failed one that leaves the account whole) cancels nothing, and the cancelled sign-in's late exit cannot release a hold a new sign-in takes on the path.
 * Driven against a FAKE grok (a node script) that hangs (the script itself waits, so a kill reaches it) or ignores SIGTERM.
 *
 *   node --test engine/grokaccounts.reauthcancel-6000.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-grok-reauthcancel-6000-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
delete process.env.AGENT_WORKFORCE_GROK_HOME;
const grok = require('./grokaccounts');
const { eventually } = require('../test-support/eventually');
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const FAKE = nodePath.join(SANDBOX, 'fake-grok.js');
const CODE = "say('\\nTo sign in, open this URL in your browser:\\n\\n  https://accounts.x.ai/oauth2/device?user_code=QWER-TYUI\\n\\nConfirm this code in your browser:\\n\\n  QWER-TYUI\\n\\n');";
fs.writeFileSync(FAKE, [
  '#!/usr/bin/env node',
  "'use strict';",
  "const fs = require('fs');",
  // Synchronous writes, so what is printed or written is never lost when the script exits right after it.
  "const say = (s) => fs.writeSync(1, s);",
  "const mode = process.env.FAKE_MODE;",
  // ignoreterm: the handler is set BEFORE the code is printed, so "a code is showing" means a cancel cannot kill it.
  "if (mode === 'ignoreterm') process.on('SIGTERM', () => {});",
  // writeonterm: on SIGTERM wait half a second, then write a valid sign-in for $FAKE_EMAIL and exit 0: the one way a
  // cancelled sign-in again could still try to promote, late enough for a test to put a folder back at the path first.
  // A second SIGTERM while it waits changes nothing, as a bash trap still set would not either.
  "let dying = false;",
  "if (mode === 'writeonterm') process.on('SIGTERM', () => {",
  "  if (dying) return;",
  "  dying = true;",
  "  setTimeout(() => {",
  "    try { fs.writeFileSync((process.env.GROK_HOME || '') + '/auth.json', '{\"https://auth.x.ai::u2\":{\"email\":\"' + (process.env.FAKE_EMAIL || '') + '\",\"refresh_token\":\"NEW\"}}'); }",
  "    catch (e) { fs.writeSync(2, String(e.message) + '\\n'); }",
  "    process.exit(0);",
  "  }, 500);",
  "});",
  CODE,
  // Both trap modes wait forever (until a SIGKILL, or the write above); any other mode waits 30 s and exits 0.
  "if (mode === 'ignoreterm' || mode === 'writeonterm') setInterval(() => {}, 200);",
  "else setTimeout(() => process.exit(0), 30000);",
].join('\n') + '\n', { mode: 0o755 });
fs.chmodSync(FAKE, 0o755);   // runnable on the Mac by its mode; Windows runs it by its .js name (PATHEXT)

/* kosmos#9269: FAKE is a node script named .js, so it runs on every platform: startGrokLogin starts a .js grok as this
   node with the script as its first argument (engine/tunnelcommand.js), and Windows counts a .js file as runnable by
   its extension (PATHEXT) where the Mac needs its 0755 mode. So the sign-in again and the remove and forget it races
   run on Windows too. The arms whose stand-in catches SIGTERM still skip there: Windows has no signals (a kill there
   ends the process outright), so no stand-in could outlive a cancel. The arms that lock with chmod run there with
   the failing fs call stubbed instead (see failing() below). A start that is refused before anything is spawned needs only a runner Windows counts as runnable, so it uses
   PRESENT. */
const { skipOnWin32 } = require('../test-support/skip-on-win32');
const SIGNALS = skipOnWin32('its stand-in grok traps SIGTERM to outlive a cancel, and Windows has no signals');
const PRESENT = require('../test-support/runnerstub').writeRunnerStub(nodePath.join(SANDBOX, 'bin'), 'grok');

const OLD = (email) => JSON.stringify({ 'https://auth.x.ai::u1': { email, refresh_token: 'OLD' } });
function account(name, email) {
  const d = nodePath.join(SANDBOX, name);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(nodePath.join(d, 'auth.json'), OLD(email), { mode: 0o600 });
  return d;
}
/* Staging slots a sign-in again runs in (nextWorkDir hands out .grok-workN). */
const workSlots = () => fs.readdirSync(SANDBOX).filter((n) => n.startsWith('.grok-work'));
const state = (id) => grok.grokLoginStatus(id).state;
function waitFor(pred, msg, ms = 15000) {
  return eventually(() => Boolean(pred()), (v) => v === true, { timeoutMs: ms, stepMs: 25, describe: () => msg });
}
// No test leaks a fake mode into the next one, and no sign-in a test started outlives it, even when an assertion failed
// before the test's own cancel (as #5994's suite).
const STARTED = [];
test.afterEach(() => {
  delete process.env.FAKE_MODE;
  while (STARTED.length) grok.cancelGrokLogin(STARTED.pop());
});

async function startHeldReauth(name, email) {
  const dir = account(name, email);
  const r = grok.startGrokLogin({ grokBin: FAKE, reauthDir: dir });
  assert.equal(r.ok, true, r.because);
  STARTED.push(r.sessionId);
  await waitFor(() => grok.grokLoginStatus(r.sessionId).userCode, 'the sign-in again never showed its code');
  return { dir, sessionId: r.sessionId };
}

test('#6000 premise: a new sign-in cannot stage into an existing account\'s folder', () => {
  const dir = account('.grok-taken9', 'taken9@example.com');
  const r = grok.startGrokLogin({ grokBin: PRESENT, label: 'taken9' });
  assert.equal(r.ok, false);
  assert.match(r.because, /already a Grok account by that name/);
  assert.equal(grok.removeAccount(dir, []).removed, true, 'the refused start left a hold on the account');
});

test('#6000: removeAccount cancels the account\'s own unfinished sign-in again and deletes it', async () => {
  const { dir, sessionId } = await startHeldReauth('.grok-busy', 'busy@example.com');
  const rm = grok.removeAccount(dir, []);
  assert.equal(rm.ok, true, rm.because);
  assert.equal(rm.removed, true);
  assert.equal(state(sessionId), 'cancelled', 'the sign-in again was not cancelled');
  await waitFor(() => workSlots().length === 0, 'the cancelled sign-in\'s staging slot was never freed');
  assert.equal(fs.existsSync(dir), false, 'the late exit brought the account back');
});

test('#6000: a cancelled sign-in again that writes a valid sign-in as it dies does not promote into a folder now at that path', { skip: SIGNALS }, async () => {
  process.env.FAKE_MODE = 'writeonterm';
  process.env.FAKE_EMAIL = 'back10@example.com';   // the SAME account, so a promote would be accepted
  try {
    const { dir, sessionId } = await startHeldReauth('.grok-back10', 'back10@example.com');
    assert.equal(grok.removeAccount(dir, []).removed, true);
    // A folder is back at that path before the child finishes dying (a new account under the same name, say).
    // Without it a late promote fails on its own (the parent is gone), so the test could not fail.
    fs.mkdirSync(dir);
    await waitFor(() => workSlots().length === 0, 'the child never exited');
    assert.equal(fs.existsSync(nodePath.join(dir, 'auth.json')), false, 'the dying sign-in again promoted into the folder now at that path');
    assert.equal(state(sessionId), 'cancelled');
  } finally {
    delete process.env.FAKE_EMAIL;
  }
});

test('#6000: forgetAccount cancels the account\'s own unfinished sign-in again and moves it aside', async () => {
  const { dir, sessionId } = await startHeldReauth('.grok-busy2', 'busy2@example.com');
  const f = grok.forgetAccount(dir, []);
  assert.equal(f.ok, true, f.because);
  assert.equal(f.forgotten, true);
  assert.equal(fs.existsSync(dir), false, 'the account was not moved');
  assert.equal(fs.existsSync(nodePath.join(f.movedTo, 'auth.json')), true, 'the moved-aside account lost its sign-in');
  assert.equal(state(sessionId), 'cancelled');
  await waitFor(() => workSlots().length === 0, 'the staging slot was never freed');
});

test('#6000: a REFUSED remove or forget (agents on the account: the #2570 pre-flight) cancels nothing', async () => {
  const { dir, sessionId } = await startHeldReauth('.grok-busy3', 'busy3@example.com');
  const rm = grok.removeAccount(dir, ['ava']);
  assert.equal(rm.ok, false);
  assert.deepEqual(rm.usedBy, ['ava']);
  const f = grok.forgetAccount(dir, ['ava']);
  assert.equal(f.ok, false);
  const st = state(sessionId);
  assert.ok(st !== 'cancelled' && st !== 'error', 'a refused call cancelled the sign-in: ' + st);
  assert.equal(fs.existsSync(nodePath.join(dir, 'auth.json')), true);
  grok.cancelGrokLogin(sessionId);
  await waitFor(() => workSlots().length === 0, 'the cancelled sign-in never exited');
});

test('#6000: the cancelled sign-in\'s late exit does not release a hold a NEW sign-in takes on the same path', { skip: SIGNALS }, async () => {
  process.env.FAKE_MODE = 'ignoreterm';   // keep the old child alive until its SIGKILL, so its exit comes AFTER the new start
  grok.setGrokTimers({ forceKill: 1500 });
  try {
    const { dir, sessionId } = await startHeldReauth('.grok-busy4', 'busy4@example.com');
    assert.equal(grok.removeAccount(dir, []).removed, true);
    delete process.env.FAKE_MODE;
    // A new sign-in with the removed account's name reserves that same path while the old child is still dying.
    const fresh = grok.startGrokLogin({ grokBin: FAKE, label: 'busy4' });
    assert.equal(fresh.ok, true, fresh.because);
    STARTED.push(fresh.sessionId);
    assert.ok(workSlots().length > 0, 'fixture: the old child already exited, so the window under test never opened');
    await waitFor(() => state(sessionId) === 'cancelled' && workSlots().length === 0, 'the old sign-in never finished exiting', 8000);
    // The old exit has run. The new sign-in's hold must still stand, so a second one under that name is refused.
    const second = grok.startGrokLogin({ grokBin: FAKE, label: 'busy4' });
    if (second.ok) STARTED.push(second.sessionId);
    assert.equal(second.ok, false, 'the old exit released the new sign-in\'s hold');
    assert.match(second.because, /already in progress/);
    grok.cancelGrokLogin(fresh.sessionId);
    await waitFor(() => !fs.existsSync(dir), 'the cancelled new sign-in never exited');
  } finally {
    grok.setGrokTimers({ forceKill: 3000 });   // the module's default
  }
});

test('#6000: a forget that FAILS at the move (no free name to move it to) cancels nothing', async () => {
  const { dir, sessionId } = await startHeldReauth('.grok-busy6', 'busy6@example.com');
  const taken = [nodePath.join(SANDBOX, '.removed-grok-busy6')];
  for (let n = 2; n < 500; n += 1) taken.push(nodePath.join(SANDBOX, `.removed-grok-busy6-${n}`));
  for (const t of taken) fs.mkdirSync(t, { recursive: true });
  try {
    const f = grok.forgetAccount(dir, []);
    assert.equal(f.ok, false);
    assert.match(f.because, /free name/);
    const st = state(sessionId);
    assert.ok(st !== 'cancelled' && st !== 'error', 'a failed forget cancelled the sign-in: ' + st);
    assert.equal(fs.existsSync(nodePath.join(dir, 'auth.json')), true);
  } finally {
    for (const t of taken) fs.rmSync(t, { recursive: true, force: true });
    grok.cancelGrokLogin(sessionId);
  }
  await waitFor(() => workSlots().length === 0, 'the cancelled sign-in never exited');
});

/* kosmos#9269: these three lock with chmod on the Mac and Linux. Windows does not enforce chmod, so there the one fs
   call the chmod makes fail is made to fail instead, with the code the chmod gives it: fs.renameSync out of the home
   (EACCES) for the forget, fs.rmSync of the account folder (ENOTEMPTY, what a recursive rmSync reports when an entry
   inside cannot go) for the two deletes. grokaccounts reaches fs through the module object at call time, so the
   stub is what it calls. Each arm asserts the same outcome either way. KOSMOS_TEST_CHMOD_STUB=1 takes the Windows
   path on any platform, so it can be run (and broken) on the Mac. */
const CHMOD_VIA_STUB = process.platform === 'win32' || process.env.KOSMOS_TEST_CHMOD_STUB === '1';
/* fs[name] throws `code` while `refuses(...args)` holds (after `before(...args)`, if given), and is the real call
   otherwise. Returns the restore. */
function failing(name, code, refuses, before) {
  const orig = fs[name];
  fs[name] = function stubbed(...args) {
    if (refuses(...args)) {
      if (before) before(orig, ...args);
      throw Object.assign(new Error(code + ': ' + name + ' refused (a stand-in for chmod, kosmos#9269)'), { code });
    }
    return orig.apply(this, args);
  };
  return () => { fs[name] = orig; };
}
const same = (a, b) => nodePath.resolve(String(a)) === nodePath.resolve(String(b));
// chmod does not stop root, so on the chmod path these three skip there (as #5994's do); the stub path does not care.
const AS_ROOT = { skip: !CHMOD_VIA_STUB && typeof process.getuid === 'function' && process.getuid() === 0 };

test('#6000: a forget whose MOVE itself fails (the home cannot be written) cancels nothing', AS_ROOT, async () => {
  const { dir, sessionId } = await startHeldReauth('.grok-busy10', 'busy10@example.com');
  // The rename out of the home is refused; nothing in the account is touched.
  const unlock = CHMOD_VIA_STUB
    ? failing('renameSync', 'EACCES', (from, to) => same(nodePath.dirname(nodePath.resolve(String(from))), SANDBOX) || same(nodePath.dirname(nodePath.resolve(String(to))), SANDBOX))
    : (fs.chmodSync(SANDBOX, 0o555), () => fs.chmodSync(SANDBOX, 0o755));
  try {
    const f = grok.forgetAccount(dir, []);
    assert.equal(f.ok, false);
    assert.match(f.because, /could not move/);
    const st = state(sessionId);
    assert.ok(st !== 'cancelled' && st !== 'error', 'a failed move cancelled the sign-in: ' + st);
  } finally {
    unlock();
    grok.cancelGrokLogin(sessionId);
  }
  assert.equal(fs.existsSync(nodePath.join(dir, 'auth.json')), true);
  await waitFor(() => workSlots().length === 0, 'the cancelled sign-in never exited');
});

test('#6000: a delete that fails PART WAY, after auth.json is gone, cancels the sign-in so it cannot finish into the remains', AS_ROOT, async (t) => {
  const { dir, sessionId } = await startHeldReauth('.grok-half12', 'half12@example.com');
  const stuck = nodePath.join(dir, 'sessions');
  fs.mkdirSync(stuck, { recursive: true });
  fs.writeFileSync(nodePath.join(stuck, 'kept.jsonl'), '{}');
  // Its file cannot be deleted, so rmSync throws after the rest is gone. The stub does what the chmod leaves: every
  // entry but sessions/ removed (auth.json among them), then the throw.
  const unlock = CHMOD_VIA_STUB
    ? failing('rmSync', 'ENOTEMPTY', (p) => same(p, dir), (orig) => {
      for (const n of fs.readdirSync(dir)) if (n !== 'sessions') orig(nodePath.join(dir, n), { recursive: true, force: true });
    })
    : (fs.chmodSync(stuck, 0o555), () => fs.chmodSync(stuck, 0o755));
  let rm;
  try { rm = grok.removeAccount(dir, []); } finally { unlock(); }
  assert.equal(rm.ok, false);
  assert.match(rm.because, /could not delete/);
  // rmSync walks entries in directory-listing order and stops at the first error, so on a filesystem that lists
  // sessions/ first auth.json survives and this is the whole-account case (pinned by the next test).
  if (fs.existsSync(nodePath.join(dir, 'auth.json'))) {
    grok.cancelGrokLogin(sessionId);
    await waitFor(() => workSlots().length === 0, 'the cancelled sign-in never exited');
    t.skip('this filesystem listed sessions/ before auth.json');
    return;
  }
  assert.equal(state(sessionId), 'cancelled', 'the sign-in was left to finish into a half-deleted folder');
  await waitFor(() => workSlots().length === 0, 'the staging slot was never freed');
});

test('#6000: a delete that fails while the account is still WHOLE cancels nothing', AS_ROOT, async () => {
  const { dir, sessionId } = await startHeldReauth('.grok-whole13', 'whole13@example.com');
  // Nothing inside can be deleted, so auth.json stays and the account is whole.
  const unlock = CHMOD_VIA_STUB
    ? failing('rmSync', 'ENOTEMPTY', (p) => same(p, dir))
    : (fs.chmodSync(dir, 0o555), () => fs.chmodSync(dir, 0o755));
  let rm;
  try { rm = grok.removeAccount(dir, []); } finally { unlock(); }
  assert.equal(rm.ok, false);
  assert.equal(fs.existsSync(nodePath.join(dir, 'auth.json')), true, 'fixture: auth.json was deleted');
  const st = state(sessionId);
  assert.ok(st !== 'cancelled' && st !== 'error', 'a failed delete of a whole account cancelled the sign-in: ' + st);
  grok.cancelGrokLogin(sessionId);
  await waitFor(() => workSlots().length === 0, 'the cancelled sign-in never exited');
});

test('#6000: an account already gone from the disk still has its own unfinished sign-in again cancelled', async () => {
  const { dir, sessionId } = await startHeldReauth('.grok-gone7', 'gone7@example.com');
  fs.rmSync(dir, { recursive: true, force: true });   // removed outside Kosmos
  const rm = grok.removeAccount(dir, []);
  assert.equal(rm.ok, true);
  assert.equal(rm.removed, false);
  assert.equal(state(sessionId), 'cancelled', 'the abandoned sign-in was left holding a gone account');
  await waitFor(() => workSlots().length === 0, 'the staging slot was never freed');
});

test('#6000: forgetting an account already gone from the disk also cancels its own unfinished sign-in again', async () => {
  const { dir, sessionId } = await startHeldReauth('.grok-gone9', 'gone9@example.com');
  fs.rmSync(dir, { recursive: true, force: true });   // removed outside Kosmos
  const f = grok.forgetAccount(dir, []);
  assert.equal(f.ok, true);
  assert.equal(f.forgotten, false);
  assert.equal(state(sessionId), 'cancelled', 'forget left the abandoned sign-in holding a gone account');
  assert.equal(grok.isSignInPending(dir), false);
  await waitFor(() => workSlots().length === 0, 'the staging slot was never freed');
});

test('#6000: a sign-in again cancelled a moment ago (its child still exiting) does not refuse the remove', { skip: SIGNALS }, async () => {
  grok.setGrokTimers({ forceKill: 1500 });   // the TERM-ignoring child lives until this SIGKILL
  try {
    process.env.FAKE_MODE = 'ignoreterm';
    const { dir, sessionId } = await startHeldReauth('.grok-late8', 'late8@example.com');
    assert.equal(grok.cancelGrokLogin(sessionId).cancelled, true);   // the person pressed cancel...
    await new Promise((res) => setTimeout(res, 300));
    assert.ok(workSlots().length > 0, 'fixture: the child died on SIGTERM, so the window under test never opened');
    const rm = grok.removeAccount(dir, []);   // ...and then Remove, while the child is still exiting
    assert.equal(rm.ok, true, rm.because);
    assert.equal(rm.removed, true);
    await waitFor(() => workSlots().length === 0, 'the SIGKILLed child never freed its slot', 8000);
    assert.equal(grok.isSignInPending(dir), false, 'the late exit left a hold on the removed account');
    assert.equal(fs.existsSync(dir), false, 'the late exit brought the removed account back');
  } finally {
    grok.setGrokTimers({ forceKill: 3000 });   // the module's default
  }
});

test('#6000: any OTHER hold still refuses (a new sign-in staging into that name)', async () => {
  const r = grok.startGrokLogin({ grokBin: FAKE, label: 'staging5' });
  assert.equal(r.ok, true, r.because);
  STARTED.push(r.sessionId);
  await waitFor(() => grok.grokLoginStatus(r.sessionId).userCode, 'the new sign-in never showed its code');
  const dir = nodePath.join(SANDBOX, '.grok-staging5');
  const rm = grok.removeAccount(dir, []);
  assert.equal(rm.ok, false);
  assert.match(rm.because, /still in progress/);
  const f = grok.forgetAccount(dir, []);
  assert.equal(f.ok, false);
  assert.match(f.because, /still in progress/);
  assert.notEqual(state(r.sessionId), 'cancelled', 'a sign-in that is not a sign-in again was cancelled');
  grok.cancelGrokLogin(r.sessionId);
  await waitFor(() => !fs.existsSync(dir), 'the cancelled sign-in never exited');
});
