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
 * ⚠️ ONE READ PER TICK, memoized. `snapshot` calls the capture ONCE PER PANE in a
 * loop, so a naive reader would run `agents --json` N times per board tick. A
 * short TTL memo collapses all per-pane calls within one tick to a single read
 * (the roster does its own separate read for the source seam; that is two reads
 * per tick total, still fewer than the Mac path's one-per-pane `capture-pane`).
 */
const win32sessions = require('./win32sessions');
const win32roster = require('./win32roster');

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

  // Cache one { at, ok, byName } per TTL window so a whole snapshot's per-pane
  // calls share a single read. `ok` records whether the live read SUCCEEDED, kept
  // distinct from "succeeded but this name has no live status" -- both return null
  // to the caller (UNKNOWN either way), but the flag keeps the two truthfully
  // separable for any future reason string.
  let cache = null;

  function byNameNow() {
    const t = now();
    if (cache && (t - cache.at) < ttlMs) return cache;
    const agents = run();
    const owned = record.read();
    const byName = new Map();
    let ok = false;
    if (Array.isArray(agents)) {
      ok = true;
      // sessionId -> live status, for the join below.
      const liveStatus = new Map();
      for (const a of agents) {
        if (a && typeof a === 'object' && typeof a.sessionId === 'string') {
          liveStatus.set(a.sessionId, a.status);
        }
      }
      // recorded-name -> live status, joined on the UUID. hasOwnProperty so a
      // record key like "toString" cannot pull a phantom off Object.prototype
      // (matching win32sessions.isOurs's discipline).
      for (const sid of Object.keys(owned)) {
        if (!Object.prototype.hasOwnProperty.call(owned, sid)) continue;
        const rec = owned[sid];
        if (rec && typeof rec.name === 'string' && liveStatus.has(sid)) {
          byName.set(rec.name, liveStatus.get(sid));
        }
      }
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
