'use strict';
/**
 * #2238: restart the board so a world switch takes effect.
 *
 * POST /api/worlds/active writes the new activeWorldId, but a running board
 * froze its world env at boot (worlds.applyActiveWorldEnv runs once at start();
 * ~26 modules freeze store.ROOT at require), so it keeps serving the OLD world
 * until it restarts. This restarts it -- but ONLY when doing so is provably
 * safe, failing to the safe side everywhere else.
 *
 * 🛑 THE WHOLE SAFETY IS ONE QUESTION: will `launchctl stop com.kosmos.board`
 * bring THIS board back? It does iff this board IS the com.kosmos.board launchd
 * job AND that job has unconditional KeepAlive. A board run from source
 * (`node server.js`, no plist) would be stopped and NEVER relaunch -- a bricked
 * board. So canSelfRestart() is CONSERVATIVE by construction: every uncertainty
 * (no plist, no/conditional KeepAlive, launchctl unreadable, missing/mismatched
 * pid) answers NO, and the caller reports restartRequired for a manual restart
 * instead. This mirrors update.js's installedRoot() from-source guard -- the
 * reason the original slice (server.js:2717) deferred self-restart was exactly
 * this, and the guard is what makes it safe to do now.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BOARD_LABEL = 'com.kosmos.board';

// The LaunchAgents dir, honouring the product's test seam (#332): a suite sets
// AGENT_WORKFORCE_LAUNCH so it never reads (or restarts against) the operator's
// real LaunchAgents. machine.js's labelTruthCheck reads the same seam.
function launchDir() {
  return process.env.AGENT_WORKFORCE_LAUNCH
    || path.join(process.env.HOME || '', 'Library', 'LaunchAgents');
}
function plistPath() { return path.join(launchDir(), `${BOARD_LABEL}.plist`); }

// Injectable so tests never touch real launchctl (and CI has no board job). Same
// shape + raised maxBuffer as machine.js's run(): `launchctl print gui/<uid>`
// emits >100 KB on a busy login and would otherwise throw on the 1 MB default.
let runner = (cmd, args) => {
  try {
    return { ok: true, stdout: execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) { return { ok: false, because: String((err && err.message) || err) }; }
};
function setRunner(fn) { runner = fn; }

function uid() { return typeof process.getuid === 'function' ? process.getuid() : null; }

// The plist must exist AND declare UNCONDITIONAL KeepAlive (<true/>) or a clean
// stop is not guaranteed to relaunch. A CONDITIONAL KeepAlive (a <dict>) is
// deliberately treated as NOT safe: it may choose not to relaunch after a clean
// stop, which is the exact brick we refuse to risk.
function hasUnconditionalKeepAlive() {
  let xml;
  try { xml = fs.readFileSync(plistPath(), 'utf8'); } catch { return false; }
  return /<key>\s*KeepAlive\s*<\/key>\s*<true\s*\/>/.test(xml);
}

// Is launchd running THIS process as the com.kosmos.board job right now?
// Conservative: any failure to POSITIVELY confirm -> false.
function isThisProcessTheBoardJob() {
  const u = uid();
  if (u === null) return false;
  const r = runner('launchctl', ['print', `gui/${u}/${BOARD_LABEL}`]);
  if (!r.ok || typeof r.stdout !== 'string') return false;
  const m = r.stdout.match(/\bpid\s*=\s*(\d+)\b/);
  if (!m) return false;                    // not running, or shape we do not recognise -> unsure -> no
  return Number(m[1]) === process.pid;     // stopping the job stops US iff its live pid is ours
}

/**
 * Will `launchctl stop com.kosmos.board` bring this board back? True ONLY when
 * the plist exists with unconditional KeepAlive AND launchd is running THIS
 * process as that job. Every other answer is false -> the caller reports
 * restartRequired and never exits.
 * @returns {{canRestart:boolean, because:string}}
 */
function canSelfRestart() {
  if (!fs.existsSync(plistPath())) {
    return { canRestart: false, because: 'this board is not the com.kosmos.board launchd job (from-source or unmanaged); restart it by hand' };
  }
  if (!hasUnconditionalKeepAlive()) {
    return { canRestart: false, because: 'the board job has no unconditional KeepAlive, so a stop might not relaunch it; restart it by hand' };
  }
  if (!isThisProcessTheBoardJob()) {
    return { canRestart: false, because: 'this process is not the running com.kosmos.board job; restart the board by hand' };
  }
  return { canRestart: true, because: 'the board is the com.kosmos.board KeepAlive job and will relaunch when stopped' };
}

/**
 * Stop the board so launchd relaunches it on the world env now on disk. ONLY
 * call after canSelfRestart().canRestart === true AND after the HTTP response
 * has flushed (this stops THIS process). Mirrors restart-local-board.sh's stop
 * form: the gui-domain target, falling back to the bare label.
 * @returns {{ok:boolean, because?:string}}
 */
function selfRestart() {
  const can = canSelfRestart();
  if (!can.canRestart) return { ok: false, because: can.because };
  const u = uid();
  let r = runner('launchctl', ['stop', `gui/${u}/${BOARD_LABEL}`]);
  if (!r.ok) r = runner('launchctl', ['stop', BOARD_LABEL]);
  if (!r.ok) return { ok: false, because: `could not stop the board job: ${r.because}` };
  return { ok: true };
}

module.exports = { canSelfRestart, selfRestart, setRunner };
