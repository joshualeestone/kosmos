'use strict';
/**
 * The native app's Accessibility trust reading -- read from a file the NATIVE app
 * writes. (#2125 slice 3)
 *
 * 🛑 IT WAS BUILT TO ANSWER "does the process macOS holds responsible for agent
 * app-control (tmux) have Accessibility trust?" -- BUT IT DOES NOT (corrected
 * 2026-09-06, #2125). Accessibility is keyed on the CALLING BINARY (the kosmos-app),
 * not the responsible process, so the verdict is the APP's trust, not tmux's. The
 * subject is the app, not tmux. Left unresolved pending the #2125 keep/drop fork.
 *
 * 🔑 WHY A FILE THE NATIVE APP WRITES, AND NOT AN ENGINE CHECK. Accessibility
 * trust is a TCC fact, reachable only from a native macOS call (AXIsProcessTrusted)
 * and NOT from this Node engine -- #1344 established exactly that ("nothing in this
 * product can read whether accessibility is granted: it is a TCC fact, reachable
 * from the native app and not from the engine"). Josh's #2125 ruling now REQUIRES a
 * real check to gate the first-run Continue button, so the native app supplies it:
 * the kosmos-app runs an AX check (AXIsProcessTrusted) under tmux and writes the
 * verdict here. This module is the engine's read side of that seam.
 *
 * ⚠️ ATTRIBUTION, VERIFIED WRONG (2026-09-06, #2125). The seam was BUILT on the
 * belief that an under-tmux re-exec makes macOS attribute the AX read to tmux (the
 * same responsible-process model that makes tmux the folder-TCC owner). It does
 * NOT. Accessibility is keyed on the CALLING BINARY, so the reading reports the
 * kosmos-app's own trust, not tmux's. Josh's 0.6.42 fresh-account re-test proved it:
 * the tmux gate read ACTIVATED on arrival while tmux was ungranted and absent from
 * the Accessibility list, because AXIsProcessTrusted returned the app's state. So a
 * `trusted:true` here does NOT mean tmux is granted. Do not re-assume the tmux
 * attribution when touching this. The fix is the pending #2125 fork: KEEP -> route
 * the AX check AND the grant through one identity so this answers a real subject;
 * DROP -> remove the accessibility ask entirely (a repo sweep finds no synthetic-
 * input API in use; agents run on tmux send-keys IPC, so it is unproven anything
 * needs the grant). Root writeup:
 * ~/work/Josh-Brain/Projects/kosmos-tcc-identity-root-2378-1-3-2026-09-06.md
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
