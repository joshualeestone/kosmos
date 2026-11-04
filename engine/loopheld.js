'use strict';

/**
 * #7693: says how long the board's thread was held, whatever held it.
 *
 * engine/slowspawn.js names blocking child processes, and only those: a stall in file reads or in the
 * snapshot's own work writes nothing. A timer that should fire every half second and fires late measures
 * the whole stall. The line also says how much of it the blocking commands account for, so the rest is
 * visibly something slowspawn cannot see.
 *
 * It logs numbers only. Lines are capped per minute so a stalled machine does not also fill the log.
 */

const TICK_MS = 500;
const HELD_MS = 2000;       // late by this much: the board answered nobody for that long
const ASLEEP_MS = 300000;   // a gap this long is the computer sleeping, not the board held
const MAX_PER_MINUTE = 10;

function watch(opts = {}) {
  const log = opts.log || ((line) => console.warn(line));
  const now = opts.now || Date.now;
  const blockedMs = opts.blockedMs || (() => 0);
  const every = opts.setInterval || setInterval;
  let last = null;
  let blockedAt = 0;
  let windowAt = 0;
  let inWindow = 0;
  const tick = () => {
    try {
      const at = now();
      const blocked = blockedMs();
      // The first tick only sets the clock: everything before it is the board loading its modules.
      if (last !== null) {
        const late = at - last - TICK_MS;
        if (late >= HELD_MS && late < ASLEEP_MS) {
          if (at - windowAt >= 60000) { windowAt = at; inWindow = 0; }
          if (inWindow++ < MAX_PER_MINUTE) log(`[loop-held] ${late} ms, ${blocked - blockedAt} ms of it in blocking commands`);
        }
      }
      last = at;
      blockedAt = blocked;
    } catch { /* watching never breaks the board */ }
  };
  const timer = every(tick, TICK_MS);
  if (timer && typeof timer.unref === 'function') timer.unref();   // never what keeps a stopping board alive
  return { tick, timer };
}

module.exports = { watch, TICK_MS, HELD_MS, ASLEEP_MS, MAX_PER_MINUTE };
