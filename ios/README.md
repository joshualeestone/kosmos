# Kosmos for iOS (native shell)

This is the iOS store shell for Kosmos: a native app that renders the Kosmos
board in a full-screen `WKWebView`. It is the same "a window pointed at the
board" shape as the macOS app (`native-app/main.swift`) and the Android TWA
(PR #2865). Unlike Android, iOS has no Trusted-Web-Activity path, and Apple
rejects a repackaged website (Review Guideline 4.2), so App Store presence
requires a genuine native app with real native surface (APNs registration,
notification actions, biometric unlock). The shell (#2869) plus that native
surface as buildable stubs (#718) are both here now. Full context on the cards
(#2869, #718).

## What this is

- `Kosmos.xcodeproj` plus `Kosmos/*.swift`: a SwiftUI app (`KosmosApp`) whose
  `ContentView` hosts a `WKWebView` pointed at the board.
- `Kosmos/ContentView.swift` holds the single front-door origin value
  (`KosmosConfig.boardURL`), the one place to repoint, mirroring the Android
  skeleton's `strings.xml`.
- `Kosmos/AppDelegate.swift` + `Kosmos/PushNotificationManager.swift`: APNs
  registration and the notification categories/actions, bridged to the SwiftUI
  app via `@UIApplicationDelegateAdaptor`. The device token is registered with
  the coordinator (see "Push" below). The `aps-environment` entitlement is in
  `Kosmos.entitlements`; the APNs auth key (.p8) lives on the coordinator, not
  in the app.
- `Kosmos/BiometricAuth.swift`: Face ID / Touch ID unlock, gated behind
  `KosmosConfig.requireBiometricUnlock` (default off, so the shell behaves as
  before). `NSFaceIDUsageDescription` is set as a build setting so the generated
  Info.plist carries it.
- No hand-written Info.plist: `GENERATE_INFOPLIST_FILE = YES`.

## Build (the verifiable deliverable)

A green `xcodebuild` against `iphoneos26.5`, from a clean clone, run from `ios/`:

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

Verified green on this box (Xcode 26.6, iOS SDK 26.5) producing
`build/Debug-iphoneos/Kosmos.app`.

## Buildable, not yet runnable, and no committed app icon (both gated on the same thing)

`xcrun simctl list runtimes` is empty: no iOS simulator runtimes are installed,
and the device *platform* support that `-scheme`/`-destination` wants is not
installed either. Installing it is `xcodebuild -downloadPlatform iOS`, a large
admin download and a **Josh operator action**. Two consequences, both waiting on
that one step:

1. **Running** the app in a simulator is a separate later step.
2. **The app icon is deferred.** Compiling an app-icon asset catalog triggers
   per-device *thinning*, which queries the (absent) platform runtimes and
   fails (`No available simulator runtimes for platform iphonesimulator`). So
   this skeleton ships with no wired app icon. Once the platform is installed,
   add an `AppIcon` asset catalog and set `ASSETCATALOG_COMPILER_APPICON_NAME`.

Neither blocks the build deliverable, which is compile+link against the SDK.

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

- **A page that cannot load** shows a native page (offline, Kosmos+ not answering, or the
  system's own reason) with Try again, and reloads by itself when an offline phone reconnects
  (`ShellViews.swift`, `Shell.loadFailure`).
- **Pull to refresh** reloads the page.
- **Links** (`Shell.linkDecision`): Kosmos+ and your Macs (plain host, no port or user part)
  open in the app over https. Any other site, however it is reached (a tap, a redirect, a
  script), opens in Safari, so no third-party page ever shows inside the app's frame. Plain http
  never loads in the app. Mail, phone and text links need a tap. Other schemes are refused.
- **A page that will not load** offers Try again and "Back to Kosmos".
- **A tapped notification** opens the agent that asked
  (`?tab=detail&agent=<session>`, the session checked against the board's agent-name rule), or
  the board home when the push carries no usable session.
- **No white flash:** the WebView is navy until the first page paints. The pages keep clear of the
  notch and home bar themselves, so the WebView adds no inset of its own.
- **Not yet:** a navy launch screen needs an asset catalog or a launch storyboard, and both need
  the iOS platform installed (see "Buildable, not yet runnable" above).

### Tests that run without a simulator

`LogicTests/run.sh` compiles the Foundation-only files (`PushBridgeLogic.swift`,
`PushRegistrar.swift`, `ShellLogic.swift`) for macOS with the tests and runs them. It ends with one
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
