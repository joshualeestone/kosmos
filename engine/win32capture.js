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
      const agents = run();
      if (Array.isArray(agents)) {
      ok = true;
      // Read the record only after the live read succeeded -- a persistently
      // failing `agents --json` should not cost a disk read every window, matching
      // win32roster.make, which reads the record only inside its Array.isArray arm.
      const owned = record.read();
      // sessionId -> live status AND -> live name, for the join below. The live
      // name is needed because the roster falls back to it when the recorded name
      // is empty (see the name resolution below), and the capture's key must match
      // the roster's emitted name exactly.
      const liveStatus = new Map();
      const liveName = new Map();
      for (const a of agents) {
        if (a && typeof a === 'object' && typeof a.sessionId === 'string') {
          liveStatus.set(a.sessionId, a.status);
          // Store a.name RAW (no typeof guard), exactly as win32roster reads it in
          // `flat(rec.name || a.name || '')`. flat() does the String() coercion, so
          // a truthy non-string live name resolves the SAME in both seams; a
          // typeof-'' guard here would make the capture skip a row the roster still
          // emits by that name -> a permanent UNKNOWN. This completes the byte-
          // identical parity for the a.name half of the fallback, not just rec.name.
          liveName.set(a.sessionId, a.name);
        }
      }
      // recorded-name -> live status, joined on the UUID. Re-validate the record
      // with the SAME gates win32roster re-applies at emit (validId on the key,
      // validName on the resolved name), so the capture's key set EQUALS the
      // roster's emitted-name set by construction -- the "one definition, two call
      // sites" discipline win32roster and win32sessions already hold for reading
      // this untrusted store. validId is also what rejects a reserved record key
      // (__proto__/constructor/prototype via RESERVED_ID); Object.keys yields only
      // own keys, so no hasOwnProperty guard is needed here (unlike win32roster,
      // whose loop key comes from the external agents array, not from Object.keys).
      // ⚠️ NAME UNIQUENESS is assumed among live recorded sessions: if two
      // sessionIds carry the same recorded name (a stale record never forget()-ed
      // before a same-named session is re-created), the later-iterated one wins
      // this key silently. The roster has the same ambiguity (it would emit two
      // rows both claiming the name), and neither is reachable until the win32
      // create/restart flow is wired into create.js (see win32create.js) -- a
      // guard belongs there, with that flow, not here.
      for (const sid of Object.keys(owned)) {
        if (!win32sessions.validId(sid)) continue;
        if (!liveStatus.has(sid)) continue;
        // BYTE-IDENTICAL to the roster's emitted session name: `owned[sid] || {}`
        // then flat(rec.name || <live name> || ''), then validName-gated. No
        // `typeof` guard on rec.name -- the roster does not have one, and flat()
        // coerces any non-string via String(), so a hand-corrupted truthy
        // non-string name resolves the SAME way in both seams. Falling back to the
        // LIVE name when the recorded name is empty is what the roster does, so a
        // row it addresses by the live name still resolves a status here.
        const rec = owned[sid] || {};
        const name = win32roster.flat(rec.name || liveName.get(sid) || '');
        if (!win32sessions.validName(name)) continue;
        byName.set(name, liveStatus.get(sid));
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
