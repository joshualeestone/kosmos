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
 *
 * ─── #570: AND THE SAME QUESTION ON WINDOWS ──────────────────────────────────
 *
 * 🛑 THIS MODULE HAD NO win32 ARM AT ALL, so a Windows world switch always fell
 * through the launchd checks to "restart it by hand" -- honestly, but with a
 * sentence about a `com.kosmos.board` launchd job that does not exist on that
 * machine. Two of the three reasons it gave were unreachable there
 * (`process.getuid` is not a function on win32, so `loadedJob` could never
 * succeed), which made the refusal a Mac answer wearing a Windows coat.
 *
 * 🔑 THE WINDOWS ANSWER TO "WILL A STOP BRING THIS BOARD BACK" IS A DIFFERENT
 * FACT, not a translated one. There is no `kosmos restart` to drive: the
 * Windows zip's `bin\kosmos` (#570, win32-kosmos-cli-570) is the AGENT's command
 * and has no board verbs. `installedKosmosCli()` is therefore NOT null on a
 * Windows bundle, and the `kosmos` arm below must not be reached there -- it is
 * not, because canSelfRestart returns at the win32 check before asking.
 * What exists is the board's own at-logon Scheduled Task (engine/win32board.js),
 * and the question becomes: was THIS board started by that task? If it was,
 * ending the task ends this process and running it starts a fresh one. If it was
 * not -- a hand-started `Kosmos.exe`, a from-source `node server.js` -- then
 * ending the task stops nothing and running it would start a SECOND board that
 * dies on the port. So the same conservative rule holds, on a different proof.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { installedKosmosCli } = require('./clipath');
const worlds = require('./worlds');
const launchidentity = require('./launchidentity');

const BOARD_LABEL = 'com.kosmos.board';

/* #2454: THE INSTALLED BOARD IS NOT A LAUNCHD-SUPERVISED PROCESS, so the
   launchctl-stop path below cannot restart it. The login job `com.kosmos.board`
   runs `kosmos start`, which DAEMONISES a detached node board and EXITS
   (RunAtLoad + NO KeepAlive, deliberately -- see install/setup.sh); the running
   board is a detached grandchild, never the launchd job's pid. So `launchctl
   stop` targets an already-exited job and never touches the board, and
   canSelfRestart's launchctl arm correctly reports the installed board as
   not-self-restartable (no unconditional KeepAlive). The restart that DOES work
   for it is `kosmos restart` -- the SAME CLI the software-update path drives --
   spawned detached so it outlives the board it stops. Injectable so tests never
   spawn a real kosmos or probe a real install. */
let installedCliFn = () => installedKosmosCli();
function setInstalledCli(fn) { installedCliFn = fn; }
let spawner = (cmd, args, opts) => spawn(cmd, args, opts);
function setSpawner(fn) { spawner = fn; }

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

/* #570: the win32 seam, alongside the launchctl one and for the same reason -- a
   test must never shell a real `schtasks` or bounce the operator's own board.
   Lazily required so a Mac never loads the Windows module just to read a plist. */
let boardOpsFn = () => require('./win32board');
function setBoardOps(fn) { boardOpsFn = typeof fn === 'function' ? fn : () => require('./win32board'); }

/**
 * ⚠️ INJECTABLE FOR THE MIRROR OF THIS BRANCH'S OWN RULE. The rule is that a Mac
 * must be able to assert the win32 arm; the same discipline run backwards says
 * the fleet's WINDOWS box must be able to assert the darwin arm -- and it could
 * not, because `process.getuid` does not exist there, so `loadedJob()` failed for
 * a reason that had nothing to do with the guard under test. Four assertions
 * about a Mac-only decision were red on Windows, measured 2026-09-09, and every
 * one of them went green on this seam alone. The default is unchanged. */
let uidFn = () => (typeof process.getuid === 'function' ? process.getuid() : null);
function setUid(fn) { uidFn = typeof fn === 'function' ? fn : () => (typeof process.getuid === 'function' ? process.getuid() : null); }
function uid() { return uidFn(); }

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
 * board. Every uncertainty -> false. This is the DEV board's path (com.kosmos.board
 * runs `node server.js` directly as the KeepAlive job).
 * @returns {{canRestart:boolean, because:string}}
 */
function launchctlKeepAlive() {
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
 * Can this board restart itself onto the newly-active world, and by which path?
 * Two mechanisms, tried most-specific first, each fail-safe:
 *   via 'launchctl' -- the dev com.kosmos.board KeepAlive job IS this process; a
 *                      `launchctl stop` relaunches it (one atomic launchd op).
 *   via 'kosmos'    -- an INSTALLED board (runtime + app present). launchd does NOT
 *                      supervise it (the login job daemonises `kosmos start` and
 *                      exits, RunAtLoad + no KeepAlive), so it is restarted with a
 *                      detached `kosmos restart` -- the SAME CLI the update path
 *                      drives. Gated on the installed layout (engine/clipath), so a
 *                      from-source `node server.js` -- which a stop would never
 *                      bring back -- resolves to null and is NEVER restarted.
 * Every uncertainty -> canRestart:false, and the caller reports restartRequired for
 * a manual restart instead.
 *
 * #570: `platform` is a defaulted PARAMETER, never a bare `process.platform`
 * read, so a Mac can assert the win32 arm and a Windows box the darwin one --
 * the discipline `engine/remove.js`'s `jobOps(platform)` set for this branch.
 * @returns {{canRestart:boolean, because:string, via?:string, cli?:string}}
 */
function canSelfRestart(platform = process.platform) {
  if (platform === 'win32') return win32CanRestart();
  const la = launchctlKeepAlive();
  if (la.canRestart) return { canRestart: true, because: la.because, via: 'launchctl' };
  const cli = installedCliFn();
  if (cli) {
    return { canRestart: true, via: 'kosmos', cli, because: 'the installed board will be restarted with `kosmos restart` onto the new world' };
  }
  // Neither path viable: surface the launchctl reason for the manual banner.
  return { canRestart: false, because: la.because, via: null };
}

/**
 * #570: the Windows arm of the same question, and it is ONE fact rather than
 * three. See this file's header for why the Mac's three checks do not translate.
 *
 * 🛑 EVERY REFUSAL NAMES SOMETHING A PERSON CAN DO. That is the actual defect
 * BLOCKER 4 is about: the board not coming back was bad, and nothing SAYING so
 * was what made it a blocker. A Windows board that cannot bounce itself must say
 * which of the two reasons it is -- nothing registered to start it, or this
 * particular board was not started by what is registered -- because those have
 * different remedies.
 */
function win32CanRestart() {
  let ops;
  try { ops = boardOpsFn(); } catch (e) {
    return { canRestart: false, via: null, because: `we could not check how this board is started on Windows (${String((e && e.message) || e)}); restart it by hand` };
  }
  const st = ops.status();
  /* #2973: a logon job we could not read might be one that cannot bring the board
     back, so could-not-tell is a refusal, and so is anything but a job known to be on. */
  if (st.known === false) {
    return { canRestart: false, via: null,
      because: `we could not read the job that starts the board at logon (${ops.TASK_NAME}${st.because ? ': ' + st.because : ''}), so stopping the board might not bring it back; restart it by hand` };
  }
  if (!st.registered) {
    return { canRestart: false, via: null,
      because: 'nothing on this computer starts the board at logon yet, so stopping it would not bring it back; restart it by hand' };
  }
  if (st.enabled !== true) {
    return { canRestart: false, via: null,
      because: `the job that starts the board at logon (${ops.TASK_NAME}) is switched off, so stopping it would not bring it back; restart it by hand` };
  }
  if (!ops.startedByTask()) {
    return { canRestart: false, via: null,
      because: `this board was started by hand rather than by its logon job (${ops.TASK_NAME}), so stopping that job would not stop this board; restart it by hand` };
  }
  return { canRestart: true, via: 'schtasks',
    because: `the board runs from its logon job (${ops.TASK_NAME}) and will be started again from it` };
}

/**
 * Restart an INSTALLED board with a detached `kosmos restart` that OUTLIVES it:
 * the child stops this board (kosmos stop kills this process by pidfile) then
 * starts a fresh one (kosmos start) that boots the now-active world. Mirrors
 * engine/update.js's detached installer -- the proven pattern for a child that
 * must survive killing its own parent.
 *
 * 🛑 STRIP THE WORLD-OVERRIDE ENV. This board applied the OLD world's data-root
 * overrides at boot (engine/worldenv). `kosmos start` inherits our env, and a
 * switch TO the default world sets NO overrides -- so an inherited
 * AGENT_WORKFORCE_DATA/_PROJECTS/_WORKERS would silently keep the fresh board on
 * the OLD world's data (a cross-world bleed, the exact class worldenv exists to
 * prevent). Deleting them makes the fresh board re-derive its roots purely from
 * the registry, exactly as a login `kosmos start` does.
 * @returns {{ok:boolean, because?:string}}
 */
function kosmosRestart(cli) {
  const env = { ...process.env };
  for (const k of worlds.WORLD_ROOT_ENV_VARS) delete env[k];
  /* #1704: and the world itself. A fresh board that inherited KOSMOS_WORLD or the
     pre-world marker would hand the OLD world to every agent it launches, the same
     bleed the three deletes above prevent for the data roots. */
  delete env[worlds.PRE_WORLD_ROOTS_ENV_VAR];
  delete env[launchidentity.WORLD_ENV_VAR];
  let child;
  try {
    child = spawner(cli, ['restart'], { detached: true, stdio: 'ignore', env });
  } catch (e) {
    // A SYNCHRONOUS spawn throw is rare (e.g. bad options); the real failures are async.
    return { ok: false, because: `could not start the board restart: ${String((e && e.message) || e)}` };
  }
  // 🛑 spawn signals ENOENT / EACCES / EMFILE / EAGAIN via an ASYNCHRONOUS 'error'
  // event, NOT a throw -- so the try/catch above catches almost nothing real. With no
  // 'error' listener that event becomes an uncaught exception, which on an installed
  // board (RunAtLoad + no KeepAlive) crashes the very process launchd will NOT
  // relaunch: a bricked board, the exact fail-safe violation this module exists to
  // avoid. Attach the listener the moment the child exists (mirrors update.js's
  // wireChild). Best-effort: log to stderr, never rethrow -- the client's reconnect
  // then times out to the honest manual banner rather than the board dying silently.
  if (child && typeof child.on === 'function') {
    child.on('error', (err) => {
      try { process.stderr.write(`Kosmos board restart could not start: ${String((err && err.message) || err)}\n`); } catch { /* stderr gone with the dying process */ }
    });
  }
  if (child && typeof child.unref === 'function') child.unref();
  return { ok: true };
}

/**
 * Restart the board so it comes back on the world env now on disk. ONLY call
 * after canSelfRestart().canRestart === true AND after the HTTP response has
 * flushed (either path ends THIS process). Routes by the path canSelfRestart
 * chose: a detached `kosmos restart` for an installed board, else the dev
 * launchctl stop (gui-domain target, falling back to the bare label).
 * @returns {{ok:boolean, because?:string}}
 */
function selfRestart(platform = process.platform, opts = {}) {
  const can = canSelfRestart(platform);
  if (!can.canRestart) return { ok: false, because: can.because };
  /* #570: end the logon task, wait for the board to actually be gone, run it
     again -- driven from a detached helper, because step one kills this process.
     engine/win32board.restart() owns the sequence and the measurement behind it.
     #2973: `port` is this board's, which the helper asks to confirm one came back. */
  if (can.via === 'schtasks') return boardOpsFn().restart({ port: opts && opts.port });
  if (can.via === 'kosmos') return kosmosRestart(can.cli);
  const u = uid();
  let r = runner('launchctl', ['stop', `gui/${u}/${BOARD_LABEL}`]);
  if (!r.ok) r = runner('launchctl', ['stop', BOARD_LABEL]);
  if (!r.ok) return { ok: false, because: `could not stop the board job: ${r.because}` };
  return { ok: true };
}

module.exports = { canSelfRestart, selfRestart, setRunner, setInstalledCli, setSpawner, setBoardOps, setUid };
