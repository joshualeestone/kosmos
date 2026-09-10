'use strict';
/**
 * The win32 live-STATE source (#570): the Windows analog of `capture-pane`, feeding
 * `status.setPaneCapture`.
 *
 * On a Mac, `status.snapshot` reads each agent's live state by SCRAPING its tmux
 * pane text (`capture-pane` -> `classify`). Windows has no pane. `claude agents
 * --json` reports a per-session `status` for interactive sessions, observed to be
 * `busy` (working) or `idle` (waiting) -- so THAT is the win32 scrape-equivalent.
 *
 * 🔑 BUT A STREAMING SESSION LISTS NO STATUS (measured 2026-09-10), and every agent
 * Kosmos starts has been one since 7c-2. For those the token comes from
 * `engine/win32streamstate`: the supervisor reads the agent's own event stream and
 * keeps its working/idle in a file, which is accepted here only when its session
 * id and pid match the live row. Same two tokens either way, so classify's win32
 * arm reads both without knowing which it got.
 *
 * 🔑 THIS IS THE FALLBACK, NOT THE PRIMARY STATE READER. The primary win32 state
 * reader is the SELF-REPORT path (`engine/selfreport` + `status.reconcileReport`),
 * exactly as on the Mac: a fresh self-report outranks the scrape, and the states
 * that scraping CANNOT see -- `needs_you`, `blocked` -- come only from what an
 * agent SAYS, never from `agents --json` (measured: a waiting session reads
 * `idle`, indistinguishable from idle; see kosmos#570). This module supplies only
 * the coarse working/idle the live list CAN see, for an agent that is not
 * currently self-reporting -- the same role Mac's pane scrape plays under
 * reconcileReport. It deliberately does not attempt needs_you.
 *
 * 🛑 THE STATUS MUST BE JOINED THROUGH THE sessionId, NOT read by name. The roster
 * (win32roster) emits Kosmos's RECORDED name (what create filed the session
 * under); `claude agents --json` reports the session's LIVE name (Claude derives
 * it from the cwd, e.g. `pigeonpete-50`), which is a DIFFERENT string. The only
 * stable link between "the row on the board" and "the live status" is the session
 * UUID: recorded-name -> (win32sessions record) -> sessionId -> (agents --json) ->
 * status. Reading status by name would silently miss every agent whose live name
 * differs from its recorded name, which is all of them.
 *
 * ⚠️ A FAILED READ IS null, NEVER a state. If `agents --json` cannot be read, or
 * the session is not found, the capture returns null, which `classify` renders as
 * "we could not read its state" (UNKNOWN) -- never a confident working/idle off a
 * look that did not happen. Same refuse-honestly discipline as a failed
 * `capture-pane`.
 *
 * ⚠️ COLLAPSES A TICK'S PER-PANE CALLS, via a short TTL memo (not a strict
 * per-tick cache). `snapshot` calls the capture ONCE PER PANE in a loop, so a
 * naive reader would run `agents --json` N times per board tick; the TTL window
 * (default 1500ms) serves all of a tick's per-pane calls from one read. Because it
 * is a time window and NOT tied to the tick boundary, two consequences are
 * accepted as honest and self-healing: (1) the roster does its own separate,
 * un-memoized read for the source seam, so within one tick the capture's status
 * can be up to ttlMs staler than the roster's fresh row -- a just-appeared session
 * briefly reads UNKNOWN, a busy->idle transition can lag one tick; (2) that is two
 * reads per tick total, still far fewer than the Mac path's one `capture-pane` per
 * pane. Every stale outcome is a safe direction (UNKNOWN or a one-tick-late state,
 * never a wrong-session leak) and clears on the next window.
 */
const win32sessions = require('./win32sessions');
const win32roster = require('./win32roster');
const win32live = require('./win32live');
const win32streamstate = require('./win32streamstate');

/**
 * Build the win32 capture function for `status.setPaneCapture`.
 *
 * @param {object} [opts]
 * @param {() => (Array|null)} [opts.run] the `claude agents --json` reader
 *   (default the SAME `win32roster.defaultRun` the source seam uses -- one
 *   definition of the read); returns the parsed array or null on failure.
 * @param {{ read: () => object }} [opts.record] the ownership record (default the
 *   real win32sessions), injectable for tests.
 * @param {() => number} [opts.now] clock (default Date.now), injectable so the
 *   memo TTL is testable without real time.
 * @param {number} [opts.ttlMs] memo window in ms (default 1500).
 * @returns {(target: string, lines?: number) => (string|null)} a paneCapture: the
 *   session's live status token, or null on a failed/absent look. The `lines`
 *   argument is accepted (the seam passes it) and ignored -- there is no scrollback.
 */
function make(opts) {
  const run = opts && typeof opts.run === 'function' ? opts.run : win32roster.defaultRun;
  const record = opts && opts.record ? opts.record : win32sessions;
  const now = opts && typeof opts.now === 'function' ? opts.now : Date.now;
  const ttlMs = opts && Number.isFinite(opts.ttlMs) ? opts.ttlMs : 1500;
  const streamState = opts && typeof opts.streamState === 'function' ? opts.streamState : win32streamstate.stateFor;
  /* Under the same never-throw contract as run() and record.read(). */
  const readStreamState = (name, hit) => { try { return streamState(name, hit); } catch { return null; } };

  // Cache one { at, ok, byName } per TTL window so a whole snapshot's per-pane
  // calls share a single read. `ok` records whether the live read SUCCEEDED, kept
  // distinct from "succeeded but this name has no live status" -- both return null
  // to the caller (UNKNOWN either way), but the flag keeps the two truthfully
  // separable for any future reason string.
  let cache = null;

  function byNameNow() {
    // now() is an injected callable too, so it is under the same never-throw
    // contract as run()/record.read(): a throwing clock returns a transient failed
    // read (NOT cached) -> null -> UNKNOWN, rather than propagating out of
    // capturePane -> snapshot and blanking the whole tick. Date.now never throws,
    // so this only defends an injected clock, for full parity with the contract.
    let t;
    try { t = now(); } catch { return { at: 0, ok: false, byName: new Map() }; }
    if (cache && (t - cache.at) < ttlMs) return cache;
    const byName = new Map();
    let ok = false;
    // NEVER THROW. A paneCapture must return null on a failed read, exactly as a
    // failed Mac `capture-pane` does -- if this propagated an exception out through
    // `status.capturePane` -> `snapshot`, one throwing read would blank the WHOLE
    // board's tick, not just one pane. Production's run/record (win32roster.defaultRun,
    // win32sessions.read) both swallow their own errors to null/{}, so this cannot
    // throw there; the guard defends the INJECTED-callable seam boundary (a test or
    // future caller whose run()/record.read() throws), degrading it to a failed read
    // (ok:false -> null -> UNKNOWN) rather than taking down the tick. byName is
    // rebuilt fresh each call and cleared on throw, so a partial join never leaks.
    try {
      /* ONE JOIN, shared with the roster and the stop (engine/win32live). This
         used to be a hand-maintained copy of win32roster's resolution, carrying a
         comment that promised it stayed BYTE-IDENTICAL to it -- the ownership
         gates, the name fallback, and the reason each was re-checked, all written
         out twice. The promise is structural now, and the capture keeps only the
         part that is actually its own: the TTL memo, and reading `status` off the
         resolved entry. */
      const live = win32live.byName({ run, record });
      // null is a FAILED look; an empty map is a successful look at a machine with
      // no owned sessions running. `ok` is what keeps those apart downstream.
      if (live) {
        ok = true;
        for (const [name, hit] of live) {
          /* 🔑 TWO SOURCES, ONE TOKEN (7c-5). An interactive session reports its own
             status. A STREAMING one -- every agent Kosmos has started since 7c-2 --
             lists none, so its state comes from the file its supervisor keeps from
             the agent's event stream, accepted only for this exact session and pid. */
          byName.set(name, typeof hit.status === 'string' && hit.status ? hit.status : readStreamState(name, hit));
        }
      }
    } catch {
      // An injected run()/record.read() threw. Treat it as a failed read: no state
      // is a safe answer (null -> UNKNOWN), a thrown one is not.
      ok = false;
      byName.clear();
    }
    cache = { at: t, ok, byName };
    return cache;
  }

  return function win32Capture(target) {
    const snap = byNameNow();
    // A failed live read refuses honestly: null -> classify renders UNKNOWN
    // ("could not read its state"), never a confident idle off a look that
    // never happened.
    if (!snap.ok) return null;
    // target is `${session}:${window}.${pane}` (win32roster emits pane "0.0");
    // strip the trailing `:<pane>` to recover the session name. A Kosmos agent
    // name is a slug with no colon, and tmux-style session names forbid `:`, so
    // the LAST colon is always the target separator.
    const session = typeof target === 'string' ? target.replace(/:[^:]*$/, '') : '';
    const status = snap.byName.get(session);
    // Present-and-a-string only; anything else (absent, undefined-status
    // background row) is "we have no state for it" -> null -> UNKNOWN.
    return typeof status === 'string' && status ? status : null;
  };
}

module.exports = { make };
