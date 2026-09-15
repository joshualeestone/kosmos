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
 *    found && state === 'needs_you' && by === 'auto' - via selfreport's own
 *    exported `isAutoPermissionWait` (the same predicate record()'s clobber-guard
 *    uses). It NEVER fires on
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

// No CLASS1_STATE / CLASS1_BY literals live here: the class-1 line ('needs_you' +
// by:'auto') is defined once, in selfreport.isAutoPermissionWait, and this module
// delegates to it. Re-stating the literals here (even exported for reference) would
// be the latent second derivation convention #5 exists to prevent.

// Defaults for the loop-guard. Two handles inside ten minutes is enough to clear a
// transient race; a third inside the window means the restart is not fixing it (a
// real divergence), so escalate rather than loop.
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

/*
 * Is this standing report a class-1 technical permission/trust wait that we may
 * auto-handle? The class-1-vs-class-2 line (found + needs_you + by==='auto') is NOT
 * re-derived here: this delegates to selfreport.isAutoPermissionWait, the ONE
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
  // Require maxAttempts to be a finite INTEGER >= 1. A 0 (or negative) would make
  // recentAttempts >= maxAttempts true on the very first wait (escalate before ever
  // trying a single trust-and-restart), and "0" reads ambiguously as "unlimited" to a
  // future caller. A FRACTIONAL value (2.5) silently permits one extra restart
  // (recentAttempts >= 2.5 needs 3) - the dangerous direction. Anything not a finite
  // integer >= 1 falls back to the default rather than becoming a footgun.
  const maxAttempts = (opts && Number.isInteger(opts.maxAttempts) && opts.maxAttempts >= 1)
    ? opts.maxAttempts : DEFAULT_MAX_ATTEMPTS;
  // windowMs must be finite and > 0. A 0/negative window would make (now - t) < windowMs
  // false for every past attempt, so the loop-guard would never engage and always
  // restart - again the dangerous direction. Fall back to the default otherwise.
  const windowMs = (opts && Number.isFinite(opts.windowMs) && opts.windowMs > 0)
    ? opts.windowMs : DEFAULT_WINDOW_MS;

  if (!isClass1(standing)) {
    // Fail closed: anything we are not certain is class-1 technical junk is left
    // exactly as it is. A class-2 real question reaching here and being handled
    // would silently drop a blocking request and stall the fleet.
    return { act: 'none', because: 'not a standing by:auto needs_you (class-1) wait' };
  }

  // Resolve the attempt history, biasing EVERY corrupt shape toward escalate (never
  // toward another restart), consistent across the container, the entries, and `now`:
  //  - null/undefined attempts = "no history supplied", the legitimate first-wait case
  //    (count 0 -> trust-and-restart);
  //  - a non-array attempts (a persistent store returning garbage - a number, an object -
  //    instead of throwing, which sweepClass1's try/catch would NOT catch) is CORRUPT, so
  //    treat it as fully recent -> escalate, rather than silently coercing it to [] and
  //    restarting;
  //  - a non-finite `now` (a corrupt clock) makes `(now - t) < windowMs` false for every
  //    finite t, which would bias to restart; treat it as "count everything recent";
  //  - a non-finite / future per-entry timestamp counts as recent rather than being
  //    dropped.
  const nowBad = !Number.isFinite(now);
  let recentAttempts;
  if (attempts === null || attempts === undefined) {
    recentAttempts = 0; // no history: the normal first-wait case
  } else if (!Array.isArray(attempts)) {
    recentAttempts = maxAttempts; // corrupt container -> escalate, not restart
  } else {
    recentAttempts = attempts.filter((t) => nowBad || !Number.isFinite(t) || (now - t) < windowMs).length;
  }

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

/*
 * #2808 class-1 (c) ARMED: adapt a board snapshot/roster agent card to the `standing`
 * shape planClass1Handle wants. The armed sweep reads the RECONCILED roster (status.js
 * snapshot / safeRoster).
 *
 * WHAT COUNTS AS CLASS-1 HERE, and why BOTH signals are needed:
 *  1. `stateReportedBy === 'auto'` - a technical prompt the lifecycle hook SELF-REPORTED
 *     (a tool-permission PermissionRequest). This is the paneless / report-driven signal.
 *  2. `isTrustDialogEvidence(stateEvidence)` - the live screen shows Claude Code's
 *     FOLDER-TRUST dialog ("Quick safety check:"). This is REQUIRED, not optional: the
 *     folder-trust dialog (the #2129/#2808 root, the case Josh sees "constantly") is NOT
 *     a PermissionRequest, so the hook never fires for it and there is NO by:'auto'
 *     self-report. The board detects it only by scraping the screen, and reconcileReport
 *     leads with that scrape (status.js ~5825: reported:false, no `by` -> stateReportedBy
 *     null). Keying on by:'auto' ALONE would therefore miss every on-box folder-trust
 *     dialog - the whole point of the feature. This scrape is a SAFE trigger: the trust
 *     dialog is a fixed, specific screen shape and is never a class-2 question, so it can
 *     only ever mean "restart to clear the trust dialog", which is exactly what the manual
 *     /trust-and-restart button does.
 * A live trust-dialog scrape is mapped to by:'auto' so the shared class-1 predicate + the
 * loop-guard in planClass1Handle treat it as the technical prompt it is. (Here `by` means
 * "this is a class-1 technical prompt", not raw self-report provenance - it is an internal
 * adapter value, never persisted.)
 *
 * NEVER class-1: a by:'agent' question (class 2, de-alarmed by #3092 and kept VISIBLE -
 * auto-clearing it would drop a real request), operator/legacy reports, and a non-trust
 * SCRAPED needs_you (a scraped question that is NOT the trust dialog - stays red).
 *
 * SAFETY LIMIT, stated honestly (this replaces an earlier overclaim that "a working scrape
 * wins"): reconcileReport does NOT decay a reported needs_you (rule 6), so a by:'auto'
 * report whose agent has since moved on - but has not yet written a fresher self-report -
 * still cards as needs_you/auto and would be handled. Two things bound it, neither of which
 * is "the scrape wins": (a) an agent's own next report (a working/idle heartbeat)
 * OVERWRITES a standing by:'auto' needs_you (#2456 makes it clearable), so a stale by:'auto'
 * self-clears once the agent acts; and (b) the loop-guard restarts at most maxAttempts per
 * window, then escalates. A trust-DIALOG scrape has no staleness problem - the screen shows
 * the dialog right now.
 */
function standingFromAgent(agent, isTrustDialogEvidence) {
  const rawBy = (agent && agent.stateReportedBy) || null;
  const trustDialogScrape = typeof isTrustDialogEvidence === 'function'
    && isTrustDialogEvidence(agent && agent.stateEvidence);
  // DEFENSE-IN-DEPTH: a trust-dialog scrape promotes to 'auto' ONLY when there is no
  // conflicting self-report provenance (rawBy null - the genuine screen-led case). A
  // self-reported by:'agent' (class 2, a real question) or by:'operator' is NEVER
  // overridden into an auto-restart by a scrape. Today reconcileReport emits `evidence`
  // XOR `by` (a card cannot carry both stateReportedBy:'agent' AND live trust evidence -
  // status.js:5837 vs :5844), so this cannot happen; but the class-2-never-restarted
  // guarantee for a production auto-restart must not rest on an invariant that lives in
  // another module and is not enforced here. If that invariant ever changed, this still
  // refuses to auto-restart a self-reported question.
  const by = (rawBy === 'auto' || (trustDialogScrape && !rawBy)) ? 'auto' : rawBy;
  return { found: true, state: agent && agent.state, by };
}

/*
 * Record one auto-handle attempt for an agent into the attempts Map (a Map<sessionName,
 * number[]> the caller carries across ticks, heartbeat-style), pruning entries older than
 * the window. Called after EVERY trust-and-restart attempt (whether the restart succeeded
 * or not), so the loop-guard advances toward escalate when a restart is not clearing the
 * prompt. Returns the same Map for chaining.
 */
function recordAttempt(attempts, name, now, opts) {
  const windowMs = (opts && Number.isFinite(opts.windowMs) && opts.windowMs > 0) ? opts.windowMs : DEFAULT_WINDOW_MS;
  const book = attempts instanceof Map ? attempts : new Map();
  if (!name) return book;
  // STORAGE prunes non-finite entries (Number.isFinite(t) && ...), which is deliberately
  // NOT planClass1Handle's rule (which COUNTS non-finite as recent, biasing to escalate).
  // The two differ because their jobs differ: storage must not persist a garbage timestamp,
  // while the DECISION errs toward escalate on any corrupt input. This module only ever
  // writes a finite `now` here, so the Map never actually holds a non-finite entry; the
  // divergence is harmless and intentional.
  const prior = (book.get(name) || []).filter((t) => Number.isFinite(t) && (now - t) < windowMs);
  prior.push(now);
  book.set(name, prior);
  return book;
}

/*
 * Drop entries whose (pruned) attempt list is empty, so an agent that left the roster does
 * not keep an entry forever. Called once per tick over the CURRENT set of names so the Map
 * cannot grow with the count of distinct names ever seen. now/opts give the same window.
 */
function pruneAttempts(attempts, now, opts) {
  const windowMs = (opts && Number.isFinite(opts.windowMs) && opts.windowMs > 0) ? opts.windowMs : DEFAULT_WINDOW_MS;
  const book = attempts instanceof Map ? attempts : new Map();
  for (const [name, ts] of book) {
    const kept = (Array.isArray(ts) ? ts : []).filter((t) => Number.isFinite(t) && (now - t) < windowMs);
    if (kept.length === 0) book.delete(name);
    else book.set(name, kept);
  }
  return book;
}

/*
 * One armed sweep tick over the reconciled roster. For each agent that is class-1
 * (standingFromAgent -> planClass1Handle), the trust-and-restart ones run runClass1Handle
 * (write folder-trust key + restart, via injected create.trustAgentFolder / remove.restart)
 * and every attempt is recorded so the loop-guard escalates rather than loops. `none` and
 * `escalate` take NO action - an escalate is left standing (red), Angel's #3092 safety net
 * and the divergence signal a person should see. Best-effort per agent; never throws out.
 * Dependency-injected so a test drives it with no real restart.
 *
 * 🔑 THE EXECUTOR IS KEYED ON sessionName, NOT the display name. A roster card's `name` is
 * the DISPLAY name (identity.displayName), but create.trustAgentFolder / remove.restart
 * resolve an agent by its SESSION key (remove.js matches p.sessionName). For the named fleet
 * (session `angel` -> display `Angel`, `claudebot` -> `Splinter`) passing the display name
 * would find no session (REFUSED, the handle silently never fires then escalates) or, worse,
 * collide with another agent's session key and restart the WRONG agent. So `sessionName` is
 * the key for the executor AND the loop-guard Map; the display `name` is for logging only.
 *
 * @param {object} o
 *   - roster: reconciled agent cards (safeRoster()); each needs `sessionName`, `state`,
 *     `stateReportedBy`, `stateEvidence` (and `name` for logs).
 *   - attempts: Map<sessionName, number[]> carried across ticks.
 *   - now, opts: forwarded to the planner / recordAttempt / pruneAttempts.
 *   - trustAgentFolder(sessionName), restart(sessionName, cause), RESTARTED: executor deps.
 *   - isTrustDialogEvidence(evidence): status.isTrustDialogEvidence, for the trust-dialog
 *     scrape trigger. Absent -> only the by:'auto' self-report path fires.
 *   - log(record): optional, called once per NON-none agent with {name, session, act, handled}.
 * @returns {{results: Array, attempts: Map}}
 */
function sweepOnce(o) {
  const opts = o && o.opts;
  const now = o && Number.isFinite(o.now) ? o.now : Date.now();
  const book = (o && o.attempts instanceof Map) ? o.attempts : new Map();
  const roster = (o && Array.isArray(o.roster)) ? o.roster : [];
  const isTrustDialogEvidence = o && o.isTrustDialogEvidence;
  const deps = { trustAgentFolder: o && o.trustAgentFolder, restart: o && o.restart, RESTARTED: o && o.RESTARTED };
  const log = (o && typeof o.log === 'function') ? o.log : null;
  const results = [];
  for (const agent of roster) {
    const session = agent && agent.sessionName;   // the KEY the executor + loop-guard use
    const display = (agent && agent.name) || session; // for logs only
    if (!session) continue;
    let plan;
    try { plan = planClass1Handle(standingFromAgent(agent, isTrustDialogEvidence), book.get(session) || [], now, opts); }
    catch (err) { results.push({ session, name: display, act: 'none', because: 'plan threw: ' + String((err && err.message) || err) }); continue; }
    if (plan.act !== 'trust-and-restart') {
      results.push({ session, name: display, act: plan.act, because: plan.because });
      // escalate is logged too: it is the "a person should look" divergence signal.
      if (plan.act === 'escalate' && log) { try { log({ name: display, session, act: 'escalate', handled: false, because: plan.because }); } catch { /* logging never breaks a sweep */ } }
      continue;
    }
    // Record the attempt regardless of the outcome: a restart that throws or refuses still
    // counts toward the loop-guard, so a persistently-stuck agent escalates instead of being
    // restarted every tick forever.
    recordAttempt(book, session, now, opts);
    let res;
    try { res = runClass1Handle(session, deps); }
    catch (err) { res = { handled: false, because: 'runClass1Handle threw: ' + String((err && err.message) || err) }; }
    results.push({ session, name: display, act: 'trust-and-restart', handled: !!res.handled, because: res.because });
    if (log) { try { log({ name: display, session, act: 'trust-and-restart', handled: !!res.handled, because: res.because }); } catch { /* logging never breaks a sweep */ } }
  }
  pruneAttempts(book, now, opts); // drop entries for agents that left the roster / aged out
  return { results, attempts: book };
}

module.exports = {
  isClass1,
  planClass1Handle,
  runClass1Handle,
  sweepClass1,
  standingFromAgent,
  recordAttempt,
  pruneAttempts,
  sweepOnce,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_WINDOW_MS,
};
