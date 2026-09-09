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
 * RECOVERABLE: a non-default world that fails to reach a serving state on
 * `THRESHOLD` consecutive boots is abandoned, and `bootstrapWorldEnv` falls back to
 * the DEFAULT world, which always works (it is the base install, no override). So a
 * user is never PERMANENTLY trapped -- at worst they land back on their default
 * Kosmos and can delete or retry the bad one.
 *
 * THE MECHANISM. A per-world counter in `<base>/.world-boot-attempts.json`.
 *  - `bootstrapWorldEnv` records an attempt for the world it is about to boot,
 *    BEFORE applying its env, so a boot that then crashes still counted.
 *  - the board clears the counter the moment it is `listening` (a real serving
 *    state), so a healthy world's count returns to zero every boot and never
 *    approaches the threshold. Only a world that repeatedly fails to serve
 *    accumulates.
 *
 * FAIL-OPEN, like the rest of the world layer: any I/O or parse error is swallowed
 * and treated as "0 attempts / do nothing". A guard that cannot read its own state
 * must never be the reason the board will not boot.
 */
const fs = require('node:fs');
const path = require('node:path');

const FILE = '.world-boot-attempts.json';
// A world that fails to serve THRESHOLD times in a row is abandoned on the next
// boot. Kept >1 so a single transient failure (a busy machine slow to listen, a
// user force-quitting mid-boot) does not abandon a healthy world; kept small so a
// genuinely dead world recovers in a few restarts rather than never.
const THRESHOLD = 3;
// Same safe-id shape worlds.js enforces, so a hand-edited or traversing id can
// never make this write outside base.
const CLEAN_ID = /^[a-z0-9_-]+$/;

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
  if (!base || typeof id !== 'string') return;
  const map = readMap(base);
  if (!(id in map)) return;
  delete map[id];
  if (Object.keys(map).length === 0) {
    try { fs.unlinkSync(attemptsPath(base)); } catch { /* fail-open */ }
  } else {
    writeMap(base, map);
  }
}

/* True when `id` has already failed THRESHOLD times in a row -- read WITHOUT
   incrementing, so callers can decide before recording. Default world ids never
   count (falling the default world back to itself is meaningless). */
function isAbandoned(base, id) {
  if (!base || typeof id !== 'string' || !CLEAN_ID.test(id)) return false;
  const n = readMap(base)[id];
  return Number.isInteger(n) && n >= THRESHOLD;
}

module.exports = { recordAttempt, clear, isAbandoned, THRESHOLD, FILE };
