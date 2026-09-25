# ios-shell-718: the iOS shell behaves like an app on a phone

Card: kosmos #718, Josh's mobile priority (2026-09-24 22:02, via Splinter and Liu Kang; plan on
#718 comment 5825987811). Owner: Johnny Cage. Scope: `ios/` only. The sign-in and gate pages are
the separate kosmos-relay PR (signin-mobile-718).

## Finished means
- A page that cannot load shows a native page (offline, or Kosmos+ not answering, or the system's
  own reason) with Try again, never a blank WebView; after "offline" it reloads by itself when the
  phone reconnects.
- Pull to refresh reloads the page.
- A link that wants a new window (target=_blank: the Stripe billing button) is no longer silently
  dropped. Kosmos+ and the person's Macs load in the app over https. Another site the person TAPS
  (or opens in a new window) goes to Safari; another https site reached by a redirect or script (a
  step in a sign-in or checkout flow) stays in the app, so the flow's session is not stranded in
  Safari (challenge-loop round 1). Plain http never loads in the app. Mail, phone and text links open
  their apps; other schemes, including data: and blob:, are refused on purpose.
- A notification tap lands on the agent that asked: `https://<address>/?tab=detail&agent=<session>`
  (agreed with Kano, m544), the session accepted only as `^[a-z0-9][a-z0-9_-]{0,63}$`, else the
  board home.
- Navy (the sign-in page's background) until the first page paints, instead of a white flash.
- Safe areas: the WebView stays edge to edge and the scroll view adds no inset of its own, because
  the pages pad with `env(safe-area-inset-*)` (the relay PR does this for sign-in and the gate).
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
- **Accepted risk, recorded:** a redirect or script step to another https site stays in the app
  (so sign-in and checkout flows keep their session). A compromised third-party script inside such
  a flow could therefore steer the WebView to an arbitrary https page in the app rather than Safari.
  Narrowing it to an allow list (Stripe and known identity hosts) is a follow-up if it matters; with
  Liu Kang's default (no purchase in the iOS app) the checkout part mostly goes away.
- **Load failures are logged** by error domain, code and host only (a Mac link carries the session
  in its URL fragment, so the URL itself is never logged).
- **Error page wording** (no em dashes): "You're offline" / "Kosmos+ isn't answering" / "This page
  didn't load", each with Try again. Colours are Mona's sign-in tokens (navy ground, gold icon,
  royal button).
- **Only the WebView's own background is navy.** Its overscroll area is left to each page, so a
  light board page does not get a navy edge.
- **A new-window link never opens a second WebView:** in-app ones load in the one view, others go
  to Safari.

## Weakest part
Everything that touches UIKit or WebKit (the delegate wiring, the refresh control, the error
overlay, the order WebKit asks its two questions in for a target=_blank link) is compiled and
reasoned, not run. The simulator pass has to cover: an offline launch, a reconnect, Try again on a
tapped agent whose Mac is offline, pull to refresh (and whether its spinner shows under the status
bar, since the scroll view has no top inset), a COMPLETE sign-in through every redirect, the billing
button, a mail link, and a tap with and without a session.
