'use strict';
/**
 * #6000 (the #5994 shape, on Grok): removing or forgetting a Grok account cancels the account's OWN unfinished
 * "Sign in again" instead of refusing until the watchdog ends it. Any other hold still refuses, a refused or failed
 * call cancels nothing, and the cancelled sign-in's late exit cannot release a hold a new sign-in takes on the path.
 * Driven against a FAKE grok that hangs (exec sleep, so a kill reaches it) or ignores SIGTERM.
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

const FAKE = nodePath.join(SANDBOX, 'fake-grok.sh');
const CODE = 'printf "\\nTo sign in, open this URL in your browser:\\n\\n  https://accounts.x.ai/oauth2/device?user_code=QWER-TYUI\\n\\nConfirm this code in your browser:\\n\\n  QWER-TYUI\\n\\n"';
fs.writeFileSync(FAKE, [
  '#!/bin/bash',
  // ignoreterm: the trap is set BEFORE the code is printed, so "a code is showing" means a cancel cannot kill it.
  'if [ "$FAKE_MODE" = "ignoreterm" ]; then trap \'\' TERM; ' + CODE + '; while :; do sleep 0.2; done; fi',
  // writeonterm: on SIGTERM wait half a second, then write a valid sign-in for $FAKE_EMAIL and exit 0: the one way a
  // cancelled sign-in again could still try to promote, late enough for a test to put a folder back at the path first.
  'if [ "$FAKE_MODE" = "writeonterm" ]; then trap \'sleep 0.5; printf "{\\"https://auth.x.ai::u2\\":{\\"email\\":\\"%s\\",\\"refresh_token\\":\\"NEW\\"}}" "$FAKE_EMAIL" > "$GROK_HOME/auth.json"; exit 0\' TERM; ' + CODE + '; while :; do sleep 0.2; done; fi',
  CODE,
  'exec sleep 30',
].join('\n') + '\n', { mode: 0o755 });

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
  const r = grok.startGrokLogin({ grokBin: FAKE, label: 'taken9' });
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

test('#6000: a cancelled sign-in again that writes a valid sign-in as it dies does not promote into a folder now at that path', async () => {
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

test('#6000: the cancelled sign-in\'s late exit does not release a hold a NEW sign-in takes on the same path', async () => {
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

// chmod does not stop root, so these two skip there (as #5994's do).
const AS_ROOT = { skip: typeof process.getuid === 'function' && process.getuid() === 0 };

test('#6000: a forget whose MOVE itself fails (the home cannot be written) cancels nothing', AS_ROOT, async () => {
  const { dir, sessionId } = await startHeldReauth('.grok-busy10', 'busy10@example.com');
  fs.chmodSync(SANDBOX, 0o555);   // the rename out of the home is refused; nothing in the account is touched
  try {
    const f = grok.forgetAccount(dir, []);
    assert.equal(f.ok, false);
    assert.match(f.because, /could not move/);
    const st = state(sessionId);
    assert.ok(st !== 'cancelled' && st !== 'error', 'a failed move cancelled the sign-in: ' + st);
  } finally {
    fs.chmodSync(SANDBOX, 0o755);
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
  fs.chmodSync(stuck, 0o555);   // its file cannot be deleted, so rmSync throws after the rest is gone
  let rm;
  try { rm = grok.removeAccount(dir, []); } finally { fs.chmodSync(stuck, 0o755); }
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
  fs.chmodSync(dir, 0o555);   // nothing inside can be deleted, so auth.json stays and the account is whole
  let rm;
  try { rm = grok.removeAccount(dir, []); } finally { fs.chmodSync(dir, 0o755); }
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

test('#6000: a sign-in again cancelled a moment ago (its child still exiting) does not refuse the remove', async () => {
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
