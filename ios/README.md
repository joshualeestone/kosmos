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

**Going native (kosmos#6838, Josh 2026-10-21).** Screens move from the web view to
SwiftUI one at a time; the plan and its order are on the card. Slice 1 was the
native **Agents** tab beside the web **Board** tab; #6846 replaced Board with four web
tabs (Today, Projects, Tasks, Settings) sharing one web view. Agents: the app connects to the Mac by
itself (the Kosmos+ session in the Keychain lists the account's Macs, mints a
handoff for one, and the Mac's tunnel gate turns it into a session cookie in the
app's own private `URLSession`), then reads `/api/status` every 5 s. The decisions
are in `Kosmos/BoardLogic.swift`; `BoardClient.swift` moves the bytes;
`AgentsView.swift` draws the list. Tapping an agent opens its chat under Today, the board's home tab (#6846: Today, Agents, Projects, Tasks, Settings; the four web tabs share one web view).
The Mac's session cookie (with the Mac's name and address and a fingerprint of the Kosmos+ session, never the session) is kept
in the Keychain item `mac-session` (`SessionKeychain.macSession`) and reused across
launches; a sign-out, or Kosmos+ answering that the sign-in has ended, makes this
iPhone forget it (the Mac keeps its side until it expires, as for the web view).
The app opens on Agents when signed in to Kosmos+, otherwise on Today (the sign-in); the
store-screenshot build lights the tab of the address it opens (a project room under Projects). One Debug-only
launch switch exists for screenshots and never reaches Release: `KOSMOS_SAMPLE_AGENTS=1`
shows invented agents without connecting (and skips the notification prompt). App Store screenshots taken from now on include the tab bar (the stored ones predate it).

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

The SDK name follows the installed Xcode: `xcodebuild -showsdks` lists them (`iphoneos27.0` and
`iphonesimulator27.0` with Xcode 27).

- `-target` (not `-scheme`): the device *destination* needs an installed iOS
  platform for run/deploy, which is separate from the SDK (see below), so the
  scheme+destination path currently fails to resolve. Building the target
  against the SDK compiles and links without needing a destination.
- `CODE_SIGNING_ALLOWED=NO`: this verifies compile+link without a signing
  identity. A real signed build needs a certificate and provisioning.

Verified green on Agent1s-Mac-mini on 2026-10-15 (#6262) with Xcode 27.0, for the simulator, asset
catalog included: `-sdk iphonesimulator27.0` in place of `-sdk iphoneos26.5` above. The build
compiles `Kosmos/Assets.xcassets`, which needs an iOS simulator runtime (next section); iOS CI
builds it on GitHub's macOS runner, which has one.

## App icon and launch screen, compiled in CI (#4089)

- `Kosmos/Assets.xcassets` holds `AppIcon` (a byte-for-byte copy of `assets/Kosmos-1024.png`:
  1024 px, full bleed, no transparency; iOS makes every smaller size from it) and
  `LaunchBackground`, Kosmos navy `#17233D`, the same colour as `UIColor.kosmosNavy`.
- `Kosmos-Info.plist` holds the launch screen (`UILaunchScreen` > `UIColorName =
  LaunchBackground`) and `ITSAppUsesNonExemptEncryption = false` (#6262: the app uses only
  standard HTTPS, and without the key every TestFlight build stops at an export-compliance
  question). Everything else in the Info.plist is generated from build settings.
- `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon` wires the icon.
- Compiling the catalog queries the installed iOS simulator runtimes and fails without one (`No
  available simulator runtimes for platform iphonesimulator`). Agent1s now has an iOS 26.5 runtime
  (measured 2026-10-15, #6262); a Mac without one installs it with `xcodebuild -downloadPlatform
  iOS`, a large admin download. CI's `tools/check-app-assets.sh` checks the built app carries both
  names and that the catalog icon is still `assets/Kosmos-1024.png` (it passes on the local build too).

## Running it in the simulator (#6262)

Measured on Agent1s, 2026-10-15: the Debug simulator build installs and launches on an iPhone 16
simulator running iOS 26.5 (the app targets iOS 16), loads the live Kosmos+ sign-in page from
`login.kosmosplus.com`, and asks for notification permission.

- **Xcode 27's `xcrun simctl` hangs on this box.** It is a script that first runs `xcodebuild
  -runFirstLaunch` whenever the system CoreSimulator is older than Xcode expects (1051.55 installed,
  1171.7 expected), and that step needs an admin password, so it waits forever with no prompt in a
  terminal. Until someone runs `sudo xcodebuild -runFirstLaunch` once at the Mac, call the system
  simctl that script would have run:
  ```
  SC=/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/Resources/bin/simctl
  $SC create kosmos-sim com.apple.CoreSimulator.SimDeviceType.iPhone-16 com.apple.CoreSimulator.SimRuntime.iOS-26-5
  $SC boot <udid> && $SC bootstatus <udid> -b
  $SC install <udid> <SYMROOT>/Debug-iphonesimulator/Kosmos.app
  $SC launch <udid> io.kosmos.app
  $SC io <udid> screenshot shot.png
  ```
- **2026-10-17:** Xcode's first-launch setup has run (Josh, for #6262), so `xcrun simctl` works again, and the
  simulator runtime is now **iOS 27.0** (`xcodebuild -downloadPlatform iOS`, about 8 GB; the 26.5 runtime was no
  longer listed under Xcode 27.0). `ios/store/shoot-app.sh` runs the app on iPhone 17 and iPhone 17 Pro Max
  simulators for the App Store screenshots, with a build-only switch (`KOSMOS_STORE_SHOTS`) that opens a
  throwaway board instead of Kosmos+; iOS CI checks the store build never carries it.
- Signing in needs the six-digit code sent to the account's email, and a simulator never receives a
  real push (the app registers as `sandbox` there).

## Signing, archive and upload (#4089)

- **Xcode reads the Team ID from `Signing.xcconfig`** (`DEVELOPMENT_TEAM`), the app target's
  base configuration, and the bundle id too (`KOSMOS_BUNDLE_ID`). They are Kosmos Agent Manager,
  Inc.'s team and `io.kosmos.app`, registered there with Push Notifications on (#6262). The
  interim Stone Syndicate preview app (#4089) was never created and is dropped. `tools/archive.sh`
  also holds that team id, as the one team it allows `io.kosmos.app` under, so a team change is an
  edit in both files.
  - Push registration is refused by the coordinator until its `KOSMOS_APNS_BUNDLE_IDS` lists
    `io.kosmos.app` (kosmos-relay `coordinator/src/apns.rs` refuses any bundle id not on that list
    with HTTP 400, and its env template says an unset list refuses every app). The app logs
    `[Push] register failed with HTTP 400` and carries on, with no banner (`PushRegistrar.swift`).
  - Building for a real device in Xcode signs as that team too, so Xcode provisions
    `io.kosmos.app` under Kosmos Agent Manager, Inc. for a person signed in to that team. A bundle id
    belongs to one team across all of Apple, so anyone else passes their own team AND their own id
    on the command line (`xcodebuild ... DEVELOPMENT_TEAM=<theirs> KOSMOS_BUNDLE_ID=<their own id>`).
    Their App ID needs the Communication Notifications capability too (`Kosmos.entitlements` asks for it
    in every signed build, so a hand-made profile without it fails signing).
    Never set either in Xcode's Signing or General pane: that writes them into `project.pbxproj`,
    which must not be committed (`tools/test-archive-config.sh` fails if the project's bundle id is
    anything but `$(KOSMOS_BUNDLE_ID)`). A device build registers for push as its bundle id, so a
    local or staging coordinator must list that id in `KOSMOS_APNS_BUNDLE_IDS` and hold an APNs key
    from the same team to test push on a device.
- `tools/archive.sh --build <N>` archives the Release app, exports it for App Store Connect with
  a copy of `tools/ExportOptions.plist` that `tools/export-options.sh` writes, adding the Team ID from `Signing.xcconfig`, and runs
  `tools/check-ipa-entitlements.sh` on the exported `.ipa`: `aps-environment` must be
  `production`, `get-task-allow` must not be `true`, and the app must be signed by the team in
  `Signing.xcconfig` (app identifier `<team>.<KOSMOS_BUNDLE_ID>`, team identifier `<team>`). `--upload` then sends that same checked `.ipa` to App Store Connect
  (it needs an App Store Connect API key: `ASC_KEY_PATH`, `ASC_KEY_ID`, `ASC_ISSUER_ID`).
- `KOSMOS_IOS_PROFILE=<profile name>` signs by hand: the archive and the export use an Apple Distribution
  certificate and that App Store profile (for `<team>.<KOSMOS_BUNDLE_ID>`, with Push). Use it when the team has no
  registered device: automatic signing archives with a development profile first and stops with "Your team has no
  devices". The certificate and its private key must be in this Mac's login keychain, usable by `codesign`, and the
  profile installed. The name may not hold an apostrophe, a double quote, a backslash, a dollar sign or a control character, start
  with a space or be empty (`--check-config` refuses each; unset the variable to sign automatically). The first TestFlight build (#6262) was uploaded this way.
- `KOSMOS_IOS_NOTICE_PROFILE=<profile name>` goes with it (kosmos#6487): the App Store profile for the notification
  extension, `KosmosNotice` (`<team>.<KOSMOS_BUNDLE_ID>.notice`). Hand signing needs both, and each target takes its
  own (`KOSMOS_APP_PROFILE`, `KOSMOS_NOTICE_PROFILE` in `project.pbxproj`), so one profile is never given to both.

### The notification extension (kosmos#6487)

`KosmosNotice` runs when a notification arrives and shows it as a message from the agent, with the agent's picture
and what it actually said. It asks the person's own computer for them (`GET /api/phone/notice` on the board), at the
address the push names, with the session the app keeps for that computer (`SessionKeychain.macSession`). The words
never ride the push. When the computer does not answer in time, or the session is for another computer, the notice
shows as it came.

- The app and the extension share one keychain group, `<team>.<KOSMOS_BUNDLE_ID>.shared` (both entitlements files).
  The app moves a session kept before this group existed into it the first time it reads it.
- `io.kosmos.app` holds the Communication Notifications capability (turned on in the developer portal 2026-10-22;
  the App Store Connect API cannot turn it on, but lists it as `USERNOTIFICATIONS_COMMUNICATION`). So
  `Kosmos.entitlements` carries `com.apple.developer.usernotifications.communication` and `KosmosNotice-Info.plist`
  sets `KosmosMessageStyle` to true: a notice shows as a message from the agent, picture and name, as a chat app's do.
  Set `KosmosMessageStyle` to false and the picture rides as the notice's attachment instead. Any capability change
  on the App ID invalidates the "Kosmos App Store" profile: make a fresh one. `check-ipa-entitlements.sh` refuses a
  store build whose extension asks for the message style while the app lacks the entitlement.
- The UIKit-free part (`KosmosNotice/NoticeLogic.swift`) runs in `LogicTests/run.sh`;
  `tools/check-ipa-entitlements.sh` checks the extension in a store build.
- `--build` is required: App Store Connect refuses a build number it has already seen.
- `archive.sh` refuses a malformed bundle id, or an empty or malformed Team ID, before it archives anything,
  and refuses `io.kosmos.app` under any team but Kosmos Agent Manager, Inc.'s (the bundle id is
  registered there). That refusal covers `archive.sh` only: an archive made from Xcode's menus or a hand-run
  `xcodebuild` never reaches it.
  `archive.sh --check-config` runs only those checks; `tools/test-archive-config.sh` (in iOS CI) shows each
  can refuse.
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

- **A page that cannot load** shows a native page (offline; your Mac not answering, when a
  Mac's own address gave no answer, with "It may be asleep or turned off"; Kosmos+ not
  answering, for any other address or error; or the system's own reason) with Try again, and
  reloads by itself when an offline phone reconnects (`ShellViews.swift`, `Shell.loadFailure`).
- **Pull to refresh** reloads the page.
- **Links** (`Shell.linkDecision`): Kosmos+ and your Macs (plain host, no port or user part)
  open in the app over https. Any other site, however it is reached (a tap, a redirect, a
  script), opens in Safari, so no third-party page ever shows inside the app's frame. Plain http
  never loads in the app. Mail, phone and text links need a tap. Other schemes are refused.
- **A page that will not load** offers Try again and "Back to Kosmos" (`Shell.backAction`: after a
  tap that failed before loading it just closes, leaving the page you were on). When it is your Mac
  that is not answering it also offers "Choose another computer" (kosmos#6850,
  `Shell.offersOtherComputer`), which opens the Kosmos+ account page (`/account`, never `/`, which can
  open a lone computer by itself): your computers, which of them are answering, and Open on each one
  that is.
- **A tapped notification** opens the agent that asked
  (`?tab=detail&agent=<session>`, the session checked against the board's agent-name rule), or
  the board home when the push carries no usable session.
- **No white flash:** the WebView is navy until the first page paints. Safe areas behave as in
  Safari: a page that opts in with `viewport-fit=cover` (sign-in, the gate) pads for the notch
  itself, and WebKit keeps any other page (the board today) clear of it. Since the tab bar
  (kosmos#6838) the web view ends above it, with navy behind the bar.
- **Launch screen:** Kosmos navy, from the asset catalog (see "App icon and launch screen" above),
  so launch, the WebView before its first paint and the sign-in page are one colour.

### Tests that run without a simulator

`LogicTests/run.sh` compiles the UIKit-free files (`PushBridgeLogic.swift`,
`PushRegistrar.swift`, `ShellLogic.swift`, `NotificationCategories.swift`, `BoardLogic.swift`,
`BoardClient.swift`, the native connect and refresh loop, driven against a fake Kosmos+ and Mac) for
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
signing certificate and provisioning profile with push enabled, and App Store
submission.
