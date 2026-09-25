# ios-shell-718: the iOS shell behaves like an app on a phone

Card: kosmos #718, Josh's mobile priority (2026-09-24 22:02, via Splinter and Liu Kang; plan on
#718 comment 5825987811). Owner: Johnny Cage. Scope: `ios/` only. The sign-in and gate pages are
the separate kosmos-relay PR (signin-mobile-718).

## Finished means
- A page that cannot load shows a native page (offline, or Kosmos+ not answering, or the system's
  own reason) with Try again and "Back to Kosmos", never a blank WebView; after "offline" it
  reloads by itself when the phone reconnects, or at once if it is already back online.
- "Back to Kosmos" after a tap that failed before loading closes the failure page over the page
  still showing; after a loaded page failed, it goes back one page; with nothing loaded, the home.
- Pull to refresh reloads the page.
- A link that wants a new window (target=_blank: the Stripe billing button) is no longer silently
  dropped. Kosmos+ and the person's Macs load in the app over https. Any other site, however it is
  reached (a tap, a new window, a redirect, a script), opens in Safari (see Decisions: round 7
  replaced an earlier "redirects stay in the app" rule). Plain http never loads in the app. Mail,
  phone and text links open their apps from a tap; other schemes, including data: and blob:, are
  refused on purpose.
- A notification tap lands on the agent that asked: `https://<address>/?tab=detail&agent=<session>`
  (agreed with Kano, m544), the session accepted only as `^[a-z0-9][a-z0-9_-]{0,63}$`, else the
  board home.
- Navy (the sign-in page's background) until the first page paints, instead of a white flash.
- Safe areas: the WebView stays edge to edge (as on main) and keeps WebKit's default inset
  behaviour, as in Safari. Pages that opt in with `viewport-fit=cover` pad themselves with
  `env(safe-area-inset-*)` (kosmos-relay #114 does this for sign-in and the gate); the board does not
  opt in today, so WebKit keeps it clear of the notch. (An earlier version set the scroll view's
  inset adjustment to `.never`, which would have put the board's top under the status bar, since
  its env() values are 0 without cover. Scorpion caught it, m578.)
- Keyboard: dragging the page down dismisses it.
- The decisions are in Foundation-only code (`ShellLogic.swift`, `PushBridge.boardURL`) with
  tests that run on this Mac; each rule has a mutation that turns them red.

## Not done here, and why
- **Launch screen and app icon:** a navy launch screen needs either an asset-catalog colour or a
  launch storyboard. Both failed to compile on this box: `No available simulator runtimes` (actool)
  and `iOS 26.5 Platform Not Installed` (ibtool). Same blocker as the app icon in the README. They
  wait for Josh's `xcodebuild -downloadPlatform iOS`; the generated launch screen stays until then.
- **Resizing for the keyboard:** WebKit already moves a focused field into view the way Safari
  does. Also shrinking the SwiftUI view could adjust twice, and that cannot be checked without a
  simulator. Left as WebKit does it, to verify on the simulator (especially Scorpion's chat
  composer).

## Decisions
- **Try again retries the page that FAILED** (NSURLErrorFailingURLErrorKey), not the last page that
  loaded, so a tap to an offline Mac is not silently replaced by the board home. The retry count is
  passed to the WebView as a value, so SwiftUI always runs the update that acts on it.
- **Raised, not decided here:** if the Kosmos+ subscription is bought through Stripe inside the iOS
  app, App Store guideline 3.1.1 (digital goods must use in-app purchase) likely applies. Sent to Liu
  Kang for Josh. The shell keeps a checkout flow working either way.
- **No third-party page ever loads in the app** (challenge-loop round 7 replaced the earlier
  "redirects stay in the app" exception and its accepted phishing risk). Kosmos+ sign-in is email
  plus a code with no third-party identity provider, and the iOS app shows no purchase (Liu Kang's
  default, m556), so no flow needs another site in the app. If in-app purchase or an identity
  provider is ever added, revisit with an allow list.
- **"Back to Kosmos"** on the failure page (round 7): Try again alone could trap the person on a
  dead Mac; Back goes to the previous page or the board home.
- **Frames inside a page** may load https and about: only; every other scheme is refused
  (`Shell.allowsSubframe`, challenge-loop round 4). Before this PR there was no navigation delegate,
  so frames were unrestricted.
- **Load failures are logged** by error domain, code and host only (a Mac link carries the session
  in its URL fragment, so the URL itself is never logged).
- **Error page wording** (no em dashes): "You're offline" / "Kosmos+ isn't answering" / "This page
  didn't load", each with Try again. Colours are Mona's sign-in tokens (navy ground, gold icon,
  royal button).
- **Only the WebView's own background is navy** (not its scroll view), so the overscroll area is
  left to each page and a light board page does not get a navy band. Check on the simulator.
- **Connection lost counts as "Kosmos+ isn't answering"**, not offline: the phone usually stayed
  online, so an automatic "back online" reload would never come.
- **A new-window link never opens a second WebView:** in-app ones load in the one view, others go
  to Safari.

## Weakest part
Everything that touches UIKit or WebKit (the delegate wiring, the refresh control, the error
overlay, the order WebKit asks its two questions in for a target=_blank link) is compiled and
reasoned, not run. The simulator pass has to cover: an offline launch, a reconnect, Try again on a
tapped agent whose Mac is offline, pull to refresh (and where its spinner sits on a cover page), the board and the sign-in page clear of the notch and home bar in portrait and landscape,
a COMPLETE sign-in (email and code; nothing in it should leave the app), the billing
button opening in Safari, Back to Kosmos after a failed tap and after a failed loaded page, a mail link, and a tap with and without a session.
