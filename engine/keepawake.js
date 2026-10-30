'use strict';
/* kosmos#7416 slice 3: keep this computer awake while agents are working, when the person has switched it on.
 *
 * THE MECHANISM, decided on the card (comment 6464053404): the board holds macOS's own `caffeinate -i` while the
 * switch is on and any agent's card reads `working`, and stops it when none does. `-i` prevents IDLE sleep only: a
 * laptop still sleeps when its lid closes (unless it is plugged in with a screen attached), and the display still
 * turns off. It needs no admin password and changes no system setting.
 *   Rejected: `pmset` (needs admin rights, and the changed setting outlives Kosmos).
 *
 * `-w <board pid>`: caffeinate exits by itself when the board's process does, however the board ends (a crash, a
 * kill, an update). So a board that dies can never leave the computer held awake behind it.
 *
 * WHAT COUNTS AS WORKING is the board's own card state (`state === 'working'` on the roster), the same reading the
 * person sees, never a second derivation. A self-reported `working` decays after status.REPORT_WORKING_DECAY_MS, so
 * a stuck turn holds the computer for at most about that long past its last report.
 *   Rejected: also holding while messages are kept for an agent that is out of usage (engine/limitqueue.js). That
 *   can be hours with nothing running, and the switch says "while agents are working". If people want work to resume
 *   at a reset overnight, that is the place to add it.
 *
 * macOS only for now. The Windows half (SetThreadExecutionState) is Homer's; on any other platform `supported` is
 * false and nothing is ever started.
 */
const childProcess = require('node:child_process');

const CAFFEINATE = '/usr/bin/caffeinate';
/* Short enough that work starting just before the idle timer runs out is caught: macOS's shortest sleep setting is a
   minute. One roster read per pass, and only while the switch is on. */
const TICK_MS = 30 * 1000;
/* Passes in a row with an unread roster before a hold is let go: ten passes is five minutes, as long as a stale
   self-reported `working` counts (status.REPORT_WORKING_DECAY_MS). */
const UNREAD_PASSES_MAX = 10;

/** Whether to hold: the switch is on and at least one card reads working. */
function wants({ on, agents }) {
  if (on !== true) return false;
  return Array.isArray(agents) && agents.some((a) => a && a.state === 'working');
}

/**
 * One holder per board. `set(true)` starts caffeinate if it is not running; `set(false)` stops it. A caffeinate that
 * exits on its own (killed from outside, say) is noticed, and the next `set(true)` starts another.
 * Never throws. `state()` is what the Settings row reads.
 */
function createHolder(opts) {
  const o = opts || {};
  const platform = o.platform || process.platform;
  const spawn = o.spawn || childProcess.spawn;
  const pid = o.pid || process.pid;
  const now = o.now || Date.now;
  let child = null;
  let since = null;
  let because = '';

  function start() {
    let c;
    try {
      c = spawn(CAFFEINATE, ['-i', '-w', String(pid)], { stdio: 'ignore' });
    } catch (err) {
      because = 'caffeinate did not start (' + String((err && err.code) || (err && err.message) || err) + ')';
      return;
    }
    child = c;
    since = now();
    because = '';
    c.on('error', (err) => {
      if (child !== c) return;
      child = null; since = null;
      because = 'caffeinate did not start (' + String((err && err.code) || (err && err.message) || err) + ')';
    });
    c.on('exit', () => { if (child === c) { child = null; since = null; because = 'caffeinate stopped by itself'; } });
    if (typeof c.unref === 'function') c.unref();
  }

  function stop() {
    const c = child;
    child = null;
    since = null;
    if (c) { try { c.kill('SIGTERM'); } catch { /* already gone */ } }
  }

  return {
    supported: platform === 'darwin',
    unread: 0,   // passes in a row with an unread roster (pass)
    set(hold) {
      if (platform !== 'darwin') return;
      if (hold && !child) start();
      else if (!hold) { because = ''; if (child) stop(); }
    },
    stop,
    state() { return { holding: !!child, since, because }; },
  };
}

/**
 * One pass of the board's sweep. The switch off (or unreadable) lets go at once, without reading the roster. A
 * roster that could not be read (null, or a throw) leaves the hold as it is for up to UNREAD_PASSES_MAX passes in a
 * row: letting go at once could put an idle computer to sleep in the middle of a turn, and taking hold would claim
 * work nobody saw.
 */
function pass({ readSetting, readRoster, holder }) {
  if (!holder.supported) return;
  let on = false;
  try { const r = readSetting(); on = !!r && r.ok === true && r.on === true; } catch { on = false; }
  if (!on) { holder.set(false); return; }
  let agents = null;
  try { agents = readRoster(); } catch { agents = null; }
  if (!Array.isArray(agents)) {
    holder.unread += 1;
    if (holder.unread >= UNREAD_PASSES_MAX) holder.set(false);
    return;
  }
  holder.unread = 0;
  holder.set(wants({ on, agents }));
}

/* Under AGENT_WORKFORCE_DRY_RUN the board runs no caffeinate: this stands in for spawn with a child that is only an
   object, so the hold is still decided and reported and nothing on the machine changes. */
function dryRunSpawn() {
  const c = new (require('node:events').EventEmitter)();
  c.kill = () => { setImmediate(() => c.emit('exit', null, 'SIGTERM')); return true; };
  return c;
}

module.exports = { wants, pass, createHolder, dryRunSpawn, CAFFEINATE, TICK_MS, UNREAD_PASSES_MAX };
