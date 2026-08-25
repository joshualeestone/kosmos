# Kosmos as a real native app, not a bookmark (#677)

Branch `native-app-677`. Josh (#admin, 24 Aug 16:20/16:24): "It's kind of weird to open an app and have it just launch a web browser... I do want to properly scope it out." Confirmed later: "a standalone .dmg, not a browser-based one." Scoping sent to and accepted by Splinter, 25 Aug 05:03.

## The decision

**Native Swift + WKWebView, not Electron, not Tauri.** Argued from the card's own words: a local-first product shipping a 150MB Chromium runtime is a statement. Everything a native build needs is already on this machine and needs no new provisioning: Xcode (`swiftc`, `xcodebuild`), the Developer ID Application cert already used for the `.pkg` (Stone Syndicate LLC, 864QZ69GF2), the same `kosmos-notarize` keychain profile, `hdiutil` for the eventual `.dmg`.

## What this reuses, unchanged

- The board itself: still Node, still `server.js`, still `127.0.0.1:16180` (or `$KOSMOS_PORT`).
- `kosmos start`'s existing health-check-and-start-if-needed logic (`install/kosmos`) -- the app shells out to it exactly as the current bash launcher does via `kosmos open`, it just points a native window at the URL afterward instead of handing the URL to `open` (the default-browser call).
- Signing/notarization pipeline, verbatim.
- Mona Lisa's quit-dialog spec (24 Aug 20:50), copy verbatim.

## What's genuinely new

- A compiled Swift/AppKit binary (`NSWindow` + `WKWebView`) replacing the current bash-script `Contents/MacOS/Kosmos`.
- One lifecycle decision point (Splinter's explicit design requirement): window-close, Cmd-Q, and Dock "Quit" all route through ONE place, so whichever way Josh answers "does closing the window quit" is a config change, not a rewrite. `applicationShouldTerminate` is that seam by AppKit's own design.
- **Provisional, not his ruling** (Splinter, pending Josh): closing the window does NOT quit -- the app stays running, the window hides (the Mail/Slack pattern). Agents keep working while the window is shut, which is the whole point of the product; a fat-fingered close can't kill your fleet. If Josh answers differently, this is `applicationShouldTerminateAfterLastWindowClosed`'s one return value plus `windowShouldClose`'s one branch -- not a rewrite.
- The quit dialog: Mona Lisa's spec says the second button ("stop every agent") cannot ship yet -- the engine has no fleet-stop, only a per-agent stop and a board-only `kosmos stop`. Ship with the FIRST button only ("Close the app"), so the sentence stays true. Add the second button when fleet-stop exists, not before.
- A runtime config mechanism for the compiled binary. The CURRENT bash launcher gets `$KOSMOS_HOME`/`$owner_uid`/`$PORT` baked in via heredoc string substitution at install time (`install/setup.sh` `build_app_bundle`) -- a compiled binary can't be re-baked that way without recompiling per install, and compiling on the user's Mac is explicitly ruled out elsewhere in this codebase (`install/kosmos`'s own comment: invoking a toolchain at install time risks an Xcode command-line-tools dialog, "exactly the kind of surprise this install must never produce"). So: the binary is pre-built once (the same shape as `kosmos-tunnel`, Baron's Rust connector, already pre-built and shipped rather than compiled locally), and reads its install-time values from a small companion file `build_app_bundle` writes into `Contents/Resources/` -- same baked-at-install-time contract, different mechanism.
- A `.dmg` builder (`hdiutil`), once there's a real app to put in it.

## Sequencing (agreed with Splinter)

1. **This phase**: a standalone prototype, NOT yet wired into the installer. Prove the AppKit lifecycle mechanics (window, WKWebView loading a live Kosmos board, stay-running-on-close, the quit dialog exactly as spec'd, the one-seam design) against a real running board, by hand, before touching `install/setup.sh` at all.
2. Once proven: design the runtime-config file, wire `build_app_bundle` to write it and to place the pre-built binary instead of generating the bash script, sign + notarize the binary the same way the `.pkg` already is.
3. `.dmg` packaging, once there's a real signed app to put in it -- Mona Lisa's cue to start the drag-window artwork. Tell her then, not before.

Windows stays explicitly out (#570 -- no machine to build or test on yet).

## Finished when (this phase) -- verified, not just planned

- ✅ A prototype `.app` (unsigned, run locally, not yet part of any install) opens a window, loads a real running Kosmos board's URL. Compiled binary is ~108KB (`swiftc main.swift -o kosmos-app-prototype`), not a 150MB shell -- the card's own stated concern, checked concretely. Verified against a real sandboxed board (`AGENT_WORKFORCE_DRY_RUN=1`, port 17501, not the operator's real board): `WKNavigationDelegate.didFinish` fired and `document.title` read back `"Kosmos"` -- the actual page loaded and rendered, not just an HTTP 200.
- ✅ Closing the window hides it (`windowShouldClose` -> `window.orderOut(nil)`), the app stays alive; re-activating the app re-shows it (`applicationShouldHandleReopen`). Verified by log + process-alive checks, both hits confirmed in order.
- ✅ Cmd-Q / Quit routes through one seam (`applicationShouldTerminate`) to the one-button quit dialog with Mona Lisa's exact copy; confirmed the app blocks correctly at the modal (matching `NSAlert.runModal()`'s well-documented synchronous behavior) rather than terminating early or crashing.
- ⚠️ **One verification gap, environmental, not a doubt about the code**: this session has no Accessibility or Screen Recording permission granted (macOS TCC), so a real click/keystroke on the close button or the dialog's button could not be simulated directly, and no screenshot could be taken to confirm the window's visual appearance. Worked around for the interaction paths that matter (window-close, reopen, reaching-the-quit-dialog) by adding temporary SIGUSR1/SIGUSR2 test hooks that call the EXACT SAME AppKit entry points a real click calls (`window.performClose(nil)`, `NSApp.terminate(nil)`) -- not a parallel path, the real one, triggered a different way. Confirmed via the app's own log output at each step. What remains unverified by direct interaction: the quit dialog's button actually completing (its logic -- `isActuallyQuitting = true; return true` -- is simple and was code-reviewed, not click-tested) and the window's visual layout/rendering (no screenshot possible). If Accessibility + Screen Recording can be granted to this session (or the human wants to click through it once themselves), that closes the gap; otherwise Phase 2's real installer integration is the next point a human is likely to actually run it.

## Finished when (phase 2) -- verified, not just planned

Phase 2 target: prove the board-resolution-and-starting logic, reusing `bin/kosmos start`'s existing health-check-and-start-if-needed rather than reimplementing it.

- ✅ `KosmosInstallConfig` (Codable: `kosmosHome`/`ownerUid`/`port`), loaded from `KOSMOS_APP_CONFIG` env override or `Contents/Resources/kosmos-install.json` -- this is the runtime-config shape phase 3 will have `build_app_bundle` write.
- ✅ `resolveInstall(config:)` -- checks `KOSMOS_HOME` env override first, then compares the running uid to the config's `ownerUid`; on a mismatch, falls back to that OTHER user's own install under their `NSHomeDirectory()`, and throws `.noOwnInstallForOtherUser` if none exists there either. Verified against a hand-built fixture at `/tmp/kosmos-fake-install` (copied `install/kosmos` as `bin/kosmos`, symlinked real node, a stub tmux, and `server.js`/`engine/`/`web/`/`test-support/`/`package.json`).
- ✅ `startBoard(kosmosHome:port:)` shells out to `$kosmosHome/bin/kosmos start` via `Process()` -- the actual pidfile/retry/port-conflict logic in `install/kosmos` runs unmodified, not reimplemented. Three end-to-end runs against the fixture, each via `open -a Kosmos.app -n --env ... --env KOSMOS_APP_LOG=...`:
  - First launch: resolve -> start -> board up -> WKWebView `didFinish` -> `document.title` read back `"Kosmos"`.
  - Second launch, board already running on the same port: same successful sequence, confirming the idempotent already-running path (no port-conflict error).
  - Third launch, `KOSMOS_HOME` pointed at a directory that does not exist: `startBoard` correctly surfaced `"Kosmos looks incomplete: .../bin/kosmos is missing."` and the app stayed alive on the alert rather than crashing.
- ✅ Sandboxing verified, not assumed: `install/kosmos`'s `cmd_start()` does not itself set `AGENT_WORKFORCE_DATA/WORKERS/PROJECTS/LAUNCH` -- it inherits the caller's environment (`engine/store.js`'s `ROOT` fallback would otherwise touch the real `~/Library/Application Support/AgentWorkforce`). All three runs launched the app with those four vars set to `/tmp/kosmos-fake-sandbox` paths, inherited down through the `Process()`-spawned `kosmos start` -> `node server.js`, and confirmed the sandbox paths (not the real ones) were what got written to.
- ✅ The temporary phase-1 SIGUSR1/SIGUSR2 test-signal hooks (`installTestSignalHooks`) are removed, as committed to at the end of phase 1 -- confirmed by recompiling after removal and re-running the fixture end-to-end once more (`document.title=Kosmos` still reads back correctly with the hooks gone).
- All test artifacts (`/tmp/kosmos-fake-install`, `/tmp/kosmos-fake-sandbox`, the compiled prototype binary, spawned `node`/app processes, LaunchServices registration) cleaned up after; `ps`/`lsof` confirmed empty at the end.

No new verification gap beyond the phase-1 TCC gap already noted above (still no Accessibility/Screen Recording -- these runs were confirmed via log output + `document.title` readback, not visually).

## Not in this phase

Installer integration, signing, notarization, the `.dmg`, the runtime-config file, anything Windows.
