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
     Activated). #3221: it is fired UP FRONT when the S3 Automation step is ENTERED (client
     frFireTmuxA11yRegister), so tmux is listed by the time the person reaches its Turn On, which
     now only deep-links to the Accessibility pane. (#3113 had fired it from Turn On instead,
     having rejected an entry-time fire over a Playwright networkidle hang; that was re-measured
     for #3221 and does not reproduce -- see .claude/plans/ick-3221-tmux-a11y.md.)
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

/*
 * #3188 scoped diagnostic (launchd-ambient-env meta-sweep #3189). When a caller passes
 * `opts.diag`, request() also returns a `diag` object naming the engine-observable rungs
 * of the file-access -> tmux prompt chain, so a server-log-only line can localize WHICH
 * rung fails on the RUNNING board -- the defect is not visible in source (Angel proved the
 * resolvers are already correct: resolveBundledTmux has the right fallback, and store.ROOT
 * drop vs the native storeFileURL watch resolve identically and are pinned by a
 * cross-language test), so this mirrors #3136's approach: instrument the board, localize,
 * fix, strip.
 *
 * INERT for every existing caller: with no `opts.diag`, the return is byte-identical to
 * before ({ok:true} / {ok:false, because}), which promptrequest.test.js pins via
 * assert.deepEqual. Only the file-access route passes it, and it strips `diag` off the
 * wire so no store path reaches the browser.
 */
function withDiag(ret, opts, diag) {
  if (opts && opts.diag) return Object.assign({}, ret, { diag });
  return ret;
}

/**
 * Ask the native app to fire the `kind` prompt on demand. Never throws: the caller is
 * a route that must answer.
 *
 * @param {string} kind  one of REQUEST_FILE's keys.
 * @param {{diag?:boolean}} [opts]  when diag is set, include a `diag` object (see withDiag).
 */
function request(kind, opts) {
  const name = REQUEST_FILE[kind];
  if (!name) return withDiag({ ok: false, because: 'unknown prompt kind: ' + kind }, opts, { name: null, root: null, file: null, nativePresent: null, wrote: false });
  // nativePresent() FIRST, and read store.ROOT only on the native-present (drop) path -- the
  // exact ordering this function had before the #3188 diagnostic. store.ROOT is a getter that
  // triggers maybeMigrateLegacyStore(), a documented side-effect (store.js warns any
  // un-sandboxed store.root() migrates the real operator store), so the diagnostic must NOT
  // widen the set of paths that touch it: the native-absent / browser-only path returns
  // without reading it, exactly as before (#3188 review, iter 2). Its diag reports root/file
  // null there, which is honest -- no drop was attempted.
  const np = nativePresent();
  if (!np) {
    return withDiag({
      ok: false,
      because: 'no native app is present to fire the prompt (a browser, or the app is not running)',
    }, opts, { name, root: null, file: null, nativePresent: false, wrote: false });
  }
  // store.ROOT is read at CALL time, not frozen at require, so a test that points the store
  // elsewhere is honoured (the ~26 freeze-at-require modules are the hazard this avoids). Read
  // once so the drop path and the diag report the same root.
  const root = store.ROOT;
  const file = path.join(root, name);
  try {
    fs.mkdirSync(root, { recursive: true });
    // Presence is the whole signal; the timestamp is only so an operator can see how
    // long an un-consumed request has sat (native deletes it the instant it fires).
    fs.writeFileSync(file, new Date().toISOString() + '\n');
    return withDiag({ ok: true }, opts, { name, root, file, nativePresent: true, wrote: true });
  } catch (e) {
    return withDiag({ ok: false, because: 'could not record the prompt request (' + String((e && e.message) || e) + ')' }, opts, { name, root, file, nativePresent: true, wrote: false });
  }
}

/*
 * #3188 diagnostic: is a `kind` request file still present in store.ROOT? The native
 * watcher DELETES the file the instant it consumes it (polls every 1.5s, native-app
 * checkPromptRequests), so `present:false` after a bounded post-drop window means it was
 * consumed; `present:true` means the drop landed somewhere the watcher is not looking
 * (the store-dir divergence rung) or the app is not running. Pure and never throws, like
 * the rest of this module -- it is a read used only by the scoped file-access diagnostic.
 */
function wasConsumed(kind) {
  const name = REQUEST_FILE[kind];
  if (!name) return { name: null, present: false };
  try { return { name, present: fs.existsSync(path.join(store.ROOT, name)) }; }
  catch { return { name, present: false }; }
}

/*
 * #3188: format the scoped file-access diagnostic line from a request() result that
 * carries `diag`. The log CONTENT is the diagnostic's entire deliverable -- it is read
 * off the running board to localize the failing rung -- so it is extracted here and
 * unit-tested rather than only source-string-pinned inside the route (where a typo would
 * pass every test and silently emit garbage the board read then wastes). Returns null when
 * there is no diag, so the caller logs nothing.
 */
function formatDiagLine(r) {
  const d = r && r.diag;
  if (!d) return null;
  return `DIAG_DEBUG file-access-prompt #3188 diag: ok=${r.ok} nativePresent=${d.nativePresent} wrote=${d.wrote} root=${d.root} file=${d.file}${r.because ? ' because=' + r.because : ''}`;
}

/*
 * #3188: format the bounded post-drop consume-probe line from a wasConsumed() result and
 * the probe window (ms). consumed = NOT present -- the native watcher deletes the request
 * the instant it fires, so a file still present after the window is the drop-dir-divergence
 * / app-not-running rung. Extracted and tested for the same reason as formatDiagLine.
 */
function formatConsumeLine(consumeResult, windowMs) {
  const present = !!(consumeResult && consumeResult.present);
  return `DIAG_DEBUG file-access-prompt #3188 diag: consumedWithin${windowMs}ms=${!present}`;
}

module.exports = { request, nativePresent, wasConsumed, formatDiagLine, formatConsumeLine, REQUEST_FILE };
