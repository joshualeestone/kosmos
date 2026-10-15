# iosfirst-6262: the iOS app builds as io.kosmos.app under Kosmos Agent Manager, Inc., and runs in a simulator

Card: kosmos#6262, "First buildable slice", items 1 and 2, plus Splinter's 17:57 ask: build the native app for the
simulator, get it launching and talking to a board, and write down what a device build needs. Nothing is created in
Apple's systems by this branch; the App Store Connect key 3M63HJVBV7 was used for GET requests only.

## Changes
- `ios/Kosmos-Info.plist`: `ITSAppUsesNonExemptEncryption = false` (without it every TestFlight build stops at an
  export-compliance question; the app uses only standard HTTPS).
- `ios/Signing.xcconfig`: `DEVELOPMENT_TEAM = 6563JLN5HF`, `KOSMOS_BUNDLE_ID = io.kosmos.app` (registered there with
  Push Notifications by Angel, 2026-10-15 16:59 and 17:00).
- `ios/tools/archive.sh`: the pairing guard turns from "never io.kosmos.app under Stone Syndicate" into
  "io.kosmos.app only under 6563JLN5HF". The header now says a real run's `-allowProvisioningUpdates` CREATES a
  certificate and profile with an API key; `--check-config` never does.
- `ios/tools/test-archive-config.sh`: the cases follow the new rule (kosmos team passes, Stone and any other team
  refused for io.kosmos.app, case-insensitive both ways; the refusal must come from the pairing check's own sentence).
- Docs: `ios/README.md` (signing section, simulator run, the Xcode 27 simctl hang), `docs/phone-push-go-live.md`
  (org approved, App ID done, interim marked superseded), `android/phone-test-checklist.md` (the preview-build note
  becomes a no-APNs-key-yet note).

## Calls
- **The guard is an allow-list of one team, not a deny-list of Stone.** The card asks for "the new team as the one
  team allowed io.kosmos.app". A deny-list would let a third team (a contributor's own) strand the id too.
  Rejected: keeping the Stone refusal and adding the new team beside it (two rules for one fact).
- **io.kosmos.app.preview is left buildable under any team.** Nothing refuses it now, and refusing it buys nothing:
  it was never registered, and building it creates nothing. Rejected: refusing the preview id (a rule about an id
  nobody uses).
- **The simulator is driven through the system simctl, not `xcrun simctl`.** Xcode 27's simctl is a script that runs
  `xcodebuild -runFirstLaunch` when the system CoreSimulator (1051.55) is older than it expects (1171.7); that step
  needs an admin password and hangs forever in a terminal. The script's own last line execs the system simctl, so
  calling it directly is what the script does after that step. Rejected: waiting for an admin at the Mac.
- **Docs: the interim paragraph in phone-push-go-live.md is kept, marked superseded**, because #4089's reasoning
  (no transfer of a never-released app) is still why the guard exists.

## Weakest premise
That the old CoreSimulator (1051.55) runs Xcode 27 builds faithfully enough to count. Measured: install, launch,
render of the live sign-in page, the notification prompt. Not measured: anything a newer CoreSimulator would change.

## Evidence (Agent1s, 2026-10-15, Xcode 27.0)
- Simulator build, `-sdk iphonesimulator27.0 -target Kosmos -configuration Debug CODE_SIGNING_ALLOWED=NO`: BUILD
  SUCCEEDED; Info.plist reads `io.kosmos.app` and `ITSAppUsesNonExemptEncryption = false`;
  `tools/check-app-assets.sh` VERDICT PASS.
- Installed and launched on an iPhone 16 simulator, iOS 26.5 runtime: it loads the live Kosmos+ sign-in page from
  login.kosmosplus.com and shows the notification-permission prompt (screenshots on #6262).
- Device SDK, `-sdk iphoneos27.0 -configuration Release CODE_SIGNING_ALLOWED=NO`: BUILD SUCCEEDED;
  `check-usage-strings.sh` and `check-app-assets.sh` both VERDICT PASS.
- `ios/tools/test-archive-config.sh`: 18/18, VERDICT PASS. Mutant (the old Stone-only rule put back in a copy):
  `real-under-other-team` and the pairing-sentence check under ABCDE12345 both FAIL, VERDICT FAIL.
- `tools/test-cut-sign-preflight.sh`: 46 passed, 0 failed. `ios/tools/test-check-ipa-entitlements.sh`: PASS.
  `ios/LogicTests/run.sh`: 241/241. `archive.sh --check-config`: ok, io.kosmos.app under 6563JLN5HF.
- App Store Connect, GET only: 0 apps, 1 bundle id (io.kosmos.app, PUSH_NOTIFICATIONS + IN_APP_PURCHASE),
  0 certificates, 0 profiles, 0 devices.
