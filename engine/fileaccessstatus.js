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
   Matches a11ystatus so the two grant seams age identically: the app refreshes
   on launch and on demand (the Allow-Access button, the first-run poll trigger),
   and a verdict older than this means the app is not currently maintaining it,
   so we fall back to "cannot check" rather than trust a possibly-days-old
   reading. */
const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * The native app's file-access verdict, if a fresh one is on file.
 * Returns one of:
 *   { checkable: true,  granted: true|false, at }   -- the app measured it
 *   { checkable: false, because }                   -- no native writer / stale / unreadable
 * Never throws: the caller is a route that must answer, not crash.
 */
function read() {
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
  if (Date.now() - ms > STALE_AFTER_MS) {
    return { checkable: false, because: 'the file-access reading is stale; the app is not currently maintaining it' };
  }
  return { checkable: true, granted: rec.granted === true, at: rec.at };
}

module.exports = { FILE, STALE_AFTER_MS, read };
