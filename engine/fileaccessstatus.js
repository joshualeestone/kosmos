'use strict';
/**
 * "Does the process macOS holds responsible for agent file access have the
 * folder grants the setup flow's Screen 2 asks for?" -- read from a file the
 * NATIVE app writes. The read side of the S2 (Access) gated-Next seam.
 *
 * 🔑 WHY A FILE THE NATIVE APP WRITES, AND NOT AN ENGINE PROBE. File / folder
 * access on macOS is a TCC fact, and the same #1344 finding that put
 * Accessibility trust out of the engine's reach applies here: the engine cannot
 * DEFINITIVELY read whether the responsible process holds the Documents /
 * Desktop / Downloads grants the Screen 2 dialogs govern. A tempting shortcut is
 * an engine-side `readdir` probe of those folders -- but on a box whose terminal
 * already holds Full Disk Access (every dev machine here) the DENIED arm cannot
 * be observed, so the probe cannot be proven to distinguish granted from denied
 * (macOS can return a masked-empty listing rather than EPERM). A gate built on a
 * probe whose dangerous arm is unverifiable is exactly the failure the a11y seam
 * was designed around, so this mirrors it: the native app measures the grant and
 * writes the verdict; this module is the engine's read side. See a11ystatus.js,
 * whose shape this deliberately matches so the gate wiring is one pattern.
 *
 * 🛑 THREE ANSWERS, NEVER TWO (the liveness discipline). A caller must tell "the
 * native app says NOT granted" from "we cannot check at all" (no native app -- a
 * browser on localhost, or the file not written yet). Collapsing those would
 * either FALSE-BLOCK a browser tester (there is no file grant to give in a
 * browser) or let a UI claim a state nobody measured. `read` returns
 * checkable:false for "no native writer", distinct from checkable:true +
 * granted:false. The GATE consumes this: block only on a POSITIVE checkable:true
 * + granted:false; an uncheckable context does not gate (fail-safe).
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const FILE = path.join(store.ROOT, 'file-access-status.json');

/* How long the native app's verdict is believed before it is treated as stale.
   Shares a11ystatus's stale window (the same 5min): the app refreshes on launch
   and on demand (the Allow-Access button, the first-run poll trigger), and a
   verdict older than this means the app is not currently maintaining it, so we
   fall back to "cannot check" rather than trust a possibly-days-old reading.
   (The two seams no longer age IDENTICALLY: #3213 below lets file-access HOLD an
   aged verdict while the app is up, where a11ystatus still expires; only the
   window value matches.)

   🛑 #3213: the age alone cannot tell "the app is gone" from "the app is up but
   has not RE-PROBED" -- and it must not re-probe, because the file-access probe
   IS the macOS permission prompt (permflood-2125), so any periodic/automatic
   re-probe would burst prompts. The app therefore writes the verdict on-demand
   only, so an aged verdict under a LIVE app is stale-by-design, not
   stale-because-gone. `read` takes a `nativePresent` signal (proven live by the
   a11y writer's own freshness, prompt-free) to distinguish the two: see below. */
const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * The native app's file-access verdict, if a usable one is on file.
 * Returns one of:
 *   { checkable: true,  granted: true|false, at }   -- the app measured it
 *   { checkable: false, because }                   -- no native writer / stale / unreadable
 * Never throws: the caller is a route that must answer, not crash.
 *
 * `opts.nativePresent` (default false): when true, an EXISTING verdict that has
 * aged past STALE_AFTER_MS is HELD VALID rather than expired -- the app process is
 * up (so the reading is stale only because it does not periodically re-probe, by
 * permflood-2125 design), and holding the last-known verdict lets the S2 Access
 * pill keep showing "granted" without any new probe (#3213). This ONLY extends an
 * already-valid reading; a missing / unparseable / verdict-less / timeless reading
 * still returns checkable:false, so a fresh install before the first fire never
 * manufactures a "granted".
 *
 * 🛑 INVARIANT for callers passing nativePresent:true: holding an aged verdict means
 * a mid-session grant REVOCATION (the user turns folder access OFF while the app is
 * up) is NOT re-detected -- nothing re-probes (permflood-2125). So this route is safe
 * ONLY for ACQUIRE-oriented consumers (the S2 Access gate, the scan-on-grant edge),
 * which act on reaching "granted". A REVOCATION-monitoring consumer must NOT trust a
 * held verdict from here (#3213 caveat b; the acquire-only invariant is currently
 * verified only by the plan's consumer grep, not enforced in code).
 */
function read(opts) {
  const nativePresent = !!(opts && opts.nativePresent);
  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return { checkable: false, because: 'no native app has written a file-access reading (a browser, or not yet checked)' };
    return { checkable: false, because: 'we could not read the file-access reading' };
  }
  let rec;
  try { rec = JSON.parse(raw); } catch { return { checkable: false, because: 'the file-access reading is not readable' }; }
  if (!rec || typeof rec.granted !== 'boolean') {
    return { checkable: false, because: 'the file-access reading carries no verdict' };
  }
  const ms = Date.parse(rec.at || '');
  if (!Number.isFinite(ms)) return { checkable: false, because: 'the file-access reading carries no readable time' };
  if (Date.now() - ms > STALE_AFTER_MS && !nativePresent) {
    /* Aged AND no live app -> genuinely cannot be trusted (the writer is gone, not
       merely quiet). With nativePresent true we fall through and hold the existing
       verdict: stale-by-design under a live app, not stale-because-gone (#3213). */
    return { checkable: false, because: 'the file-access reading is stale; the app is not currently maintaining it' };
  }
  return { checkable: true, granted: rec.granted === true, at: rec.at };
}

module.exports = { FILE, STALE_AFTER_MS, read };
