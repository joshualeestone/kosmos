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

## Decisions
- **The target waits in `PushNotificationManager.boardToOpen` (@Published)** and the WebView loads and
  clears it. Rejected: loading from the notification delegate directly, which has no WebView on a
  cold launch or behind the lock.
- **Punycode refused outright.** A Mac name is plain ASCII; an `xn--` label is how a lookalike would
  arrive. What would change it: Mac names allowing Unicode.
- **`KosmosConfig.relayDomain = "kosmosplus.com"`**, from the coordinator's systemd unit
  (`deploy/kosmos-coordinator.service`, `KOSMOS_DOMAIN=kosmosplus.com`).
- Approve/Deny actions stay log-only: the coordinator sends no category yet (Kano's plan).

## Weakest part
The WebView wiring (publish, load, clear on the next main-queue turn, a coordinator guarding double
loads) compiles but is not exercised by any test, since there is no simulator runtime. The logic it
calls is tested; the SwiftUI update timing is reasoned, not measured. To be run on the simulator
when the runtime lands.
