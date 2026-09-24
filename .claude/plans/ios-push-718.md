# ios-push-718: the iOS app side of push

Card: #718 (iOS slice; Sonya holds Android, Kano leads push and owns the coordinator side in
kosmos-relay branch `apns-718`). Assigned by Liu Kang (m433, 2026-09-24). Owner: Johnny Cage.

## Finished means
1. When the person signs in on the coordinator page inside the app, the app receives the
   session through the `kosmosSession` WebView bridge, accepts it ONLY from the main frame of
   `https://login.kosmosplus.com`, keeps it in the Keychain (never UserDefaults, never logged),
   and registers its APNs device token with `POST /v1/push/apns/register`.
2. When the page posts `{token: null}` (sign-out), the app calls `POST /v1/push/apns/unregister`
   with the old session and then forgets the session.
3. The app carries the `aps-environment` entitlement and reports the right `environment`
   (`sandbox` for a development-signed or simulator build, `production` otherwise).
4. The build is green (`xcodebuild -target Kosmos -sdk iphoneos26.5`, and the simulator SDK),
   and the pure logic (origin gate, message parse, request shape, environment choice, response
   handling) is proven by tests that run on this Mac without a simulator.
5. Simulator run: deferred until Josh installs the iOS runtime (Liu Kang m435). Stated, not claimed.

## Contract (Kano, kosmos-relay `.claude/plans/apns-718.md`, commits 540a7cb + d3c411e)
- `POST /v1/push/apns/register`, `Authorization: Bearer <session KST>`,
  body `{"token": "<hex>", "bundle_id": "<id>", "environment": "production"|"sandbox"}`.
  200 ok; 400 malformed; 401 bad session; 403 refused device. Idempotent on the token.
- `POST /v1/push/apns/unregister`, same auth, `{"token": "<hex>"}`, 200 either way.
- Page bridge: `window.webkit.messageHandlers.kosmosSession.postMessage({token: <string|null>})`
  at sign-in and sign-out. Page and API share the coordinator origin (the page fetches `/v1/...`
  relative), so the API base is the coordinator origin.
- Token validation on the server: 64..200 hex chars, even length.

## Decisions
- **Board URL repointed to the coordinator origin.** #2854 is decided (Liu Kang): the app origin
  is `login.kosmosplus.com` for both apps. `KosmosConfig.coordinatorOrigin` is the one value;
  `boardURL` is derived from it. The bridge only works if the app actually loads that page.
- **Pure logic in its own file (`PushBridgeLogic.swift`, Foundation only)** so it compiles for
  macOS and its tests run with `swiftc` on this box. No simulator runtime exists here, so XCTest
  cannot run; a macOS-built test binary is the strongest proof available until it lands. Rejected:
  an XCTest target now (cannot run, would read as coverage while running nothing).
- **Keychain, not memory only.** The page posts only at the moment of sign-in; on a later launch it
  restores its own localStorage session and posts nothing. Memory-only would lose the ability to
  register (a new APNs token) or unregister after a relaunch. Item class generic password,
  `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (no iCloud/backup migration to another device).
- **APNs device token in memory only.** iOS re-delivers it every launch after
  `registerForRemoteNotifications()`; it is not a secret, but there is no need to persist it.
- **Register when both halves are present**, whichever arrives second. A new session with the same
  token re-registers (the server upsert moves the row to the new session's account).
- **401 from register or unregister drops the stored session** (it is dead; keeping it would retry
  forever). 403 keeps it (the device is refused; the session is still the person's). Network errors
  keep everything; the next launch retries because the token is re-delivered.
- **Environment at runtime**: simulator -> sandbox; an `embedded.mobileprovision` whose
  entitlements say `aps-environment = development` -> sandbox; `production` in the profile, or no
  profile at all (App Store installs strip it) -> production. Rejected: `#if DEBUG` (a Release build
  signed with a development profile would claim production and every push would fail with
  BadDeviceToken).
- **Entitlements file** `ios/Kosmos.entitlements` (outside the synchronized source folder so it is
  never copied into the bundle), `aps-environment = development`; Xcode rewrites it to production
  at distribution export. Wired via `CODE_SIGN_ENTITLEMENTS` in both configurations.

## Weakest part
The origin gate trusts WebKit's `securityOrigin` for the main frame. Any page the WebView navigates
to on that exact origin can post a token; that is the coordinator's own origin, so it is the trust
boundary we chose, not a hole. A token from a lookalike host, a subframe, or plain http is refused
and tested. What would change it: the coordinator serving user content on that origin.

## Steps
- [ ] PushBridgeLogic.swift: origin gate, message parse, hex token, environment, request builder,
      response classification.
- [ ] SessionKeychain.swift: save/load/delete.
- [ ] PushNotificationManager: state machine (apnsToken, session), register/unregister via URLSession.
- [ ] ContentView/WebView: install the `kosmosSession` handler through a weak proxy; KosmosApp passes
      the manager in.
- [ ] Entitlements + CODE_SIGN_ENTITLEMENTS.
- [ ] ios/LogicTests: macOS test binary incl. a URLProtocol stub for the network arms; run script.
- [ ] README update; builds green (device + simulator SDK).
- [ ] Contract confirmed with Kano; challenge-loop; PR (Addresses #718); report to Liu Kang.
