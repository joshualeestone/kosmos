'use strict';
/**
 * Ending a Windows agent's session: the analog of `tmux kill-session` (#570).
 *
 * 🛑 THE HALF OF `remove.js` THAT WAS STILL MAC-SHAPED. #570 ported the JOB-level
 * acts (`win32job.disable/end/enable/start`), so a Windows removal correctly
 * stopped the thing that STARTS an agent -- and then reached for tmux to end the
 * agent itself:
 *
 *      it was not set to start on its own, so there was nothing to turn off  ok
 *      closed its window                                                     FAILED
 *
 * That is R6 of the dress rehearsal, and it is also every restart: `restartInner`
 * ends the session and lets the supervisor bring it back, so with no win32 arm
 * the Restart button could not work either. On this platform an agent is a
 * spawned process with a HIDDEN CONSOLE (see win32launch), not a pane, so ending
 * it is ending that process.
 *
 * 🔑 STOPPING AN AGENT IS STILL NOT THIS. `win32job`'s header draws the line and
 * it holds here: killing the process is a DEATH, and the supervisor is supposed
 * to answer a death by restarting -- which is why `remove` disables the task
 * BEFORE calling this, and why `restart` deliberately does not. This module is
 * only the kill; whether the agent comes back is the job's business, and the
 * ordering at the call sites is what makes "stopped" mean stopped.
 *
 * ⚠️ `/T`, BECAUSE THE PID IS THE AGENT, NOT THE TREE. `claude agents --json`
 * reports the Claude process's own pid; that process has children (its tool
 * subprocesses, anything it spawned), and on Windows killing a parent does not
 * touch them. Ending a tmux session takes down everything in the pane, so the
 * faithful analog is the tree, not the one process. Without `/T` a removal would
 * leave the agent's children running and orphaned.
 *
 * ⚠️ THE LOOK-AGAIN ASKS THE PROCESS, NOT `agents --json`, and this is a
 * deliberate departure from the Mac's shape rather than an oversight. The Mac
 * re-asks tmux `has-session` because tmux is the authority on its own sessions.
 * Here the authority on whether a process is gone is the process table:
 * `agents --json` is a REGISTRY, and a registry can lag a process's death by a
 * tick. Re-reading it would report "still there" over a kill that worked -- and a
 * false failure is not harmless in either caller: removal answers PARTIAL ("it is
 * still going") over a stopped agent, and restart clears the disruption record
 * and refuses a restart that in fact happened. The pid is what we acted on, and
 * it answers instantly.
 *
 * 📌 PID REUSE IS THE RESIDUAL RACE, and it is stated rather than hidden: between
 * the kill and the look-again Windows could in principle hand that pid to
 * something else, and we would read the agent as still alive and report a
 * failure. That is the SAFE direction (we under-claim), it needs a pid to be
 * recycled inside a few milliseconds, and the Mac carries the same class of race
 * with a session name. It is not worth a second mechanism.
 */
const cp = require('node:child_process');

const liveExec = require('./live-execution');
const win32live = require('./win32live');
const win32sessions = require('./win32sessions');

/* The command seam, in the shape win32job uses: tests replace it, production
   shells taskkill. Returns { ok, out, code } and never throws, so every caller
   reports rather than unwinds. */
let runFn = null;
function setRunner(fn) { runFn = typeof fn === 'function' ? fn : null; }
function run(args) {
  if (runFn) return runFn(args);
  /* 🛑 #1598's GATE, AND THIS MODULE IS SQUARELY ITS SUBJECT. That card's own
     header names `tmux kill-session` as the thing it exists to stop a test from
     running against the operator's live fleet -- and this function is that verb
     on this platform, against a pid rather than a session name. A new module
     that shells a FORCED TREE KILL is the last place to leave outside a
     fail-closed design, so it opts in the same way `remove.js` does: production
     states its intent once, everything else refuses or dry-runs.

     A dry-run returns ok, and the look-again then correctly reports the process
     as still there -- so a dry-run reads as "we could not close it" rather than
     as a kill that happened, which is the honest direction and matches what
     `remove.js` documents about its own dry-run. */
  if (!liveExec.liveExecutionAllowed()) {
    liveExec.refuseOrWarn('engine/win32stop.js', 'taskkill.exe', args);
    return { ok: true, out: '', dryRun: true };
  }
  try {
    const out = cp.execFileSync('taskkill.exe', args, { encoding: 'utf8', timeout: 20000 });
    return { ok: true, out: String(out || '') };
  } catch (e) {
    return { ok: false, out: String((e && (e.stdout || e.message)) || ''), code: (e && e.status) };
  }
}

/* The look-again seam, separate from the command seam because it is a different
   question asked of a different authority (see the header). Default: signal 0,
   which delivers nothing and merely asks whether the pid can be signalled --
   ESRCH means gone, and that is the answer we want. */
let aliveFn = null;
function setAlive(fn) { aliveFn = typeof fn === 'function' ? fn : null; }

/**
 * The decision itself: given what `process.kill(pid, 0)` threw, is the process
 * still there?
 *
 * ⚠️ ESRCH is the ONLY code that means gone. EPERM means the process is very much
 * there and we may not signal it -- reading that as "gone" would report a
 * successful kill over a live agent, which is the one answer this module must
 * never give. Anything we cannot interpret is treated as still alive, the
 * fail-closed direction.
 *
 * 🔑 A PURE FUNCTION, AND THAT IS THE POINT -- the same reason `win32launch`
 * keeps `childEnv` and `argvFor` pure. Its first test asserted the rule through a
 * real pid, chosen by measuring Windows (pid 4 is System there: alive, and not
 * ours to signal). That test then FAILED ON THE FLEET'S MACS, where pid 4 answers
 * ESRCH -- a guard about platform behaviour that only held on one platform, which
 * is this lane's own recurring defect turned on its own test. The rule is about
 * the error code, so it is asserted on the error code.
 */
function aliveFromError(e) { return !(e && e.code === 'ESRCH'); }

function alive(pid) {
  if (aliveFn) return Boolean(aliveFn(pid));
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return aliveFromError(e);
  }
}

/* The live-read seam, module-level for the same reason win32job's runner is: the
   win32 arm of `remove.js` is asserted FROM THE FLEET'S MACS by passing
   `platform: 'win32'`, and without a seam here that assertion would run a real
   `claude agents --json` against the operator's own machine -- the #1598 hazard,
   one module over. Production reads for real. */
let liveFn = null;
function setLive(fn) { liveFn = typeof fn === 'function' ? fn : null; }
function liveByName(opts) {
  if (liveFn) return liveFn(opts);
  return win32live.byName(opts);
}

/**
 * Resolve the board's name to the live session behind it.
 *
 * Returns { found: true, sessionId, pid } / { found: false } when the look
 * succeeded and nothing owned is running under that name / { unknown: true } when
 * the live list could not be read at all -- the three worlds `remove.js` already
 * insists on keeping apart.
 */
function resolve(name, opts) {
  const map = liveByName(opts);
  // A failed look is an UNKNOWN, never "nothing is running".
  if (!map) return { unknown: true, found: false };
  const hit = map.get(String(name));
  if (!hit) return { unknown: false, found: false };
  /* A live entry with no usable pid is an UNKNOWN too, not a miss: something
     owned IS running under this name and we have no way to end it, so saying
     "nothing to stop" would be the false-zero one layer down. */
  if (!Number.isInteger(hit.pid) || hit.pid <= 0) return { unknown: true, found: false };
  return { unknown: false, found: true, sessionId: hit.sessionId, pid: hit.pid };
}

/**
 * End the session running under this name. The `tmux kill-session` analog.
 *
 * Returns { ok: true } when the session is gone -- including when it was already
 * gone before we asked, which is the same posture `win32job.end` takes toward a
 * task that is not running and the Mac takes toward `kill-session`'s exit 1.
 * Returns { ok: false, because } otherwise, and NEVER throws.
 */
function end(name, opts) {
  const found = resolve(name, opts);
  if (found.unknown) {
    return { ok: false, because: 'we could not check what is running on this computer' };
  }
  // Nothing owned is running under that name: the end state we wanted.
  if (!found.found) return { ok: true, already: true };
  return killAndForget(found.pid, found.sessionId);
}

/* A bounded synchronous park, the shape chat.js and filelock.js already use:
   Atomics.wait on a private buffer blocks this thread for the timeout with no
   busy loop. Seamed so a test never actually sleeps. */
const PARK = new Int32Array(new SharedArrayBuffer(4));
let parkFn = null;
function setPark(fn) { parkFn = typeof fn === 'function' ? fn : null; }
function park(ms) {
  if (parkFn) { parkFn(ms); return; }
  try { Atomics.wait(PARK, 0, 0, ms); } catch { /* a park we cannot take is not a failure */ }
}

/**
 * End the session with THIS id, waiting for it to appear if it has not yet.
 *
 * 🛑 WHY THIS IS NOT `end(name)`, AND THE DIFFERENCE IS THE WHOLE POINT. `end`
 * asks an open question -- "is anything of ours running under this name?" -- and
 * an empty answer is a legitimate "nothing is". This asks a closed one: the
 * caller JUST LAUNCHED this session and holds its id, so "it is not in the live
 * list" does not mean it is not running. It means NOT YET.
 *
 * ⚠️ A win32 agent takes ~5s to register (measured, see win32launch). A rollback
 * that reads the list once, immediately, sees nothing and concludes there is
 * nothing to stop -- and walks away from a live agent it started. That is the
 * false-zero this module family exists to refuse, one layer up: positive
 * knowledge that a launch happened outranks an empty look.
 *
 * So it polls to `waitMs` before giving up, and giving up is reported as a
 * FAILURE with a sentence, never as "already gone".
 */
function endSession(sessionId, opts) {
  const o = opts || {};
  const waitMs = Number.isFinite(o.waitMs) ? o.waitMs : 12000;
  const stepMs = Number.isFinite(o.stepMs) ? o.stepMs : 500;
  let waited = 0;
  for (;;) {
    const map = liveByName(o);
    if (map) {
      for (const hit of map.values()) {
        if (hit && hit.sessionId === sessionId) {
          if (!Number.isInteger(hit.pid) || hit.pid <= 0) {
            return { ok: false, because: 'it is running but we could not find its process' };
          }
          return killAndForget(hit.pid, sessionId);
        }
      }
    }
    if (waited >= waitMs) break;
    park(Math.min(stepMs, waitMs - waited));
    waited += stepMs;
  }
  /* ⚠️ NOT `{ok:true}`. It may have died on its own, in which case there was
     nothing to end -- but it may equally be a session that is slow to register,
     and we cannot tell those apart. The caller launched it, so the honest answer
     is that we could not confirm it stopped. */
  return { ok: false, because: 'we started it, but it never appeared in the list of running agents, so we could not stop it' };
}

/** The kill, the look-again, and the record -- shared by both entry points. */
function killAndForget(pid, sessionId) {
  const r = run(['/PID', String(pid), '/T', '/F']);
  /* taskkill answers 128 for a pid that is not there, which is success for us --
     the same "already in the end state" reading as launchd's exit 3. The message
     is matched too, because taskkill's exit codes are not uniform across Windows
     builds and the text is what it actually prints. */
  const gone = r.ok || r.code === 128 || /not found|no running instance/i.test(r.out || '');
  if (!gone) {
    return { ok: false, because: 'we could not close it (' + String(r.out || '').trim().split('\n')[0] + ')' };
  }

  /* ⚠️ LOOK AGAIN. The kill's own answer is not evidence the process has gone --
     the rule both Mac call sites already carry, and the one that stops a removal
     being reported over a live agent. */
  if (alive(pid)) {
    return { ok: false, because: 'it is still running after we asked it to close' };
  }

  /* Drop the ownership record for the session we just ended. On the Mac the tmux
     `@kosmos_agent` option dies WITH the session, so the ownership claim cannot
     outlive the thing it described; here the record is a file, so nothing expires
     it unless we do. It matters most on RESTART, which ends a session and lets the
     supervisor start another under the same name: leaving the old entry is exactly
     the duplicate-name case win32live documents, where two sessionIds carry one
     name and the later-iterated one wins the key silently.

     Best-effort, and deliberately not gated on: the session IS gone, which is what
     was asked. A failed record write leaves a stale entry -- untidy, and harmless
     to the roster because nothing live matches it -- and reporting the kill as a
     failure over it would be far worse, since the caller would then tell somebody
     their agent is still running when it is not. */
  if (sessionId) win32sessions.forget(sessionId);

  return { ok: true };
}

module.exports = { end, endSession, resolve, aliveFromError, setRunner, setAlive, setLive, setPark };
