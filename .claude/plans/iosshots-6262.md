# iosshots-6262: App Store screenshots from the real iPhone app (#6262 step 8)

Splinter, 2026-10-17 22:23: the listing needs screenshots of the REAL app; refresh ios/store/ screenshots from the
simulator on the current code, check them against Apple's current required sizes, update the listing draft.
Nothing is submitted; Josh submits.

## Done means
ios/store/screenshots holds sets taken from the Kosmos iPhone app running in the iOS simulator, at every size App
Store Connect requires today (with Apple's page as the source, read the same day), passing check-listing.sh, which
can fail on a set at the wrong size; the README and listing draft say what is true on 2026-10-17.

## Found on the way (both measured)
1. **The old sets were not the required size.** Apple's "Screenshot specifications" page (read twice 2026-10-17,
   quoting it verbatim): "At least one screenshot for iPhone with Dynamic Island (medium display)", 1206x2622 or
   1179x2556. Ours were only 1320x2868 (large display). The README said an iPhone-only app needs only that size.
2. **The old sets showed a layout the app never shows.** shoot.sh opened the board at its loopback address, so it
   drew the at-the-computer layout; the app opens the computer through Kosmos+, which gives the phone layout
   (html.kremote: the Kosmos+ bar, agents as a list). Seen side by side in the simulator.
3. No iOS simulator runtime was installed (Xcode 27.0's first launch; the 26.5 one was no longer listed).
   Installed iOS 27.0 with `xcodebuild -downloadPlatform iOS` (Apple's own component, removable with
   `simctl runtime delete`; no admin prompt).

## The change
- `ios/Kosmos/ContentView.swift`, `AppDelegate.swift`: under `#if KOSMOS_STORE_SHOTS` only, the app opens
  `KOSMOS_SHOTS_URL` instead of Kosmos+ (main frame and subframes of that one origin allowed) and does not ask for
  notification permission. Nothing changes in any other build.
- `ios/store/shots-proxy.js`: gives the app a non-loopback address for the throwaway board (so the phone layout),
  says the Claude subscription is connected in /api/status (as mobile-shots.js does in the page for the store
  set), and is the leak guard for this path (lib-leak-guard.js on every non-HTML answer; a hit is refused and the
  run files nothing).
- The proxy's leak guard fired on the first full run: every agent's instructions name the `kosmos` command by
  this checkout's path (`<checkout>/install/kosmos`), which holds the Mac's user name. Not on any of the four
  screens, but refused, so nothing was filed. Now the proxy swaps that path for the installed path of a made-up
  user before the check (`/Users/you/.local/share/kosmos/bin/kosmos`; the real install is ~/.local/share/kosmos,
  read from the board's launchd job). Measured both arms on a live throwaway board: the right checkout path
  passes all four agents with zero hits, a wrong one is refused with LEAK on all four.
- `ios/store/shoot-app.sh`: build with the flag, board via `mobile-shots.js --keep --data store` (its own leak guard
  reads the same four screens first), proxy on this Mac's network address, iPhone 17 (6.3, required) and iPhone 17
  Pro Max (6.9) simulators, light and dark, status bar 9:41, alpha dropped, filed as screenshots/<size>-<theme>/.
- `ios/tools/check-no-shots-flag.sh` + an iOS CI step: the Release app and the archive's app must not carry the
  switch; a fake executable carrying it must fail (control). Measured locally: FAIL on the shots build, PASS on a
  plain Release build.
- `ios/store/check-listing.sh`: per-set sizes from Apple's table; at least one 6.3 set required. Measured: FAIL on
  the old light/ dark/ sets ("no 6.3-inch set").
- `shoot.sh` no longer files into the store set (it would now fail the check); README, listing.md (name decided,
  pushes live), ios/README.md, mobile-shots.js's pointer.

## Decided
- **Run through the queue (queued-heavy.sh), and trust only the run's OWN claim.** Inside a queued turn, heavy-gate
  sees the queue's claim and reads BUSY, so the first queued run refused itself (measured, 23:55). The queue unsets
  KOSMOS_SIDE_AWARE before the command, so that variable cannot tell (measured, 00:02). The script now asks
  kosmos_holds_machine_claim (the claim's cookie against the one the queue exports); measured three arms: no cookie
  and a made-up cookie both fall back to the gate, and the real queued turn went straight to the build.
- **Swap the checkout path, do not exempt it.** Exempting it from the guard would let it reach a picture if a
  screen ever showed it; swapping means no picture can carry it, and every other hit still stops the run.
- **The page-guard pass runs with --remote**, so mobile-shots.js reads the same phone layout the app shows.
- **A compile-time switch, not a runtime one.** A launch argument read in every build would let anything that can
  launch the app point it at any address. Compiled out, the store build cannot, and CI proves it.
- **Both sizes, not only the required one.** The 6.9 set costs one more simulator and looks right on the biggest
  phones; Apple scales the required set otherwise.
- **The board's own deep links for each screen** (?tab=detail&agent=, ?tab=projects&project=), the same addresses a
  tapped notification opens, rather than driving taps: simctl has no tap, and these are what a person lands on.
- **Rejected: a real Kosmos+ sign-in and tunnel to a demo board.** Truest path, zero app change, but it needs a
  demo account (README item 5, Josh's) and its email could reach the Kosmos+ menu. Revisit when that account exists.

## Weakest premise
That the simulator's WKWebView matches a device closely enough for a store picture. It is the same app binary
(for the simulator), the same WebKit version family and the real status bar and safe areas; fonts and rendering
can still differ slightly from a phone. Apple's own guidance accepts simulator screenshots.

## Tests
shoot-app.sh VERDICT, check-listing.sh VERDICT, both arms of check-no-shots-flag.sh, both arms of the proxy leak
guard (lib-leak-guard on the board's real /api/status: no hit; on a string with this Mac's home path: 2 hits).
Every picture read by eye.
