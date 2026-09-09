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

test('#2528 fast-follow: a NEVER-served world falls back on the FIRST failed reopen', () => {
  // Josh 0.6.50: switch into a world whose board never comes up, and he gave up at the
  // FIRST "Kosmos could not start" -- long before THRESHOLD boots. A world that has never
  // served (unconfirmed) must abandon on its first failed reopen, not the THRESHOLD-th.
  const home = homeDir('lockout');
  const base = worlds.baseRoot(freshEnv(home));
  const hw = worlds.createWorld(base, 'Home');
  worlds.setActiveWorld(base, hw.id);
  assert.equal(guard.isConfirmed(base, hw.id), false, 'a newly-switched-into world has never served');

  // Boot 1 (the switch-restart): the world is still tried (the fallback is conditional,
  // not premature -- a never-served world still gets one real attempt). It does not serve,
  // so it is never confirmed.
  worldenv.bootstrapWorldEnv(freshEnv(home));
  assert.equal(worldenv.bootedWorld(), hw.id, 'boot 1 still tries the switched-into world');
  assert.equal(guard.isConfirmed(base, hw.id), false, 'still unconfirmed -- it never reached listening');

  // Boot 2 (the user quits and reopens ONCE): unconfirmed + one failed boot -> abandon NOW,
  // so the user lands back on their default Kosmos instead of a second "could not start".
  worldenv.bootstrapWorldEnv(freshEnv(home));
  assert.equal(worldenv.bootedWorld(), worlds.DEFAULT_ID,
    'the FIRST failed reopen of a never-served world falls back to default (Josh recovers on reopen 1)');
  assert.equal(worlds.activeWorld(base).id, worlds.DEFAULT_ID,
    'and the active pointer is reset to default, so the switcher and the board agree');
  assert.ok(worlds.listWorlds(base).some((w) => w.id === hw.id),
    'the Home world entry is PRESERVED (not deleted) -- the user can retry it once its board is fixed');
  assert.equal(guard.isAbandoned(base, hw.id), false,
    'the counter is cleared on fall-back, so a deliberate retry of Home starts fresh');
});

test('#2528: a CONFIRMED world (served before) uses THRESHOLD, not the fast path', () => {
  // A world the user force-quit mid-boot ONCE must NOT be abandoned on the next boot the
  // way a never-served world is -- it served before (confirmed), so it is judged on THRESHOLD.
  const base = worlds.baseRoot(freshEnv(homeDir('established')));
  fs.mkdirSync(base, { recursive: true });
  guard.markConfirmed(base, 'home');   // it has served at least once
  assert.equal(guard.isConfirmed(base, 'home'), true);
  assert.equal(guard.recordAttempt(base, 'home'), 1);
  assert.equal(guard.shouldAbandon(base, 'home'), false,
    'one failed boot of a CONFIRMED world does NOT abandon (no fast path once served)');
  for (let i = 2; i <= guard.THRESHOLD; i++) guard.recordAttempt(base, 'home');
  assert.equal(guard.shouldAbandon(base, 'home'), true, 'only at THRESHOLD does a confirmed world abandon');
});

test('#2528 fast-follow: shouldAbandon fast-path needs a failed boot on a NEVER-served world; confirming disarms it', () => {
  const base = worlds.baseRoot(freshEnv(homeDir('shouldabandon')));
  fs.mkdirSync(base, { recursive: true });
  assert.equal(guard.shouldAbandon(base, 'home'), false, 'unconfirmed but ZERO failed boots -> not yet (it gets one real try)');
  guard.recordAttempt(base, 'home');
  assert.equal(guard.shouldAbandon(base, 'home'), true, 'unconfirmed + 1 failed boot -> abandon');
  guard.markConfirmed(base, 'home');
  assert.equal(guard.shouldAbandon(base, 'home'), false, 'once confirmed it drops to the THRESHOLD rule (count 1 is under THRESHOLD)');
  // fail-open on unsafe/missing
  assert.equal(guard.shouldAbandon(base, '../evil'), false);
  assert.equal(guard.shouldAbandon(null, 'home'), false);
  assert.equal(guard.isConfirmed(base, '../evil'), false);
});

test('#2528 fast-follow: once CONFIRMED, no sequence of switches re-arms the fast path (closes the iter1/iter2 false-abandon)', () => {
  // iter1/iter2 found a switch-time marker could re-arm the fast path on a healthy world
  // (a redundant no-op switch, or a pointer-vs-booted switch-back on an unmanaged board).
  // The confirmed marker keys on "has it served?", NOT on any switch, so this exercises the
  // property directly: after markConfirmed, switching away and back (the shape of both iter1
  // and iter2 cases) leaves shouldAbandon on the THRESHOLD path, never the count>=1 fast path.
  const base = worlds.baseRoot(freshEnv(homeDir('confirmedswitch')));
  const w = worlds.createWorld(base, 'Served');
  guard.markConfirmed(base, w.id);                         // it served once
  worlds.setActiveWorld(base, worlds.DEFAULT_ID);          // switch away
  worlds.setActiveWorld(base, w.id);                       // switch back (setActiveWorld does NO marker work)
  assert.equal(guard.recordAttempt(base, w.id), 1);         // one ordinary later failed boot
  assert.equal(guard.shouldAbandon(base, w.id), false,
    'a confirmed world is NOT abandoned on one failure after any switch -- it uses THRESHOLD, not the fast path');
  // Only a FULL THRESHOLD of failures abandons a confirmed world (proves it is on the
  // count path, not the count>=1 never-served fast path).
  for (let i = 2; i < guard.THRESHOLD; i++) {
    guard.recordAttempt(base, w.id);
    assert.equal(guard.shouldAbandon(base, w.id), false, `still under THRESHOLD at ${i} failures`);
  }
  guard.recordAttempt(base, w.id);
  assert.equal(guard.shouldAbandon(base, w.id), true, 'only at THRESHOLD, as a confirmed world should');
});

test('#2528: a world whose board LISTENS is confirmed, so a healthy world never trips the guard', () => {
  const home = homeDir('healthy');
  const base = worlds.baseRoot(freshEnv(home));
  const ok = worlds.createWorld(base, 'Good');
  worlds.setActiveWorld(base, ok.id);
  // Many healthy boots: each records at bootstrap, then the board listens (server.js
  // onListening) and clears the count AND marks the world confirmed. The count returns to
  // zero every time and the world is confirmed, so neither abandon path ever trips.
  for (let i = 0; i < guard.THRESHOLD + 2; i++) {
    worldenv.bootstrapWorldEnv(freshEnv(home));
    assert.equal(worldenv.bootedWorld(), ok.id, 'a healthy world keeps booting into itself');
    // what onListening does now: clear the count AND mark the world confirmed.
    guard.clear(worldenv.bootedBaseDir(), worldenv.bootedWorld());
    guard.markConfirmed(worldenv.bootedBaseDir(), worldenv.bootedWorld());
    assert.equal(guard.isAbandoned(base, ok.id), false, 'and never approaches the threshold');
    assert.equal(guard.shouldAbandon(base, ok.id), false, 'and the never-served fast path never trips a confirmed world');
  }
});

test('#2528: a deliberate switch to a world CLEARS its residual failed-boot COUNT (the isAbandoned/THRESHOLD primitive)', () => {
  const home = homeDir('freshretry');
  const base = worlds.baseRoot(freshEnv(home));
  const w = worlds.createWorld(base, 'Retry');
  // Two prior failures (under THRESHOLD), then the user switches away and back -- the
  // switch-back must reset the COUNT so the retry is not judged on stale failures.
  guard.recordAttempt(base, w.id);
  guard.recordAttempt(base, w.id);
  worlds.setActiveWorld(base, worlds.DEFAULT_ID);   // switch away
  worlds.setActiveWorld(base, w.id);                // deliberate switch BACK
  // This asserts the COUNTER primitive (isAbandoned = count>=THRESHOLD) specifically. NOTE it
  // is NOT the full abandon decision: `w` here has never served (unconfirmed), so the real
  // decision fn shouldAbandon would fast-abandon it after just ONE fresh failure via the
  // never-served path (asserted just below). isAbandoned alone still needs a full THRESHOLD.
  assert.equal(guard.isAbandoned(base, w.id), false, 'count-based isAbandoned: not abandoned (never hit THRESHOLD)');
  for (let i = 0; i < guard.THRESHOLD - 1; i++) guard.recordAttempt(base, w.id);
  assert.equal(guard.isAbandoned(base, w.id), false, 'THRESHOLD-1 fresh failures still under the count bar (the switch cleared the residual)');
  guard.recordAttempt(base, w.id);
  assert.equal(guard.isAbandoned(base, w.id), true, 'the THRESHOLD-th fresh failure trips the count bar');
});

test('#2528 fast-follow: a switch-back to an UNCONFIRMED world does NOT get THRESHOLD grace -- shouldAbandon fast-abandons after one failure', () => {
  // Makes the divergence from the count-only test above EXPLICIT: for a world that has never
  // served, the real decision (shouldAbandon, what bootstrapWorldEnv calls) does NOT wait for
  // THRESHOLD after a switch-back -- one fresh failed boot abandons it. (A CONFIRMED world is
  // the one that gets THRESHOLD grace; see the confirmed tests above.)
  const home = homeDir('unconfirmedback');
  const base = worlds.baseRoot(freshEnv(home));
  const w = worlds.createWorld(base, 'Retry');
  worlds.setActiveWorld(base, worlds.DEFAULT_ID);
  worlds.setActiveWorld(base, w.id);                // switch back; still never served
  assert.equal(guard.isConfirmed(base, w.id), false, 'never served -> unconfirmed');
  guard.recordAttempt(base, w.id);                   // one fresh failed boot
  assert.equal(guard.shouldAbandon(base, w.id), true,
    'an unconfirmed world is abandoned by shouldAbandon after ONE failure, THRESHOLD notwithstanding');
});

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
