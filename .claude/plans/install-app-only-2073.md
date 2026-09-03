# #2073: installer launches the native app instead of a browser (app-only)

**Branch:** `install-app-only-2073` · **Card:** kosmos#2073 · Routed by Splinter (Angel's usual
engine lane; Angel capped, so I took it and will reconcile on his return).

Josh's firm ruling: Kosmos is APP-ONLY, NO BROWSER. On a fresh install the installer dropped the
user into a browser board (127.0.0.1) that 403s and bypasses first-run setup; the native app does
first-run correctly.

## Root cause (confirmed by reading the installer + the Swift app)

Two browser-board surfaces:
1. `install/setup.sh`'s post-install open bootstraps a one-shot LaunchAgent (`com.kosmos.open-once`)
   that runs `/usr/bin/open "http://127.0.0.1:PORT/?boot=<nonce>"` — a browser tab.
2. `installing.html` (the pkg progress page) `location.replace()`s the browser onto the board when
   ready — a second browser dashboard.

The native app is self-sufficient and correct: `native-app/main.swift` (Swift/AppKit/**WebKit**)
resolves the port, starts the board if needed, loads it in its OWN WebKit window, and reads the
board token from its mode-600 file to append `?token=` ITSELF (`tokenizedBoardURL`), so the board
sets the enforcing httpOnly cookie and the app is authenticated on first paint. `make_app` already
stages Kosmos.app into `$APP_DIR`; setup.sh then opened the browser instead of launching it.

## The fix (3 focused changes)

- **`install/setup.sh`**: launch the staged `$APP_DIR/Kosmos.app` instead of opening the browser.
  This subsumes the whole #1946/#1979/#2033 browser-nonce dance — no `?boot=` mint, and the token
  never reaches argv (the app reads it in-process), so the cross-account `ps` exposure that dance
  guarded against cannot arise here at all. Messaging + the "Your dashboard: URL" summary reworded
  app-first (the URL demoted to an advanced note for `kosmos open`).
- **`server.js`**: seed the #2023/#2030 reauth marker on a `?token=` bootstrap too, not only
  `?boot=`. Both take the durable cookie in the same 302; the app authenticates via `?token=`, so
  without this the enforcing-update open-gate (open iff the marker is absent) would re-launch the
  app on **every** update. This is the subsumption edge I verified rather than assumed. The
  guarantee is "launches once then stops" **only when the app was not already running and the
  bundle is current** — see the two accepted edges below.
- **`install/setup.sh` open gate**: also guarded on `bundle_is_ours "$APP_DIR/Kosmos.app"` — only
  auto-launch OUR OWN app that exists. This fires for a fresh or already-current owned bundle,
  skips the `make_app`-failed case (no app — app-only removed the old browser fallback, so opening
  nothing beats naming an app that was not created), AND refuses a symlinked/foreign bundle (the
  aliased-`~/Applications` multi-account case where a bare `-d` would launch a stranger's app).
- **`install/pkg-scripts/installing.html`**: the ready branch no longer `location.replace()`s the
  browser onto the board; it says Kosmos is opening in its app and stops (hint reworded to match).

## Verification

- Full shipped gate (`bash tools/run-tests.sh`): JS 4136 tests, 0 fail, plus the shell gate,
  **SUITE EXIT=0**.
- Tests updated to the new behavior (they encoded the old browser-open): `server.board-nonce-1979`
  (`?token=` now seeds the marker), `install.installing-page` (success branch asserts NO redirect),
  `install.ends-on-action` (the app success line), `tools/test-install.sh` (opened.log holds
  Kosmos.app, not the URL; the install-page path launches the app, not the browser).
- Install harness (`tools/test-install.sh`, run against this setup.sh with the built bundle):
  **all 3 #2073 checks PASS** — fresh install launched the app (not a browser), install-page fresh
  install still opens (launches the app, does not skip), and it prints the app-open message. The
  harness reported 2 unrelated failures, both artifacts of a STALE symlinked dist bundle used to
  run the harness here: one self-diagnoses as "dist/ predates #910 (--kosmos-app-port-selftest);
  rebuild"; the other is the added-files check, which is bundle-content-determined and identical on
  origin/main (my diff touches only the open flow, adds no files). Neither is caused by this change.

## Accepted edges in the enforcing-update self-heal (documented, not fixed here)

Both narrow the "launches once then stops" property for the transitional enforcing-but-unseeded
update cohort; both are low impact (a window-to-front per update at worst, self-heals on the next
fresh relaunch), and both are honestly documented in-code at the gate header:

1. **App already running at update time.** `open Kosmos.app` on a running instance is an AppKit
   reopen (only re-shows the window); it does not re-navigate the WebView, so no `?token=`
   bootstrap, no marker seed → the gate re-fires (brings the app to front) each update. The real
   fix is a Swift change (re-navigate on reopen) — a native-app follow-up.
2. **#2028 stale bundle.** If an update did not refresh the bundle, the old app may lack
   `tokenizedBoardURL` and cannot seed the marker. That is #2028's bug; the not-refreshed note
   points the user at the remedy.

## Deferred / flagged (not this PR)

- The `installing.html` "taken" branch (another account's board already up) still offers an
  "Open it anyway" link to the browser board — a browser page fundamentally cannot `open` a native
  app, so the honest fix there is different messaging; an edge, flagged not fixed.
- Existing users with a pre-app-only browser bookmark: their bookmark still 403s after this update.
  Under app-only that is the intended end state (use the app), but it is a migration edge worth a
  note.

## Weakest premise (and how it is covered)

That `open "$APP_DIR/Kosmos.app"` from the installer behaves like a user double-click re: Gatekeeper
on a freshly-installed, Developer-ID-signed .app, and that the app's `?token=` cookie-seed works on
a real enforcing board. The harness stubs the `open` and the cookie flow, so those are the two
things it cannot prove. **Covered:** Josh is dogfooding a fresh macOS install and will test this PR
live on his clean machine (Splinter arranged the hand-off) — the real Gatekeeper + enforcing-cookie
path. This PR is not gated on that test; it lands and Josh verifies live.
