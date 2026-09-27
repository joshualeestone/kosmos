# Kosmos for iOS (native shell)

This is the iOS store shell for Kosmos: a native app that renders the Kosmos
board in a full-screen `WKWebView`. It is the same "a window pointed at the
board" shape as the macOS app (`native-app/main.swift`) and the Android TWA
(PR #2865). Unlike Android, iOS has no Trusted-Web-Activity path, and Apple
rejects a repackaged website (Review Guideline 4.2), so App Store presence
requires a genuine native app with real native surface (APNs registration,
notification handling, biometric unlock). The shell (#2869) plus that native
surface as buildable stubs (#718) are both here now. Full context on the cards
(#2869, #718).

## What this is

- `Kosmos.xcodeproj` plus `Kosmos/*.swift`: a SwiftUI app (`KosmosApp`) whose
  `ContentView` hosts a `WKWebView` pointed at the board.
- `Kosmos/ContentView.swift` holds the single front-door origin value
  (`KosmosConfig.boardURL`), the one place to repoint, mirroring the Android
  skeleton's `strings.xml`.
- `Kosmos/AppDelegate.swift` + `Kosmos/PushNotificationManager.swift`: APNs
  registration and notification handling, bridged to the SwiftUI app via
  `@UIApplicationDelegateAdaptor`. `Kosmos/NotificationCategories.swift` holds
  the one category, with **no action buttons** (#3870): Approve and Deny were
  registered but nothing carried the choice to the board, so they are hidden
  until approving from a notification is built for real. A tap opens the
  agent. The device token is registered with the coordinator (see "Push"
  below). The `aps-environment` entitlement is in
  `Kosmos.entitlements`; the APNs auth key (.p8) lives on the coordinator, not
  in the app.
- `Kosmos/BiometricAuth.swift`: Face ID / Touch ID unlock, gated behind
  `KosmosConfig.requireBiometricUnlock` (default off, so the shell behaves as
  before). `NSFaceIDUsageDescription` is set as a build setting so the generated
  Info.plist carries it.
- No hand-written Info.plist: `GENERATE_INFOPLIST_FILE = YES`.
- Permission strings (`INFOPLIST_KEY_NS*UsageDescription`) for the camera, the microphone and
  adding to Photos, as well as Face ID. No Swift code asks for these, but the board's photo pickers
  offer Take Photo or Video inside the WebView and a long-pressed image offers Add to Photos, and
  iOS closes an app that uses one without its sentence. iOS CI checks all four in the built app,
  Debug and Release (`tools/check-usage-strings.sh`).
- iPhone only (`TARGETED_DEVICE_FAMILY = 1`): iPad layouts are not designed or tested. An iPad
  can still run it in a scaled iPhone window, so the board must stay usable there.

## Build

iOS CI (`.github/workflows/ios.yml`) is where the app is proven to build, because it compiles the
asset catalog, which needs an iOS runtime (see "App icon and launch screen" below). On a Mac with
the iOS platform installed, the same build from a clean clone, run from `ios/`, is:

```
xcodebuild -project Kosmos.xcodeproj -target Kosmos -sdk iphoneos26.5 \
  -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

- `-target` (not `-scheme`): the device *destination* needs an installed iOS
  platform for run/deploy, which is separate from the SDK (see below), so the
  scheme+destination path currently fails to resolve. Building the target
  against the SDK compiles and links without needing a destination.
- `CODE_SIGNING_ALLOWED=NO`: this verifies compile+link without a signing
  identity. A real signed build needs a certificate and provisioning.

Verified green on this box (Xcode 26.6, iOS SDK 26.5) before the asset catalog landed (#4089).
Since then the build compiles `Kosmos/Assets.xcassets`, which needs an iOS simulator runtime (next
section), so on a Mac without one it stops at the asset catalog. iOS CI builds it on GitHub's macOS
runner, which has the runtime.

## App icon and launch screen, compiled in CI (#4089)

- `Kosmos/Assets.xcassets` holds `AppIcon` (a byte-for-byte copy of `assets/Kosmos-1024.png`:
  1024 px, full bleed, no transparency; iOS makes every smaller size from it) and
  `LaunchBackground`, Kosmos navy `#17233D`, the same colour as `UIColor.kosmosNavy`.
- `Kosmos-Info.plist` holds only the launch screen (`UILaunchScreen` > `UIColorName =
  LaunchBackground`); everything else in the Info.plist is still generated from build settings.
- `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon` wires the icon.
- Compiling the catalog queries the installed iOS simulator runtimes and fails without one (`No
  available simulator runtimes for platform iphonesimulator`, measured on this box for both the
  simulator and the device platform). `xcrun simctl list runtimes` is empty here; installing one is
  `xcodebuild -downloadPlatform iOS`, a large admin download and a **Josh operator action**. Until
  then the app builds only in CI, where `tools/check-app-assets.sh` checks the built app carries
  both names and that the catalog icon is still `assets/Kosmos-1024.png`.
- Running the app in a simulator waits on the same runtime.

## Signing, archive and upload (#4089)

- **The Team ID lives in one place: `Signing.xcconfig`** (`DEVELOPMENT_TEAM`), the app target's
  base configuration. It is empty until Apple approves Kosmos Agent Manager, Inc. (#3643); then it
  is set to that org's Team ID and nothing else changes.
- `tools/archive.sh --build <N>` archives the Release app, exports it for App Store Connect with
  `tools/ExportOptions.plist` (the Team ID is added from `Signing.xcconfig`), and runs
  `tools/check-ipa-entitlements.sh` on the exported `.ipa`: `aps-environment` must be
  `production`, `get-task-allow` must not be `true`, and the app must be signed by the team in
  `Signing.xcconfig` (app identifier `<team>.io.kosmos.app`, team identifier `<team>`). `--upload` then sends that same checked `.ipa` to App Store Connect
  (it needs an App Store Connect API key: `ASC_KEY_PATH`, `ASC_KEY_ID`, `ASC_ISSUER_ID`).
- `--build` is required: App Store Connect refuses a build number it has already seen.
- Until the Team ID is set, `archive.sh` stops at that first check and says so.
- `-scheme Kosmos` uses the shared scheme committed under `Kosmos.xcodeproj/xcshareddata/`, so
  archiving does not depend on Xcode creating one.
- iOS CI builds an unsigned archive with the same command, and runs
  `tools/test-check-ipa-entitlements.sh`, which signs fake apps with right and wrong entitlements
  and shows the check passes the first and refuses the rest.

## Push: how the app registers for notifications (#718)

The app renders the coordinator sign-in page (`KosmosConfig.coordinatorOrigin`,
`https://login.kosmosplus.com`, decided on #2854). After sign-in, and on every
later load of a signed-in page, the page posts `{token: "<session>"}` to the
`kosmosSession` WebKit message handler; at sign-out, or when its saved session
turns out dead, it posts `{token: null}` (kosmos-relay `apns-718`).

- **Origin gate.** A post is accepted only from the main frame of exactly
  `https://login.kosmosplus.com` (scheme, host and port). Anything else is
  dropped before the body is read (`PushBridge.isTrustedSender`).
- **Storage.** The session is kept in the Keychain
  (`AfterFirstUnlockThisDeviceOnly`, `SessionKeychain`), never UserDefaults, and
  is never logged. The Keychain lets a relaunch register before the page loads.
- **Register / unregister** (`PushRegistrar`). When both the APNs device token
  and a session are present, the app calls `POST /v1/push/apns/register` on the
  coordinator origin with `Authorization: Bearer <session>` and
  `{token, bundle_id, environment}`; a repeat of the same pair is not re-sent.
  On sign-out it calls `POST /v1/push/apns/unregister` with the OLD session,
  then forgets it. A 401 forgets the session; a 403 keeps it.
- **Environment.** `sandbox` on the simulator or under a development
  provisioning profile, `production` otherwise (read from
  `embedded.mobileprovision` at runtime, not `#if DEBUG`).

- **Tapping a notification** opens `https://<address>/` (on the agent that asked, when the
  push names one; see "The shell on a phone" below), where `address` is the
  Mac's host from the coordinator's payload. Only a single hostname label under
  the coordinator's domain (`kosmosplus.com`, taken from
  `KosmosConfig.coordinatorOrigin`) is accepted (`PushBridge.boardURL`); anything
  else leaves the app where it is.

## The shell on a phone (#718)

- **A page that cannot load** shows a native page (offline; your Mac not answering, when the
  address that failed is a Mac's own, with "It may be asleep or turned off"; Kosmos+ not
  answering, for any other address; or the system's own reason) with Try again, and reloads by itself when an offline phone reconnects
  (`ShellViews.swift`, `Shell.loadFailure`).
- **Pull to refresh** reloads the page.
- **Links** (`Shell.linkDecision`): Kosmos+ and your Macs (plain host, no port or user part)
  open in the app over https. Any other site, however it is reached (a tap, a redirect, a
  script), opens in Safari, so no third-party page ever shows inside the app's frame. Plain http
  never loads in the app. Mail, phone and text links need a tap. Other schemes are refused.
- **A page that will not load** offers Try again and "Back to Kosmos" (`Shell.backAction`: after a
  tap that failed before loading it just closes, leaving the page you were on).
- **A tapped notification** opens the agent that asked
  (`?tab=detail&agent=<session>`, the session checked against the board's agent-name rule), or
  the board home when the push carries no usable session.
- **No white flash:** the WebView is navy until the first page paints. Safe areas behave as in
  Safari: a page that opts in with `viewport-fit=cover` (sign-in, the gate) pads for the notch and
  home bar itself, and WebKit keeps any other page (the board today) clear of them.
- **Launch screen:** Kosmos navy, from the asset catalog (see "App icon and launch screen" above),
  so launch, the WebView before its first paint and the sign-in page are one colour.

### Tests that run without a simulator

`LogicTests/run.sh` compiles the UIKit-free files (`PushBridgeLogic.swift`,
`PushRegistrar.swift`, `ShellLogic.swift`, `NotificationCategories.swift`) for
macOS with the tests and runs them. It ends with one
`VERDICT:` line; no verdict line means the run did not finish. Pass a directory
to run the suite against a modified copy of those files (how the suite was
shown able to fail). CI runs it, plus a simulator-SDK build, in
`.github/workflows/ios.yml` on any change under `ios/` (advisory, like the
Android job).

If the person declines notification permission, the app never asks APNs for a
token, so the device is never registered and receives no pushes. That is logged.

## Not in scope

The coordinator's APNs send path and the APNs auth key (kosmos-relay, Kano), a
signing certificate and provisioning profile with push enabled, App Store
submission, and simulator execution (no runtime on the build box yet).
