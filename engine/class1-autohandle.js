'use strict';

/*
 * #2808 class-1 (c): the INVISIBLE auto-handle for a technical permission/trust
 * prompt (Josh's LOCKED ruling 2026-09-14 16:49: "auto-handler #1 invisibly. i
 * want all auto-clear stuff cleared.").
 *
 * WHAT IT AUTOMATES. When an agent is parked on Claude Code's own folder-trust /
 * bypass prompt, the board records a STANDING `needs_you` written by the lifecycle
 * hook (by:'auto'). Today a person resolves it by clicking the /trust-and-restart
 * button (server.js:5147), which does NOT keystroke the live dialog - it writes the
 * folder-trust key through the SAME writer the create/relaunch path uses
 * (create.trustAgentFolder) and then restarts the agent, so the relaunch reads the
 * key and never shows the dialog. This module turns that one manual click into an
 * automatic decision, so the end user never sees the junk (class-1 prevention:
 * #3087; this is the live-handle fallback for when a prompt surfaces anyway - a
 * relaunch that happened before #3087 shipped, a create-before-shim race, or a
 * #2173 config-divergence where the shim's write lands where the agent does not read).
 *
 * WHY write-key-and-restart, NOT send-keys. A mis-fired keystroke into a real
 * conversation is the whole hazard of this feature. Reusing trustAgentFolder +
 * restart (the tested manual path) sidesteps it entirely: no keys are ever sent
 * into a pane, and trustFolder's own #2173 config-dir logic writes where the agent
 * actually reads.
 *
 * SAFE BY CONSTRUCTION.
 *  - Fires ONLY on the stable class-1 seam: a standing report with
 *    found && state === 'needs_you' && by === 'auto' - selfreport.js's own
 *    `standingIsAutoPermissionWait` (selfreport.js:222). It NEVER fires on
 *    by:'agent' (class 2, the agent's OWN substantive question, which must be kept
 *    and surfaced, never auto-cleared - Josh: "do NOT silently drop these"),
 *    by:'operator', or a by:null legacy line (absence is not agent-typed and is
 *    not auto-typed either; #1453/#2575). Angel's class-2 by/permissionAsk is a
 *    REFINEMENT of this same split - see WIRE-UP below; it is a one-line change to
 *    the predicate, not a new mechanism.
 *  - Loop-guarded. A handle that does not clear the state (a persistent #2173
 *    divergence would re-park the agent on the same dialog after the restart) must
 *    ESCALATE, never infinite-restart. After `maxAttempts` handles inside
 *    `windowMs`, planClass1Handle returns act:'escalate' so the caller surfaces it
 *    to a person instead of looping an agent forever.
 *  - The decision (planClass1Handle) is a PURE function and the executor
 *    (runClass1Handle) is dependency-injected, so both are tested with red-capable
 *    controls and neither touches a real agent in a test.
 *
 * WIRE-UP (the "one wire-up from class-2", #2808 (c) goal). Two seams, both marked
 * below with WIRE-UP comments:
 *   1. `isClass1` is the predicate. When Angel's class-2 build lands its richer
 *      by/permissionAsk classification, tighten this ONE predicate to it; the plan
 *      and executor do not change.
 *   2. Nothing in this module runs it automatically. A supervisor sweep or a status
 *      tick calls sweepClass1(...) to get the plans, then - only once the operator/
 *      class-2 arms it - calls runClass1Handle on the 'trust-and-restart' plans.
 *      Until then callers run it in dry-run (plan only, no action), which is why the
 *      planner and the executor are separate functions.
 */

const selfreport = require('./selfreport');

const CLASS1_STATE = 'needs_you';
const CLASS1_BY = 'auto';

// Defaults for the loop-guard. Two handles inside ten minutes is enough to clear a
// transient race; a third inside the window means the restart is not fixing it (a
// real divergence), so escalate rather than loop.
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

/*
 * Is this standing report a class-1 technical permission/trust wait that we may
 * auto-handle? This is the ONE place the class-1 vs class-2 line is drawn, and it
 * mirrors selfreport.js:222-224 exactly (found + needs_you + by==='auto') so the two
 * cannot disagree about what "class 1" is.
 *
 * It is NOT re-derived here: it delegates to selfreport.isAutoPermissionWait, the ONE
 * definition record()'s #2456 clobber-guard also uses, so the auto-handle's class-1
 * line and the store's class-1 line cannot silently diverge (the two-derivations
 * defect this codebase names as its most-shipped). class1-autohandle.test.js pins the
 * two equal across shared fixtures.
 *
 * WIRE-UP #1: Angel's class-2 by/permissionAsk refines the class-1-vs-class-2 line.
 * When it lands, tighten selfreport.isAutoPermissionWait (its single home); this
 * wrapper and everything below follow automatically.
 */
function isClass1(standing) {
  return selfreport.isAutoPermissionWait(standing);
}

/*
 * PURE decision. Given an agent's standing report, its prior handle timestamps
 * (ms since epoch, most recent last), and the current time, decide what to do.
 *
 * @param {object} standing  the result of selfreport.read(name).
 * @param {number[]} attempts  ms timestamps of prior auto-handles for THIS agent.
 * @param {number} now  ms.
 * @param {{maxAttempts?:number, windowMs?:number}} [opts]
 * @returns {{act:'none'|'trust-and-restart'|'escalate', because:string,
 *            recentAttempts?:number}}
 *   - 'none': not a class-1 wait; leave it alone (class 2 / operator / legacy /
 *     any non-needs_you state). This is the SAFE default and the fail-closed one.
 *   - 'trust-and-restart': a class-1 wait under the attempt cap; the caller may run
 *     the handle.
 *   - 'escalate': a class-1 wait that has already been handled maxAttempts times in
 *     the window without clearing; surface to a person, do NOT restart again.
 */
function planClass1Handle(standing, attempts, now, opts) {
  const maxAttempts = (opts && Number.isFinite(opts.maxAttempts)) ? opts.maxAttempts : DEFAULT_MAX_ATTEMPTS;
  const windowMs = (opts && Number.isFinite(opts.windowMs)) ? opts.windowMs : DEFAULT_WINDOW_MS;

  if (!isClass1(standing)) {
    // Fail closed: anything we are not certain is class-1 technical junk is left
    // exactly as it is. A class-2 real question reaching here and being handled
    // would silently drop a blocking request and stall the fleet.
    return { act: 'none', because: 'not a standing by:auto needs_you (class-1) wait' };
  }

  // Count handles still inside the window. Both non-safe shapes bias toward
  // ESCALATE, never toward another restart: a future timestamp (clock skew, t > now)
  // is recent by the < windowMs test, and a NON-FINITE / corrupt entry (NaN,
  // undefined - the kind the WIRE-UP #2 persistent attempts store could yield) is
  // counted as recent explicitly rather than dropped, so a bad timestamp can only
  // ever make us escalate sooner, never loop-restart an agent.
  const list = Array.isArray(attempts) ? attempts : [];
  const recentAttempts = list.filter((t) => !Number.isFinite(t) || (now - t) < windowMs).length;

  if (recentAttempts >= maxAttempts) {
    return {
      act: 'escalate',
      recentAttempts,
      because: `already auto-handled ${recentAttempts} time(s) within ${windowMs}ms and the class-1 wait is still standing - a restart is not clearing it (likely a #2173 config divergence), so escalate rather than loop`,
    };
  }

  return {
    act: 'trust-and-restart',
    recentAttempts,
    because: 'a standing by:auto needs_you (Claude Code trust/permission prompt); write the folder-trust key and restart so the relaunch clears it, invisibly',
  };
}

/*
 * THIN executor. Perform the trust-and-restart handle for one agent, reusing the
 * exact functions the manual /trust-and-restart route uses. Dependency-injected so
 * a test never touches a real agent.
 *
 * @param {string} name
 * @param {{trustAgentFolder:function, restart:function, RESTARTED:string}} deps
 *   - trustAgentFolder(name) -> { wrote:boolean, because?:string } (create.trustAgentFolder)
 *   - restart(name, cause) -> { outcome:string, because?:string } (remove.restart)
 *   - RESTARTED: the outcome token that means the restart succeeded (remove.OUTCOME.RESTARTED)
 * @returns {{handled:boolean, trusted:object, restarted:object, because:string}}
 *   handled is keyed on the RESTART outcome, not the trust write: the restart is
 *   what clears the dialog, and it re-runs the #3087 launch shim (which re-writes
 *   trust+bypass) on the way up, so a soft-failed trust write here is not fatal as
 *   long as the restart lands. A refused/partial restart is `handled:false`, and
 *   the loop-guard will escalate if the state persists.
 */
function runClass1Handle(name, deps) {
  const { trustAgentFolder, restart, RESTARTED } = deps || {};
  if (typeof trustAgentFolder !== 'function' || typeof restart !== 'function' || typeof RESTARTED !== 'string') {
    return { handled: false, trusted: null, restarted: null, because: 'runClass1Handle needs trustAgentFolder, restart, and RESTARTED injected' };
  }

  // Best-effort trust write first (as the manual route does), so a fresh-user
  // config that never had the key gets it before the relaunch reads it. Its own
  // failure is not fatal - the restart re-runs the launch shim - so we record it
  // but do not abort on it.
  let trusted;
  try { trusted = trustAgentFolder(name); }
  catch (err) { trusted = { wrote: false, because: String((err && err.message) || err) }; }

  let restarted;
  try { restarted = restart(name, 'restart'); }
  catch (err) { restarted = { outcome: 'error', because: String((err && err.message) || err) }; }

  const handled = !!restarted && restarted.outcome === RESTARTED;
  return {
    handled,
    trusted,
    restarted,
    because: handled
      ? 'wrote the folder-trust key and restarted the agent; the relaunch clears the prompt invisibly'
      : `the restart did not complete (${(restarted && (restarted.because || restarted.outcome)) || 'unknown'}), so the prompt was not cleared`,
  };
}

/*
 * Map a set of agent names to their class-1 plans, WITHOUT acting. This is the
 * dry-run surface: a supervisor sweep or a status tick calls this to see what would
 * be handled, and only an armed caller then runs runClass1Handle on the
 * 'trust-and-restart' entries.
 *
 * @param {string[]} names
 * @param {{read:function, attemptsFor?:function}} deps
 *   - read(name) -> standing report (selfreport.read)
 *   - attemptsFor(name) -> number[] of prior handle ms (optional; [] if absent)
 * @param {number} now  ms
 * @param {object} [opts]  forwarded to planClass1Handle
 * @returns {Array<{name:string, plan:object}>}
 */
function sweepClass1(names, deps, now, opts) {
  const read = deps && deps.read;
  const attemptsFor = (deps && deps.attemptsFor) || (() => []);
  if (typeof read !== 'function') throw new Error('sweepClass1 needs a read(name) function');
  const list = Array.isArray(names) ? names : [];
  return list.map((name) => {
    let standing;
    try { standing = read(name); }
    catch (err) { standing = { found: false, because: String((err && err.message) || err) }; }
    // attemptsFor is the WIRE-UP #2 persistent store's reader (I/O-backed), so it can
    // throw; degrade THIS agent to no-history rather than crashing the whole sweep and
    // returning no plan for any agent - symmetric with read()'s guard above. No history
    // means planClass1Handle sees recentAttempts 0, so a genuine class-1 wait still
    // plans trust-and-restart (the loop-guard just loses its memory for this one tick).
    let attempts;
    try { attempts = attemptsFor(name); }
    catch { attempts = []; }
    const plan = planClass1Handle(standing, attempts, now, opts);
    return { name, plan };
  });
}

module.exports = {
  isClass1,
  planClass1Handle,
  runClass1Handle,
  sweepClass1,
  CLASS1_STATE,
  CLASS1_BY,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_WINDOW_MS,
};
