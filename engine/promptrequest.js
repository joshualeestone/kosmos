'use strict';
/**
 * The WRITE side of the on-demand permission-prompt seam (#1 / #2189). The install
 * flow's permission screens must fire the REAL macOS prompts when the person clicks a
 * grant button -- "Terminal would like to access your Documents", the Accessibility
 * prompt that puts tmux in the list -- not merely open System Settings (Josh's 0.6.39
 * #1: "clicking the grant button ... didn't actually ask for the correct permission").
 *
 * 🔑 WHY THE ENGINE ONLY SIGNALS, AND THE NATIVE APP FIRES. Firing these prompts must
 * be attributed to tmux -- the responsible process that owns the folder-TCC grant and
 * that the running agents use -- which means running the trigger UNDER the bundled
 * tmux. Only the native app can do that (it already does, at launch, via
 * spawnAxHatchUnderTmux). So this module does not fire anything: it drops a request
 * file in the shared store dir, and the native app's watcher notices it and fires the
 * matching hatch under tmux. Keeping the spawn in the app keeps the proven launch-path
 * attribution and adds no new assumption to the #2125 seam. This is the same
 * one-way-plus-a-nudge shape the a11y/file-access STATUS files already use, inverted:
 * there the app writes and the engine reads; here the engine writes a request and the
 * app acts.
 *
 * 🛑 THREE OUTCOMES, and the caller (web/index.html frFirePermission) needs the first
 * two kept apart. Fire-and-forget:
 *   { ok: true }            -- request recorded; the app WILL fire the prompt. The
 *                              gate poll takes it from there.
 *   { ok: false, because }  -- no native app to fire it (a browser on localhost, or
 *                              the app is not running), or the request could not be
 *                              recorded. The UI falls back to opening Settings, so a
 *                              grant button is never dead.
 * The caller fires the prompt ONLY on `res.ok && body.ok === true`; every other shape
 * (this module's {ok:false}, a network error, a missing route) falls back. So a browser
 * tester is never stranded on a trigger nothing can honour.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const a11ystatus = require('./a11ystatus');

/* The request filenames, keyed by prompt kind. The native watcher looks for exactly
   these names in store.ROOT; they are the cross-language contract, so they live in one
   place here and are mirrored by the Swift consumeRequest calls. */
const REQUEST_FILE = {
  a11y: 'a11y-prompt-request',
  'file-access': 'file-access-prompt-request',
  /* #2911/#3113: the tmux accessibility/automation prompt. Distinct from `a11y` (which fires
     AXIsProcessTrusted inside the app executable and so registers the KOSMOS APP -- the
     calling binary, #2451). This one asks the native watcher to run an osascript
     Terminal/System-Events automation op UNDER the bundled tmux, so macOS attributes the
     prompt to the RESPONSIBLE process (tmux) -- the binary agents actually run under, which
     is what gets prompted at runtime when engine/terminal.js drives Terminal.app. Firing it
     lets tmux acquire its own Accessibility TCC row (so the gate row can eventually flip to
     Activated). It is fired from the tmux gate row's Turn On on the S3 Automation step, not on
     step entry (an entry-time fire hung a Playwright networkidle wait, so #3113 makes the
     not-yet-listed state actionable in the render instead; see .claude/plans/fix-3113-tmux-a11y.md).
     (The exact osascript payload + which TCC service(s) fire is pinned by a fresh-install
     verify; the native hatch owns that string.) */
  'tmux-a11y': 'tmux-a11y-prompt-request',
};

/**
 * Is a native app present to consume a request? A request nobody consumes would leave
 * a grant button looking like it worked while no prompt ever appears, so we answer
 * this before recording one. The signal is the freshness of the native a11y reading:
 * the app rewrites it on launch and every 60s (a11ystatus.STALE_AFTER_MS is 5 min), so
 * `checkable:true` means the app is currently running and maintaining it. This reuses
 * the exact presence signal the gates already trust, rather than inventing another.
 *
 * The coupling has one fail-safe edge worth naming: if the app is up but its a11y
 * writer chain silently fails (e.g. the bundled tmux is missing, so `spawnAxHatchUnderTmux`
 * skips), `a11y-status.json` goes stale, this reads false, and BOTH prompt requests fall
 * back to opening Settings. That is fail-safe, not fail-dead -- the button opens Settings
 * rather than doing nothing -- so it is the acceptable direction to err.
 */
function nativePresent() {
  try { return a11ystatus.read().checkable === true; } catch { return false; }
}

/**
 * Ask the native app to fire the `kind` prompt on demand. Never throws: the caller is
 * a route that must answer.
 */
function request(kind) {
  const name = REQUEST_FILE[kind];
  if (!name) return { ok: false, because: 'unknown prompt kind: ' + kind };
  if (!nativePresent()) {
    return {
      ok: false,
      because: 'no native app is present to fire the prompt (a browser, or the app is not running)',
    };
  }
  // store.ROOT is read at CALL time, not frozen at require, so a test that points the
  // store elsewhere is honoured (the ~26 freeze-at-require modules are the hazard this
  // avoids).
  const file = path.join(store.ROOT, name);
  try {
    fs.mkdirSync(store.ROOT, { recursive: true });
    // Presence is the whole signal; the timestamp is only so an operator can see how
    // long an un-consumed request has sat (native deletes it the instant it fires).
    fs.writeFileSync(file, new Date().toISOString() + '\n');
    return { ok: true };
  } catch (e) {
    return { ok: false, because: 'could not record the prompt request (' + String((e && e.message) || e) + ')' };
  }
}

module.exports = { request, nativePresent, REQUEST_FILE };
