'use strict';
/*
 * kosmos#8593: the board's runner-upgrade sweep. The bundled Codex follows the pin: a managed Codex older than
 * engine/runners.js's pin (resolveBin's `stale`) is replaced in the background, so a pin bump reaches computers that
 * already have Codex, not only new installs. server.js runs one tick two minutes after start, then every 30 minutes.
 *
 * RULES, each tested in engine/runnerupgrade-8593.test.js:
 *   - nothing happens unless live execution is allowed and the operator brake (AGENT_WORKFORCE_RUNNER_UPGRADE_OFF=1)
 *     is off; nothing happens unless the runner is stale and no install is running (joining one is not a try);
 *   - at most TRIES attempts per pinned version per board run (review 2): a failed upgrade puts the old version back,
 *     still stale, so without a cap a download that keeps failing would repeat every 30 minutes;
 *   - Windows (kosmos#8593, Windows half): an upgrade swaps only while no process runs from the managed folder
 *     (runners.install says why). The tick asks first and waits for its next look instead of downloading a tree it
 *     cannot swap in, and an answer that cannot be read is a wait too. A WAIT IS NOT A TRY: an agent that keeps
 *     running must not use up the tries, and that includes an install that downloaded and then met a running agent at
 *     its own last check (the job carries `waited`, and its try is handed back when it settles).
 *
 * Everything it reads or does is injected, so it is tested without a board, a download or a process table.
 */

const path = require('node:path');

const TRIES = 3;

/**
 * d: {
 *   runners     engine/runners.js (resolveBin, installing, status, manifestFor, install, managedRoot,
 *               managedProcessRunning)
 *   platform    process.platform
 *   allowed()   live execution is allowed      braked()  the operator brake is on
 *   write(line) the board log                  warn(line) the board's warnings
 * }
 * Returns tick(): Promise<string>, what the tick did ('off', 'idle', 'capped', 'waiting', 'started'), for tests.
 */
function makeTick(d) {
  const tries = new Map();   // pin -> tries this board run
  const say = (s) => { try { d.write(s); } catch { /* the log is best effort */ } };
  const warn = (err) => { try { d.warn(`[runner-upgrade] ${String((err && err.message) || err)}`); } catch { /* best effort */ } };
  return async function tick() {
    let ok = false;
    try { ok = d.allowed() === true && d.braked() !== true; } catch { ok = false; }
    if (!ok) return 'off';
    try {
      const run = d.runners;
      const r = run.resolveBin('openai');
      if (!r || r.stale !== true || run.installing('openai')) return 'idle';
      // Review 4: an upgrade already downloading is not installing(), so it is checked here: joining it is not a try.
      const live = (run.status().openai || {}).job;
      if (live && live.phase !== 'installed' && live.phase !== 'failed') return 'idle';
      const pin = run.manifestFor('openai').version;
      if ((tries.get(pin) || 0) >= TRIES) return 'capped';
      const from = r.installedVersion || '?';
      /* install() asks again before it downloads and before it swaps; this ask is the one that decides whether a try
         is spent at all, and it costs one CIM read (measured ~0.45 s on the Windows box, 2026-11-17) every 30 minutes. */
      if (d.platform === 'win32') {
        let busy = null;
        try { busy = await run.managedProcessRunning(path.join(run.managedRoot(), 'openai')); } catch { busy = null; }
        if (busy !== false) {
          say(`runner-upgrade: openai ${from} -> ${pin}: waiting (${busy === true ? 'an agent is running on it' : 'could not check'})\n`);
          return 'waiting';
        }
        /* That ask can take seconds; an install a person started meanwhile is joined by install(), and joining is not a
           try, so the state is read again before one is counted. */
        const now = run.resolveBin('openai');
        const liveNow = (run.status().openai || {}).job;
        if (!now || now.stale !== true || run.installing('openai')
          || (liveNow && liveNow.phase !== 'installed' && liveNow.phase !== 'failed')) return 'idle';
      }
      tries.set(pin, (tries.get(pin) || 0) + 1);
      // On Windows this tick just found no agent running, so install() skips its own first look (not the pre-swap one).
      const job = run.install('openai', d.platform === 'win32' ? { agentsCheckedIdle: true } : undefined);
      say(`runner-upgrade: openai ${from} -> ${pin}: ${job && job.phase}\n`);
      /* kosmos#8659: the try is handed back only through `settled`, and only for a job that ended as a wait. A job
         without `settled` (install()'s refusals, and its already-installed answer) keeps its try spent; none of those
         is a wait, so that is right for them. */
      if (job && job.settled && typeof job.settled.then === 'function') {
        job.settled.then(() => {
          if (job.waited !== true) return;
          tries.set(pin, Math.max(0, (tries.get(pin) || 0) - 1));
          // Said in the log, so a wait that keeps happening (a check that keeps running out) is visible there.
          say(`runner-upgrade: openai ${from} -> ${pin}: waiting (${job.because || 'an agent started during the upgrade'})\n`);
        }, () => {});
      }
      return 'started';
    } catch (err) { warn(err); return 'idle'; }
  };
}

module.exports = { makeTick, TRIES };
