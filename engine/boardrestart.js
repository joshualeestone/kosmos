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

// The on-disk plist must declare UNCONDITIONAL KeepAlive (<true/>). This is kept
// ALONGSIDE the LOADED check below, not instead of it: `launchctl print`'s summary
// tells us keepalive IS set on the running job but not WHETHER it is conditional,
// and a CONDITIONAL KeepAlive (a <dict>, e.g. {SuccessfulExit:false}) may not
// relaunch after a clean stop -- the disk <true/> is what rules that out. A binary
// plist (rare for this hand-written / generated XML label) fails to match here and
// resolves to a safe manual restart: a documented limitation, never a brick.
function plistDeclaresUnconditionalKeepAlive() {
  let xml;
  try { xml = fs.readFileSync(plistPath(), 'utf8'); } catch { return false; }
  return /<key>\s*KeepAlive\s*<\/key>\s*<true\s*\/>/.test(xml);
}

// The LOADED launchd job state, from one `launchctl print` -- the AUTHORITATIVE
// answer to "will a stop relaunch this process", because the on-disk plist can
// DIVERGE from what launchd actually loaded: a plist hand-edited without a reload,
// or a job `launchctl disable`d, leaves the disk saying KeepAlive while the live
// job will not relaunch. `launchctl print` summarises the loaded config on a
// `properties = a | b | ...` line; `keepalive` there means the running job has
// keepalive ACTIVE now (a disabled / non-keepalive-loaded job omits it). Returns
// the running pid and that loaded-keepalive fact; any failure to read is {ok:false}.
//
// 🔑 THE `properties = ... keepalive ...` FORMAT IS REAL, NOT ASSUMED. Verified
// against the live com.kosmos.board on this fleet's macOS (launchctl on Darwin):
//   properties = keepalive | runatload | inferred program | managed LWCR | has LWCR
// A pipe-delimited token line, `keepalive` present for a KeepAlive job. The regex
// is word-bounded so it is that token, not a substring of another word.
//
// ⚠️ ONE BOUNDED RESIDUAL, stated rather than hidden: the `properties` line shows
// keepalive is PRESENT but not whether it is UNCONDITIONAL, so a CONDITIONAL
// loaded KeepAlive (a dict) also shows `keepalive`. The disk-plist unconditional
// <true/> check (plistDeclaresUnconditionalKeepAlive) is what rejects a conditional
// KeepAlive -- and it can only be evaded by a divergence in the OTHER direction
// than the one this loaded check closes: a disk plist edited to unconditional while
// the LOADED job is still conditional, without a reload. That does not occur for
// com.kosmos.board: it is written UNCONDITIONAL -- measured on this fleet, the live
// ~/Library/LaunchAgents/com.kosmos.board.plist carries `<key>KeepAlive</key><true/>`,
// and tools/restart-local-board.sh documents it as the KeepAlive board plist -- so a
// conditional loaded com.kosmos.board never exists to diverge from. Even in that
// impossible case the failure is a board that declines to relaunch after a clean
// stop -- recoverable by a manual restart, never data loss.
function loadedJob() {
  const u = uid();
  if (u === null) return { ok: false };
  const r = runner('launchctl', ['print', `gui/${u}/${BOARD_LABEL}`]);
  if (!r.ok || typeof r.stdout !== 'string') return { ok: false };
  const m = r.stdout.match(/\bpid\s*=\s*(\d+)\b/);
  const keepaliveLoaded = /\bproperties\s*=[^\n]*\bkeepalive\b/.test(r.stdout);
  return { ok: true, pid: m ? Number(m[1]) : null, keepaliveLoaded };
}

/**
 * Will `launchctl stop com.kosmos.board` bring this board back? True ONLY when the
 * plist declares unconditional KeepAlive AND the LOADED launchd job is running THIS
 * pid with keepalive active. Requiring the loaded state (not just the disk plist)
 * closes the divergence hole: a disabled or edited-without-reload job whose disk
 * plist still says KeepAlive would otherwise be a false positive that bricks the
 * board. Every uncertainty -> false -> the caller reports restartRequired and
 * never exits.
 * @returns {{canRestart:boolean, because:string}}
 */
function canSelfRestart() {
  if (!fs.existsSync(plistPath())) {
    return { canRestart: false, because: 'this board is not the com.kosmos.board launchd job (from-source or unmanaged); restart it by hand' };
  }
  if (!plistDeclaresUnconditionalKeepAlive()) {
    return { canRestart: false, because: 'the board job has no unconditional KeepAlive, so a stop might not relaunch it; restart it by hand' };
  }
  const job = loadedJob();
  if (!job.ok) {
    return { canRestart: false, because: 'could not read the loaded com.kosmos.board job; restart the board by hand' };
  }
  if (job.pid !== process.pid) {
    return { canRestart: false, because: 'this process is not the running com.kosmos.board job; restart the board by hand' };
  }
  if (!job.keepaliveLoaded) {
    return { canRestart: false, because: 'the running board job has no keepalive loaded (disabled, or the plist was changed without a reload), so a stop would not relaunch it; restart it by hand' };
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
