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
- `Kosmos/AppDelegate.swift` + `Kosmos/PushNotificationManager.swift`: the APNs
  client-registration path and the notification categories/actions, bridged to
  the SwiftUI app via `@UIApplicationDelegateAdaptor`. Buildable stubs — the
  APNs auth key (.p8), the `aps-environment` entitlement, and the coordinator's
  token-upload endpoint are external unblocks (#718), marked in code.
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

## App Store presence is gated on the front door (#2854), unchanged by Xcode

Identical to Android: a store app needs ONE fixed public front-door origin that
routes to the user's own Mac, because the relay hands each user a per-user
hostname. `KosmosConfig.boardURL` is a **placeholder** (`app.kosmos.io`) until
that origin is decided (#2854, owned by Splinter and Josh). Xcode being
installed does not clear this; the shell can be built and iterated now, but not
submitted, until the front door exists.

## Not in scope

The front-door origin (#2854), the board's service worker, the coordinator's
web-push / APNs *send* path and the APNs auth key, the `aps-environment`
entitlement + provisioning profile, a signing certificate, App Store
submission, and simulator execution. (The native *client* surface that clears
Review 4.2 — APNs registration, notification actions, biometric unlock — is now
present as buildable stubs, #718.)
