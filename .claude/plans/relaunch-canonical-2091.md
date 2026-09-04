# #2094: install update-loop — relaunch the fresh installed copy, not the stale bundle

## Live incident (Josh, 2026-09-03, via Splinter)
Josh trapped in an update loop: a window claims "This window is still running version 0.6.26. The rest of Kosmos is on 0.6.27" and re-shows after "Quit and Open Again"; Dock shows three Kosmos.app instances. He is actually on 0.6.27; reinstalling didn't help; new macOS account.

## Root cause (verified in code)
Native app (native-app/main.swift). Two versions compared:
- `mine` = Bundle.main CFBundleShortVersionString (main.swift:992/1081) = the LAUNCHED .app bundle's own version = 0.6.26.
- `theirs` = the board's /api/status "version" (main.swift:1107) = 0.6.27.
So the BOARD is fresh; the stale thing is the .app bundle the window runs from. `offerRelaunch` (main.swift:1214) reopened `Bundle.main.bundleURL` (this stale process's own path) with createsNewApplicationInstance=true → every relaunch reopened the same stale copy AND forced a new instance → version never advanced, Dock piled up.

## The fix
- `pickFresh(candidates, theirs)` — pure: return the first candidate whose version == theirs, else nil. Unit-tested in --kosmos-app-stale-selftest.
- `freshAppURL(theirs:)` — scans /Applications/Kosmos.app then ~/Applications/Kosmos.app, reads each Info.plist CFBundleShortVersionString, returns the one carrying `theirs`.
- `offerRelaunch`: `let target = freshAppURL(theirs:) ?? Bundle.main.bundleURL`; relaunch `target`; force a new instance ONLY when relaunching ourselves (fallback), else let macOS activate/launch the fresh copy once (stops pile-up).

Fallback-safe: when no copy is fresher (make_app failed everywhere), returns nil → Bundle.main → today's behaviour; showCannotSelfHeal still bounds the loop. NEVER worse than before.

## Verification
- swiftc compiles native-app/main.swift clean.
- --kosmos-app-stale-selftest: 39 checks, exit 0 (4 new fresh-relaunch rows: canonical chosen; none-fresh→nil fallback; unreadable skipped; first-match wins).
- native-app.stale-silences.test.js: source-wiring guard for the JS suite (5/5).
- Verify-by-content bar (Splinter): after the fix, mine == theirs AND one instance.

## Weakest premise / residual (documented on #2094, not gating)
If /Applications itself is stale because make_app could not write it on the new account (per-executable TCC App-Management denial, setup.sh:3019-3060), there is no fresh copy to reach and this fix cannot help — the real fix there is make_app robustness / surfacing the grant (separate card if the morning confirms). Also: whether the WKWebView LOADS the same board it polls is a Josh-machine morning check.
