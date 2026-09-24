# ios-tap-718: tapping a push opens that Mac's board

Card: #718 (iOS slice). Follows ios-push-718 (#3635, merged). Ordered by Liu Kang (m459): the tap is
part of push's definition of done, before the go-live runbook.

## Finished means
1. Tapping a notification opens `https://<address>/` in the app's WebView, where `address` is the
   top-level field of the coordinator's APNs payload (kosmos-relay `coordinator/src/apns.rs`
   `payload()`, value `<mac name>.<KOSMOS_DOMAIN>`; production `kosmosplus.com`).
2. Only a single RFC 1123 label directly under the relay domain is accepted. Refused, each with a
   test: userinfo, port, path, scheme, lookalike suffixes (`evil-kosmosplus.com`,
   `kosmosplus.com.evil.com`, `evilkosmosplus.com`), Unicode and punycode (`xn--`) labels, deeper
   subdomains, the bare domain, empty or null or non-string values, trailing dot. A control proves
   the real host passes. No other payload field is used for navigation (tested).
3. A tap on a cold launch, or while the biometric lock shows, still lands on the board once the
   WebView exists.
4. Builds green; logic tests pass with mutations red.

**Status of 1 and 3: built, NOT run.** The address gate is tested; the WebView wiring that acts on it
has only been compiled and reasoned through (no simulator runtime on this box). They stay unproven
until the simulator run, and the PR says so.

## Decisions
- **The target waits in `PushNotificationManager.boardToOpen` (@Published)** and the WebView loads and
  clears it. Rejected: loading from the notification delegate directly, which has no WebView on a
  cold launch or behind the lock.
- **Each tap is its own request (`BoardRequest`, with a UUID).** The WebView loads each id once and
  clears only the request it loaded, so a repeat tap on the same Mac is never swallowed and a newer
  tap is never wiped by an older clear. Chosen over comparing URLs, which depended on SwiftUI
  running an update after the clear (challenge-loop iteration 3).
- **Punycode refused outright.** A Mac name is plain ASCII; an `xn--` label is how a lookalike would
  arrive. What would change it: Mac names allowing Unicode.
- **The relay domain is derived, not a second constant:** the coordinator origin's host minus its first
  label (`login.kosmosplus.com` -> `kosmosplus.com`, matching `KOSMOS_DOMAIN=kosmosplus.com` in
  kosmos-relay `deploy/kosmos-coordinator.service`). Repointing `KosmosConfig.coordinatorOrigin`
  repoints the tap with it; a host with fewer than three labels refuses every tap. The coordinator's
  own host is refused as a tap target (challenge-loop iteration 1).
- **What a tap lands on (read from kosmos-relay source, not measured):** the same URL the coordinator's
  own web-push tap opens (`coordinator/src/sw.js`, `openWindow("https://" + address + "/")`). The
  tunnel's gate (`crates/tunnel/src/proxy.rs`) shows the board when the request carries that Mac's
  session cookie and its gate page otherwise, which links to the coordinator sign-in. The WebView
  uses the default persistent website data store, so a device admitted to that Mac inside the app
  reaches the board; one that was not sees the gate page. That is the existing behavior, not new.
- Approve/Deny actions stay log-only: the coordinator sends no category yet (Kano's plan). They do
  not touch `boardToOpen`; that branch is UIKit code outside the Foundation-only tests.

## Weakest part
The WebView wiring (publish, load, clear on the next main-queue turn, a coordinator guarding double
loads) compiles but is not exercised by any test, since there is no simulator runtime. The logic it
calls is tested; the SwiftUI update timing is reasoned, not measured. To be run on the simulator
when the runtime lands.
