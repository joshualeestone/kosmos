'use strict';
/**
 * #2528: the world-switch lockout guard.
 *
 * THE LOCKOUT IT CLOSES. `worlds.setActiveWorld` commits the new `activeWorldId`
 * the instant POST /api/worlds/active is called, BEFORE the board has restarted
 * and confirmed the new world's board actually serves. So if that board never
 * comes up (Josh, 0.6.49: created "Home", switched, "nothing answered at
 * 127.0.0.1:16686"), the pointer is already poisoned: every relaunch boots the
 * same dead world and hard-fails, with no way back in. #2454 made the installed
 * board able to self-restart, but a board that restarts and STILL does not serve
 * leaves the same poison, and Josh hit it on a build that already carried #2454.
 *
 * THE GUARANTEE. This module cannot make a broken world boot. It makes the lockout
 * RECOVERABLE: a non-default world that is not coming up is abandoned, and
 * `bootstrapWorldEnv` falls back to the DEFAULT world, which always works (it is the
 * base install, no override). So a user is never PERMANENTLY trapped -- at worst they
 * land back on their default Kosmos and can retry the bad one.
 *
 * HOW FAST it recovers depends on whether the world has EVER served (#2528 fast-follow,
 * after Josh hit the lockout again on 0.6.50):
 *  - a world that has NEVER served (a freshly switched-into or newly-created world whose
 *    board never comes up) is abandoned on its FIRST failed reopen -- the user who gives
 *    up at the first "Kosmos could not start" is still rescued on the next launch.
 *  - a CONFIRMED world (one that has served at least once) is abandoned only after
 *    `THRESHOLD` consecutive failed boots, so a one-off force-quit-mid-boot of a
 *    working world does not throw it away.
 *
 * THE MECHANISM. Two per-world files under `<base>`:
 *  - `.world-boot-attempts.json`, a counter: `bootstrapWorldEnv` records an attempt for
 *    the world it is about to boot BEFORE applying its env (so a boot that then crashes
 *    still counted); server.js clears it the moment the board is `listening`.
 *  - `.world-confirmed.json`, a set-once marker: server.js marks a world confirmed the
 *    first time it reaches `listening`, and it is never cleared. `shouldAbandon` reads
 *    both -- abandon when the count hits THRESHOLD (a confirmed world gone bad) OR when
 *    the world has failed a boot and is not yet confirmed (never served). A healthy
 *    world's count returns to zero every boot and it is confirmed, so it trips neither.
 *
 * FAIL-OPEN, like the rest of the world layer: any I/O or parse error is swallowed
 * and treated as "0 attempts / do nothing". A guard that cannot read its own state
 * must never be the reason the board will not boot.
 */
const fs = require('node:fs');
const path = require('node:path');

const FILE = '.world-boot-attempts.json';
// A set-once marker recording that a world has EVER reached a serving state
// (`listening`). Written by server.js onListening; never cleared. See CONFIRMED below.
const CONFIRMED_FILE = '.world-confirmed.json';
// A CONFIRMED world (one that has served at least once) that later fails to serve
// THRESHOLD times in a row is abandoned. Kept >1 so transient failures -- a busy machine
// slow to listen, or a user force-quitting an already-working world mid-boot -- do not
// abandon a healthy world; kept small so a world that genuinely goes bad recovers in a
// few restarts. #2528 fast-follow deliberately LEAVES this at 3: Josh's lockout was a
// world that NEVER served, which the never-served fast path below abandons on the first
// failed boot regardless of THRESHOLD, so there is no need to reduce a CONFIRMED world's
// force-quit tolerance to fix it (two blind reviews flagged a 3->2 reduction as a mild
// false-abandon of a healthy world; keeping 3 avoids that entirely).
const THRESHOLD = 3;
// 🛑 #2528 FAST-FOLLOW: the THRESHOLD alone did NOT save Josh. A world that has NEVER
// served (a freshly switched-into or newly-created world whose board never comes up) is
// the actual lockout, and a user gives up after the FIRST "Kosmos could not start"
// (Josh did) -- long before THRESHOLD boots. So a world that is NOT YET CONFIRMED is
// abandoned on its FIRST failed boot, not the THRESHOLD-th. Keying on "has this world
// ever served?" (a per-world fact) rather than "was this a switch?" (which needs the
// pointer-vs-booted context worlds.js does not have) is deliberate: it cannot
// false-abandon a healthy CONFIRMED world just because the pointer moved (the
// unmanaged-board switch-back case), and it needs no switch-time bookkeeping.
// Same safe-id shape worlds.js enforces, so a hand-edited or traversing id can
// never make this write outside base.
const CLEAN_ID = /^[a-z0-9_-]+$/;

// The read-modify-write below is deliberately LOCK-FREE (unlike worlds.js's
// withRegistryLock registry RMW): the atomic temp+rename prevents a partial file,
// and a stored count can never exceed the number of recordAttempt calls, so two
// boards racing the same base (double-start / two-Kosmos) can only LOSE an
// increment or a clear -- which DELAYS a fallback, never causes a false abandon.
// A lock here would add cross-process complexity to a guard whose worst race is
// benign, so it is intentionally omitted.
//
// The CONFIRMED file is also lock-free. It is SET-ONCE (markConfirmed only ever adds;
// nothing removes), and every markConfirmed writes the same value, so a lost write is
// simply redone on the next `listening` -- there is no clear that a write could race
// against. The only effect of a momentarily-lost confirm is that a world that just
// served still reads unconfirmed until the next listen; combined with a failed boot in
// that tiny window it could fast-abandon once (recoverable by re-switching), never a
// lockout. It needs two boards racing the same base (a double-start), which the board's
// single-instance model already avoids; a lock is not worth it for that residual.
function attemptsPath(base) { return path.join(base, FILE); }

function readMap(base) {
  try {
    const obj = JSON.parse(fs.readFileSync(attemptsPath(base), 'utf8'));
    return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
  } catch { return {}; }
}

function writeMap(base, map) {
  try {
    fs.mkdirSync(base, { recursive: true });
    const tmp = path.join(base, `${FILE}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(map, null, 2) + '\n');
    fs.renameSync(tmp, attemptsPath(base));
  } catch { /* fail-open: a guard that cannot persist must not block the board */ }
}

/* Record one boot attempt for `id` and return the new consecutive-failure count.
   Fail-open: on any error returns 0 (as if this were the first attempt), which can
   only DELAY a fallback, never trigger one wrongly. */
function recordAttempt(base, id) {
  if (!base || typeof id !== 'string' || !CLEAN_ID.test(id)) return 0;
  const map = readMap(base);
  const n = (Number.isInteger(map[id]) && map[id] > 0 ? map[id] : 0) + 1;
  map[id] = n;
  writeMap(base, map);
  return n;
}

/* Clear `id`'s counter -- called when the board reaches `listening`. A no-op if the
   id is absent or unsafe. Removes the whole file once empty so it never lingers. */
function clear(base, id) {
  if (!base || typeof id !== 'string' || !CLEAN_ID.test(id)) return;
  const map = readMap(base);
  if (!(id in map)) return;
  delete map[id];
  if (Object.keys(map).length === 0) {
    try { fs.unlinkSync(attemptsPath(base)); } catch { /* fail-open */ }
  } else {
    writeMap(base, map);
  }
}

/* Take back ONE recordAttempt for `id`, and only one. #570: a Windows board started
   by hand records an attempt at bootstrap and then hands the world to its logon
   task without ever trying to serve it (engine/win32handoff.js). Left on disk, that
   attempt is a failure the world never had -- and for a never-served world one is
   enough for the task's board to abandon it. Not `clear`: the attempts earlier
   boots really made must still count. Returns true when there was one to take. */
function retractAttempt(base, id) {
  if (!base || typeof id !== 'string' || !CLEAN_ID.test(id)) return false;
  const map = readMap(base);
  const had = Number.isInteger(map[id]) && map[id] > 0 ? map[id] : 0;
  if (!had) return false;
  if (had > 1) { map[id] = had - 1; writeMap(base, map); } else { clear(base, id); }
  return true;
}

/* True when `id` has already failed THRESHOLD times in a row -- read WITHOUT
   incrementing, so callers can decide before recording. Default world ids never
   count (falling the default world back to itself is meaningless). */
function isAbandoned(base, id) {
  if (!base || typeof id !== 'string' || !CLEAN_ID.test(id)) return false;
  const n = readMap(base)[id];
  return Number.isInteger(n) && n >= THRESHOLD;
}

/* The confirmed set (worlds that have EVER reached `listening`). Same fail-open +
   atomic-write discipline as the counter, kept in a SEPARATE file so the counter shape
   and its tests are untouched. SET-ONCE: markConfirmed only adds; nothing removes. */
function confirmedPath(base) { return path.join(base, CONFIRMED_FILE); }
function readConfirmed(base) {
  try {
    const obj = JSON.parse(fs.readFileSync(confirmedPath(base), 'utf8'));
    return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
  } catch { return {}; }
}

/* Record that `id` has served at least once -- called when the board reaches
   `listening`. Idempotent; a world stays confirmed for the life of the install. */
function markConfirmed(base, id) {
  if (!base || typeof id !== 'string' || !CLEAN_ID.test(id)) return;
  const map = readConfirmed(base);
  if (map[id] === true) return;
  map[id] = true;
  try {
    fs.mkdirSync(base, { recursive: true });
    const tmp = path.join(base, `${CONFIRMED_FILE}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(map, null, 2) + '\n');
    fs.renameSync(tmp, confirmedPath(base));
  } catch { /* fail-open */ }
}

// Fail-open direction note: an unsafe id, missing base, or unreadable/corrupt confirmed
// file all read `false` (unconfirmed). That biases toward the fast abandon path, i.e.
// toward RECOVERY (fall back to the working default), which is the safe direction for a
// lockout guard: the worst case is a confirmed world with an in-flight count>=1 getting
// abandoned once to default (self-heals -- the next `listening` rewrites the file), never
// a user trapped. Erring toward "recover" beats erring toward "stay on a dead world".
function isConfirmed(base, id) {
  if (!base || typeof id !== 'string' || !CLEAN_ID.test(id)) return false;
  return readConfirmed(base)[id] === true;
}

/* The abandon POLICY, in one place so bootstrapWorldEnv stays declarative and the
   rule is unit-testable. Abandon a non-default world when EITHER:
   - it has failed THRESHOLD consecutive boots (a CONFIRMED world gone bad), OR
   - it has NEVER served (not confirmed) AND has already failed at least one boot --
     the never-came-up lockout (a freshly switched-into or newly-created dead world),
     recovered on the FIRST failed reopen rather than the THRESHOLD-th.
   Read WITHOUT incrementing, so the caller decides before recording this boot. */
function shouldAbandon(base, id) {
  if (!base || typeof id !== 'string' || !CLEAN_ID.test(id)) return false;
  if (isAbandoned(base, id)) return true;    // the confirmed-world THRESHOLD path
  const n = readMap(base)[id];
  const failed = Number.isInteger(n) ? n : 0;
  return failed >= 1 && !isConfirmed(base, id); // the never-served fast path
}

module.exports = {
  recordAttempt, retractAttempt, clear, isAbandoned, shouldAbandon,
  markConfirmed, isConfirmed,
  THRESHOLD, FILE, CONFIRMED_FILE,
};
