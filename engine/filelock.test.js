'use strict';

/* Direct coverage for the shared file-lock primitive (kosmos#1823). The recovery
 * paths (stale-steal, owner-less break, owner-token release, umask non-wedge) are
 * exercised through both callers in chat.test.js and sendertoken.test.js; this file
 * covers withFileLock's OWN parameterized surface — the opts messages and the
 * waitMs/env override — which the wrappers pin to fixed values. */

require('../test-support/tmpscope'); // kosmos#5334: this process's temp folders, removed when it exits
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { withFileLock, LOCK_STALE_MS, LOCK_WAIT_MS } = require('./filelock');

function tmpFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filelock-test-'));
  return path.join(dir, name || 'target');
}

test('the ordinary case runs fn, returns its value, and releases the lock', () => {
  const file = tmpFile();
  const r = withFileLock(file, () => 'the-value');
  assert.deepEqual(r, { ok: true, value: 'the-value' });
  assert.ok(!fs.existsSync(file + '.lock'), 'the lock was left behind after an ordinary release');
});

test('an fn throw propagates (the lock never swallows it) and still releases', () => {
  const file = tmpFile();
  assert.throws(() => withFileLock(file, () => { throw new Error('boom'); }), /boom/);
  assert.ok(!fs.existsSync(file + '.lock'), 'a throwing fn left the lock behind');
});

test('opts.busy names the message when a LIVE holder times out (string form)', () => {
  const file = tmpFile();
  fs.mkdirSync(file + '.lock');                 // a fresh (non-stale) held lock
  try {
    const r = withFileLock(file, () => 'unreached', { busy: 'CUSTOM BUSY', waitMs: 0 });
    assert.deepEqual(r, { ok: false, because: 'CUSTOM BUSY' });
  } finally { fs.rmSync(file + '.lock', { recursive: true, force: true }); }
});

test('opts.busy accepts a FUNCTION, evaluated at timeout', () => {
  const file = tmpFile();
  fs.mkdirSync(file + '.lock');
  try {
    let calls = 0;
    const r = withFileLock(file, () => 'unreached', { busy: () => { calls += 1; return 'FN BUSY'; }, waitMs: 0 });
    assert.deepEqual(r, { ok: false, because: 'FN BUSY' });
    assert.equal(calls, 1, 'the busy function was evaluated exactly once, at the timeout');
  } finally { fs.rmSync(file + '.lock', { recursive: true, force: true }); }
});

test('opts.waitMs overrides the default wait', () => {
  const file = tmpFile();
  fs.mkdirSync(file + '.lock');
  try {
    const t0 = Date.now();
    const r = withFileLock(file, () => 'unreached', { busy: 'b', waitMs: 0 });
    assert.equal(r.ok, false);
    assert.ok(Date.now() - t0 < LOCK_WAIT_MS, 'waitMs:0 returned well before the 2s default');
  } finally { fs.rmSync(file + '.lock', { recursive: true, force: true }); }
});

test('AGENT_WORKFORCE_LOCK_MS env overrides the wait when opts.waitMs is absent', () => {
  const file = tmpFile();
  fs.mkdirSync(file + '.lock');
  const saved = process.env.AGENT_WORKFORCE_LOCK_MS;
  process.env.AGENT_WORKFORCE_LOCK_MS = '0';
  try {
    const t0 = Date.now();
    const r = withFileLock(file, () => 'unreached', { busy: 'b' });
    assert.equal(r.ok, false);
    assert.ok(Date.now() - t0 < LOCK_WAIT_MS, 'the env override returned before the 2s default');
  } finally {
    if (saved === undefined) delete process.env.AGENT_WORKFORCE_LOCK_MS; else process.env.AGENT_WORKFORCE_LOCK_MS = saved;
    fs.rmSync(file + '.lock', { recursive: true, force: true });
  }
});

test('a STALE lock (older than LOCK_STALE_MS) is stolen and the section runs', () => {
  const file = tmpFile();
  fs.mkdirSync(file + '.lock');
  // Age it past the staleness bound.
  const old = (Date.now() - LOCK_STALE_MS - 1000) / 1000;
  fs.utimesSync(file + '.lock', old, old);
  const r = withFileLock(file, () => 'ran');
  assert.deepEqual(r, { ok: true, value: 'ran' });
  assert.ok(!fs.existsSync(file + '.lock'), 'the stolen-then-run lock was released');
});

test('release removes OUR lock, never a successor that stole ours mid-section', () => {
  const file = tmpFile();
  const lock = file + '.lock';
  withFileLock(file, () => {
    // Simulate a successor stealing the lock while we hold it: rename ours away
    // and plant a fresh lock with a DIFFERENT owner token.
    fs.renameSync(lock, lock + '.taken');
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, 'owner'), 'the-successor');
  });
  assert.ok(fs.existsSync(lock), 'the original holder deleted the successor’s lock on its way out');
  assert.equal(fs.readFileSync(path.join(lock, 'owner'), 'utf8'), 'the-successor',
    'the successor’s lock was replaced rather than left alone');
});

test('#1991: the steal refuses to move a FRESH lock created between the stat and the rename', () => {
  // The TOCTOU the card traces: process Y measures a lock stale, is descheduled,
  // process X completes a full steal and re-acquires a FRESH LIVE lock at the path,
  // then Y resumes at renameSync carrying its cached "stale" verdict. rename moves
  // whatever is at the path NOW (X's live lock), SUCCEEDS, and Y enters the section
  // beside X. Reproduced deterministically by substituting the fresh lock inside a
  // renameSync mock -- the realistic sub-case the chat.test.js "breaker" test does
  // NOT reach, because it mocks rename to throw ENOENT (an EMPTY path), never to
  // succeed on a live one.
  const file = tmpFile();
  const lock = file + '.lock';
  fs.mkdirSync(lock);                                   // L0
  const old = (Date.now() - LOCK_STALE_MS - 5000) / 1000;
  fs.utimesSync(lock, old, old);                        // measured stale

  const realRename = fs.renameSync;
  const keep = lock + '.orig-l0';
  let substituted = false;
  let fnRan = false;
  fs.renameSync = (from, to) => {
    // On the stealer's first rename(lock -> aside), stand a FRESH LIVE lock (L1) at
    // the path, as a racing process would. L0 is kept (not deleted) so its identity
    // is unambiguously distinct and its mtime stays the stale value we measured.
    if (!substituted && from === lock) {
      substituted = true;
      realRename(lock, keep);                           // L0 -> keep (still alive)
      fs.mkdirSync(lock);                               // L1: fresh mtime (~now), NOT stale
      fs.writeFileSync(path.join(lock, 'owner'), 'the-live-holder');
    }
    return realRename(from, to);                        // move whatever is at `from` now
  };
  try {
    const r = withFileLock(file, () => { fnRan = true; return 'should-not-run'; },
      { busy: 'still held', waitMs: 150 });
    // The stealer moved L1 aside, saw its mtime differ from the stale mtime it
    // measured, restored L1, and re-waited rather than entering the section.
    assert.equal(fnRan, false, 'the stealer entered the section beside a live holder (double-entry)');
    assert.deepEqual(r, { ok: false, because: 'still held' }, 'the stealer acquired instead of failing safe');
    assert.ok(fs.existsSync(lock), 'the fresh live lock was destroyed rather than restored');
    assert.equal(fs.readFileSync(path.join(lock, 'owner'), 'utf8'), 'the-live-holder',
      'the fresh live holder’s lock was replaced rather than left intact');
  } finally {
    fs.renameSync = realRename;
    const dir = path.dirname(lock);
    for (const f of fs.readdirSync(dir)) {
      try { fs.rmSync(path.join(dir, f), { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
});

test('#1991 CONTROL: the normal steal (no race) still matches identity and runs the section', () => {
  // The mtime check must not turn every legitimate steal into a restore-and-rewait.
  // A genuinely stale lock, stolen with no substitution, has an aside whose mtime
  // equals the measured one, so the steal proceeds. Without this control, a fix that
  // ALWAYS restored (e.g. an mtime comparison that never matches) would pass the
  // race test above while silently breaking every real stale-lock recovery.
  const file = tmpFile();
  const lock = file + '.lock';
  fs.mkdirSync(lock);
  const old = (Date.now() - LOCK_STALE_MS - 5000) / 1000;
  fs.utimesSync(lock, old, old);
  const r = withFileLock(file, () => 'ran-after-clean-steal');
  assert.deepEqual(r, { ok: true, value: 'ran-after-clean-steal' }, 'a clean stale-lock steal no longer runs the section');
  assert.ok(!fs.existsSync(lock), 'the stolen-then-run lock was not released');
});

test('a non-EEXIST acquire failure is REPORTED, not thrown (opts.cannotAccess)', () => {
  // A lock path whose parent does not exist -> mkdirSync throws ENOENT (not EEXIST).
  const file = path.join(os.tmpdir(), 'filelock-test-nonexistent-' + process.pid, 'deep', 'target');
  const r = withFileLock(file, () => 'unreached', { cannotAccess: 'NO ACCESS' });
  assert.deepEqual(r, { ok: false, because: 'NO ACCESS' });
});

test('#5997: a lock that vanished at the stat is NOT treated as stale; a waiter never moves a live holder\'s lock', () => {
  // The interleave behind a lost trust write (#5997): a waiter's mkdir meets EEXIST, the holder releases, the waiter's
  // stat finds nothing (ENOENT), and writer B re-acquires a fresh lock. A waiter that reads the missing lock as
  // infinitely stale renames B's LIVE lock aside; the identity check notices and tries to put it back, but a third
  // writer C can mkdir the lock in that gap, the restore fails, and B and C are both inside the section: every writer
  // reports success and one update is lost. Reproduced deterministically: statSync throws ENOENT once while B's live
  // lock stands at the path, and C's mkdir is placed in the gap before any restore.
  const file = tmpFile();
  const lock = file + '.lock';
  fs.mkdirSync(lock);                                              // B's live lock, fresh mtime
  fs.writeFileSync(path.join(lock, 'owner'), 'writer-B');
  const realStat = fs.statSync;
  const realRename = fs.renameSync;
  let statLied = 0;   // review 1: twice in a row (heavy contention), which a retry-once rule alone would read as debris
  const moved = [];
  fs.statSync = (p, ...rest) => {
    if (statLied < 2 && p === lock) { statLied += 1; const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
    return realStat(p, ...rest);
  };
  fs.renameSync = (from, to) => {
    if (from === lock) moved.push(to);
    // C takes the lock in the gap before any restore of B's lock.
    if (to === lock && !fs.existsSync(lock)) { fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'owner'), 'writer-C'); }
    return realRename(from, to);
  };
  let fnRan = false;
  try {
    // Long deadline: lstat sees B's real lock here, so the waiter pauses (~165 ms under load) between the two lies.
    const r = withFileLock(file, () => { fnRan = true; }, { busy: 'still held', waitMs: 1500 });
    assert.equal(statLied, 2, 'CONTROL: the stat that finds no lock was reached, twice');
    assert.deepEqual(moved, [], 'the waiter moved a live holder\'s lock aside (it read a missing lock as stale)');
    assert.equal(fnRan, false);
    assert.deepEqual(r, { ok: false, because: 'still held' });
    assert.equal(fs.readFileSync(path.join(lock, 'owner'), 'utf8'), 'writer-B', 'B\'s live lock was replaced');
  } finally {
    fs.statSync = realStat;
    fs.renameSync = realRename;
    const dir = path.dirname(lock);
    for (const f of fs.readdirSync(dir)) {
      try { fs.rmSync(path.join(dir, f), { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
});

test('#5997 reviews 1 and 3: a stat that fails another way (Windows delete-pending: EPERM), once or every time, never leads to moving the lock', () => {
  const file = tmpFile();
  const lock = file + '.lock';
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'owner'), 'writer-B');
  const realStat = fs.statSync;
  const realRename = fs.renameSync;
  let fails = 0;
  let failTimes = 1;
  const moved = [];
  fs.statSync = (p, ...rest) => {
    if (p === lock && fails < failTimes) { fails += 1; const e = new Error('EPERM'); e.code = 'EPERM'; throw e; }
    return realStat(p, ...rest);
  };
  fs.renameSync = (from, to) => { if (from === lock) moved.push(to); return realRename(from, to); };
  try {
    const r = withFileLock(file, () => 'ran', { busy: 'still held', waitMs: 150 });
    assert.equal(fails, 1, 'CONTROL: the failing stat was reached');
    assert.deepEqual(moved, [], 'one EPERM sent the waiter to move a live lock');
    assert.deepEqual(r, { ok: false, because: 'still held' });
    // Review 3: every time too. A steal needs a measured mtime; with none it could only move a lock aside and put it
    // back (the #5997 window), never collect it. So it waits and answers busy, and moves nothing.
    fails = 0; failTimes = Infinity;
    // A long deadline: a 20 ms pause measured ~165 ms on a loaded Mac (load 11.5), and this arm needs two of them.
    const r2 = withFileLock(file, () => 'ran', { busy: 'still held', waitMs: 400 });
    assert.ok(fails >= 2, 'CONTROL: the stat failed repeatedly (the arm under test was reached)');
    assert.deepEqual(moved, [], 'a stat that keeps failing sent the waiter to move the lock');
    assert.deepEqual(r2, { ok: false, because: 'still held' });
  } finally {
    fs.statSync = realStat;
    fs.renameSync = realRename;
    const dir = path.dirname(lock);
    for (const f of fs.readdirSync(dir)) {
      try { fs.rmSync(path.join(dir, f), { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
});

test('#5997 review 2: a dangling symlink at the lock path (mkdir EEXIST, stat ENOENT) is waited on with pauses, not spun hot', () => {
  const file = tmpFile();
  const lock = file + '.lock';
  fs.symlinkSync(path.join(path.dirname(lock), 'nowhere'), lock);   // EEXIST for mkdir, ENOENT for stat
  const realMkdir = fs.mkdirSync;
  let tries = 0;
  fs.mkdirSync = (p, ...rest) => { if (p === lock) tries += 1; return realMkdir(p, ...rest); };
  try {
    const r = withFileLock(file, () => 'ran', { busy: 'still held', waitMs: 300 });
    assert.deepEqual(r, { ok: false, because: 'still held' });
    // A hot spin makes thousands of tries in 300 ms; with pauses (20 ms, often far longer under load) it is a handful.
    assert.ok(tries < 100, `${tries} mkdir tries in 300 ms: the wait spun hot`);
    assert.ok(tries >= 2, 'CONTROL: the wait retried at all');
  } finally {
    fs.mkdirSync = realMkdir;
    try { fs.unlinkSync(lock); } catch { /* best-effort */ }
  }
});
