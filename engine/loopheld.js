'use strict';

const os = require('node:os');

/**
 * #7693: says how long the board's thread was held, whatever held it.
 *
 * engine/slowspawn.js names blocking child processes, and only those: a stall in file reads or in the
 * snapshot's own work writes nothing. A timer that should fire every half second and fires late measures
 * the whole stall. The line also says how much of it the blocking commands account for, so the rest is
 * visibly something slowspawn cannot see.
 *
 * It logs numbers only. Lines are capped per minute so a stalled machine does not also fill the log.
 *
 * A timer cannot tell a held thread from a computer asleep: on a Mac this clock keeps counting through sleep (libuv
 * uses mach_continuous_time), so a short nap reads as a stall. A gap past ASLEEP_MS is more likely sleep and says it
 * cannot tell, rather than being dropped, since the longest real stall is the one this most needs to report.
 *
 * #7693: the line ends with the machine's one-minute load, so a read of the log can compare stalls at like load. Without it a
 * drop in held time cannot be told from a quieter machine (11-05: 452 s held in the 16:00 hour, 12 s at 17:00, no change to
 * the board). One moment, read when the stall ends, not the stall's average. Left out when there is none to report: Windows
 * answers 0 for a load it does not keep, and "load 0" would read as an idle machine.
 */

const TICK_MS = 500;
const HELD_MS = 2000;       // late by this much: the board answered nobody for that long
const ASLEEP_MS = 300000;   // a gap this long is more likely the computer sleeping than the board held
const MAX_PER_MINUTE = 10;
const monotonic = () => Math.round(performance.now());   // not the wall clock: a clock step is not a stall

// ", load 4.2", or nothing when there is no load to report. A failed read loses the figure, never the line.
function loadWords(read) {
  try {
    const n = read();
    return Number.isFinite(n) && n > 0 ? `, load ${n.toFixed(1)}` : '';
  } catch { return ''; }
}

// A logger that writes at most `max` lines a minute, so a stalled machine does not also fill the log.
function perMinute(log, max = MAX_PER_MINUTE, now = monotonic) {
  let windowAt = null;
  let inWindow = 0;
  return (line) => {
    const at = now();
    if (windowAt === null || at - windowAt >= 60000) { windowAt = at; inWindow = 0; }
    if (inWindow++ < max) log(line);
  };
}

function watch(opts = {}) {
  const now = opts.now || monotonic;
  const log = perMinute(opts.log || ((line) => console.warn(line)), MAX_PER_MINUTE, now);
  const blockedMs = opts.blockedMs || (() => 0);
  const load = opts.load || (() => os.loadavg()[0]);
  const every = opts.setInterval || setInterval;
  let last = null;
  let blockedAt = 0;
  const tick = () => {
    try {
      const at = now();
      const blocked = blockedMs();
      // The first tick only sets the clock: everything before it is the board loading its modules.
      if (last !== null) {
        const late = at - last - TICK_MS;
        // Capped at the stall: the window also holds the half second before it, when a quick command may have run.
        // Floored at 0: slowspawn times with the wall clock, which can step back during a command.
        if (late >= ASLEEP_MS) log(`[loop-held] gap ${late} ms, a sleeping computer or a very long stall`);
        else if (late >= HELD_MS) log(`[loop-held] ${late} ms, ${Math.max(0, Math.min(blocked - blockedAt, late))} ms of it in blocking commands${loadWords(load)}`);
      }
      last = at;
      blockedAt = blocked;
    } catch { /* watching never breaks the board */ }
  };
  const timer = every(tick, TICK_MS);
  if (timer && typeof timer.unref === 'function') timer.unref();   // never what keeps a stopping board alive
  return { tick, timer };
}

module.exports = { watch, perMinute, TICK_MS, HELD_MS, ASLEEP_MS, MAX_PER_MINUTE };
