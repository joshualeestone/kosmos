'use strict';
/**
 * "Does the process macOS holds responsible for agent app-control (tmux) have
 * Accessibility trust?" -- read from a file the NATIVE app writes. (#2125 slice 3)
 *
 * 🔑 WHY A FILE THE NATIVE APP WRITES, AND NOT AN ENGINE CHECK. Accessibility
 * trust is a TCC fact, reachable only from a native macOS call (AXIsProcessTrusted)
 * and NOT from this Node engine -- #1344 established exactly that ("nothing in this
 * product can read whether accessibility is granted: it is a TCC fact, reachable
 * from the native app and not from the engine"). Josh's #2125 ruling now REQUIRES a
 * real check to gate the first-run Continue button, so the native app supplies it:
 * the kosmos-app runs an AX check (attributed to tmux via macOS's responsible-
 * process model, the same attribution that makes tmux the folder-TCC owner) and
 * writes the verdict here. This module is the engine's read side of that seam.
 *
 * 🛑 THREE ANSWERS, NEVER TWO (the liveness discipline). A caller must be able to
 * tell "the native app says NOT trusted" from "we cannot check at all" (no native
 * app -- a browser on localhost, or the file not written yet). Collapsing those
 * would either FALSE-BLOCK a browser tester (there is no accessibility to grant in
 * a browser) or, worse, let a UI claim a state nobody measured. So `read` returns
 * checkable:false for "no native writer", distinct from checkable:true + trusted:
 * false. The GATE consumes this: block only on a POSITIVE checkable:true +
 * trusted:false; an uncheckable context does not gate (fail-safe -- see the route).
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const FILE = path.join(store.ROOT, 'a11y-status.json');

/* How long the native app's verdict is believed before it is treated as stale.
   The app refreshes it on launch and on demand (the Open-Accessibility button,
   and the first-run poll trigger); a verdict older than this means the app is not
   currently maintaining it, so we fall back to "cannot check" rather than trust a
   possibly-days-old reading. Generous: the cost of erring long is a slightly stale
   trusted/untrusted reading, and the app rewrites it well within this window
   whenever the first-run screen is open. */
const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * The native app's Accessibility verdict, if a fresh one is on file.
 * Returns one of:
 *   { checkable: true,  trusted: true|false, at }   -- the app measured it
 *   { checkable: false, because }                   -- no native writer / stale / unreadable
 * Never throws: the caller is a route that must answer, not crash.
 */
function read() {
  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return { checkable: false, because: 'no native app has written an accessibility reading (a browser, or not yet checked)' };
    return { checkable: false, because: 'we could not read the accessibility reading' };
  }
  let rec;
  try { rec = JSON.parse(raw); } catch { return { checkable: false, because: 'the accessibility reading is not readable' }; }
  if (!rec || typeof rec.trusted !== 'boolean') {
    return { checkable: false, because: 'the accessibility reading carries no verdict' };
  }
  const ms = Date.parse(rec.at || '');
  if (!Number.isFinite(ms)) return { checkable: false, because: 'the accessibility reading carries no readable time' };
  if (Date.now() - ms > STALE_AFTER_MS) {
    return { checkable: false, because: 'the accessibility reading is stale; the app is not currently maintaining it' };
  }
  return { checkable: true, trusted: rec.trusted === true, at: rec.at };
}

module.exports = { FILE, STALE_AFTER_MS, read };
