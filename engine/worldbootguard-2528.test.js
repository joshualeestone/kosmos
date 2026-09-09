'use strict';
/**
 * #2528: the world-switch lockout guard. A non-default world whose board fails to
 * SERVE on THRESHOLD consecutive boots must be abandoned so the user is never
 * permanently locked out -- the board falls back to the default world, which always
 * works. Josh hit the lockout on 0.6.49 (created "Home", switched, "nothing answered
 * at 127.0.0.1:16686") and could not recover across reload + app-restart because the
 * pointer was already committed to the dead world.
 *
 *   node --test engine/worldbootguard-2528.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-worldbootguard-2528-'));
const worlds = require('./worlds');
const worldenv = require('./worldenv');
const guard = require('./worldbootguard');

// A fixed AGENT_WORKFORCE_HOME keeps baseRoot stable across simulated boots, but a
// FRESH copy each boot (bootstrapWorldEnv mutates env with AGENT_WORKFORCE_DATA).
function homeDir(sub) { const h = nodePath.join(SANDBOX, sub); fs.mkdirSync(h, { recursive: true }); return h; }
function freshEnv(home) { return { ...process.env, AGENT_WORKFORCE_HOME: home }; }

test('recordAttempt increments a per-world counter; clear resets it; isAbandoned trips only at THRESHOLD', () => {
  const base = worlds.baseRoot(freshEnv(homeDir('unit')));
  fs.mkdirSync(base, { recursive: true });
  assert.equal(guard.isAbandoned(base, 'home'), false, 'starts not abandoned');
  for (let i = 1; i < guard.THRESHOLD; i++) {
    assert.equal(guard.recordAttempt(base, 'home'), i, 'the counter increments by one per attempt');
    assert.equal(guard.isAbandoned(base, 'home'), false, 'below THRESHOLD it is NOT yet abandoned');
  }
  assert.equal(guard.recordAttempt(base, 'home'), guard.THRESHOLD);
  assert.equal(guard.isAbandoned(base, 'home'), true, 'at THRESHOLD it is abandoned');
  guard.clear(base, 'home');
  assert.equal(guard.isAbandoned(base, 'home'), false, 'clear resets it, so a retry starts fresh');
});

test('fail-open: an unsafe/empty id or missing base records nothing and abandons nothing', () => {
  const base = worlds.baseRoot(freshEnv(homeDir('failopen')));
  assert.equal(guard.recordAttempt(base, '../evil'), 0, 'a traversing id records nothing');
  assert.equal(guard.recordAttempt(base, ''), 0);
  assert.equal(guard.recordAttempt(null, 'home'), 0, 'no base records nothing');
  assert.equal(guard.isAbandoned(base, '../evil'), false);
  assert.equal(guard.isAbandoned(null, 'home'), false);
});

test('#2528: repeated boots of a world that never serves fall back to the default world', () => {
  const home = homeDir('lockout');
  const base = worlds.baseRoot(freshEnv(home));
  const hw = worlds.createWorld(base, 'Home');
  worlds.setActiveWorld(base, hw.id);

  // THRESHOLD boots that never reach `listening` (no clear) -- each STILL tries the
  // named world (the fallback is conditional, not premature).
  for (let i = 0; i < guard.THRESHOLD; i++) {
    worldenv.bootstrapWorldEnv(freshEnv(home));
    assert.equal(worldenv.bootedWorld(), hw.id,
      `boot ${i + 1} of THRESHOLD still tries the named world, not the default`);
    assert.equal(worlds.activeWorld(base).id, hw.id, 'and the pointer is unchanged while under threshold');
  }

  // The next boot must abandon the dead world so the user is not locked out.
  worldenv.bootstrapWorldEnv(freshEnv(home));
  assert.equal(worldenv.bootedWorld(), worlds.DEFAULT_ID,
    'after THRESHOLD failed boots the board FALLS BACK to the default world');
  assert.equal(worlds.activeWorld(base).id, worlds.DEFAULT_ID,
    'and the active pointer is reset to default, so the switcher and the board agree');
  assert.ok(worlds.listWorlds(base).some((w) => w.id === hw.id),
    'the Home world entry is PRESERVED (not deleted) -- the user can switch back or delete it');
  assert.equal(guard.isAbandoned(base, hw.id), false,
    'the counter is cleared on fall-back, so a deliberate retry of Home starts fresh');
});

test('#2528: a world whose board LISTENS is cleared, so a healthy world never trips the guard', () => {
  const home = homeDir('healthy');
  const base = worlds.baseRoot(freshEnv(home));
  const ok = worlds.createWorld(base, 'Good');
  worlds.setActiveWorld(base, ok.id);
  // Many healthy boots: each records at bootstrap, then the board listens (server.js
  // onListening) and clears. The count returns to zero every time.
  for (let i = 0; i < guard.THRESHOLD + 2; i++) {
    worldenv.bootstrapWorldEnv(freshEnv(home));
    assert.equal(worldenv.bootedWorld(), ok.id, 'a healthy world keeps booting into itself');
    guard.clear(worldenv.bootedBaseDir(), worldenv.bootedWorld()); // what onListening does
    assert.equal(guard.isAbandoned(base, ok.id), false, 'and never approaches the threshold');
  }
});

test('#2528: a deliberate switch to a world CLEARS its residual failed-boot count (fresh tries)', () => {
  const home = homeDir('freshretry');
  const base = worlds.baseRoot(freshEnv(home));
  const w = worlds.createWorld(base, 'Retry');
  // Two prior failures (under THRESHOLD), then the user switches away and back -- the
  // switch-back must reset the count so the retry is not judged on stale failures.
  guard.recordAttempt(base, w.id);
  guard.recordAttempt(base, w.id);
  worlds.setActiveWorld(base, worlds.DEFAULT_ID);   // switch away
  worlds.setActiveWorld(base, w.id);                // deliberate switch BACK
  assert.equal(guard.isAbandoned(base, w.id), false, 'not abandoned (never hit THRESHOLD)');
  // and the count is truly zero: it now takes a FULL THRESHOLD of fresh failures to abandon
  for (let i = 0; i < guard.THRESHOLD - 1; i++) guard.recordAttempt(base, w.id);
  assert.equal(guard.isAbandoned(base, w.id), false, 'THRESHOLD-1 fresh failures still under the bar (proves the switch cleared the residual)');
  guard.recordAttempt(base, w.id);
  assert.equal(guard.isAbandoned(base, w.id), true, 'the THRESHOLD-th fresh failure trips it');
});

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
