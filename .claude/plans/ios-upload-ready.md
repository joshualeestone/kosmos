# ios-upload-ready: the iOS app is ready to upload the moment Apple approves the company

Brief: Liu Kang m1118 (for Josh's "when is it on TestFlight"), card #3643. Nothing is uploaded;
there is no Apple account yet.

## Finished looks like
- The Team ID lives in one file, `ios/Team.xcconfig`, empty today; both build configurations and
  the archive script read it. Proven: a test value set there shows as DEVELOPMENT_TEAM in both
  Debug and Release `-showBuildSettings`.
- `ios/tools/archive.sh` archives Release, exports a signed .ipa with `ios/ExportOptions.plist`,
  prints its entitlements and fails unless `aps-environment` is production. It refuses an empty or
  malformed Team ID. It uploads only with `--upload`.
- The app icon (`assets/Kosmos-1024.png`) and a navy launch screen (#17233D, `kosmosNavy`) are in
  an asset catalog, compiled and checked in the built app by iOS CI.
- docs/phone-push-go-live.md Step 4 says what is done and what waits on approval.

## Decisions (reversible)
- **Export first, upload second.** The brief asked for ExportOptions with destination upload AND a
  check of the exported .ipa. An upload export leaves no .ipa on disk to check, so the committed
  plist says upload, and archive.sh exports a copy with destination export, checks it, and only
  then (with `--upload`) runs the upload export from the same archive. Weakest part: the upload
  export re-signs, so the checked .ipa and the uploaded one are two signings of one archive with
  the same options; they should carry the same profile, but that is reasoned, not measured.
- **method app-store-connect**, the current name for what the brief called app-store (renamed in
  Xcode 15.3; the old name is deprecated).
- **No Team ID env override.** One place means one place; an env var beside the xcconfig is a
  second source that can disagree.
- **Launch colour via a partial Info.plist** (`ios/Kosmos-Info.plist`, merged with the generated
  one): `UILaunchScreen.UIColorName` is a nested key with no INFOPLIST_KEY_ build setting.

## Measured
- On this Mac, actool fails on the icon catalog: "No available simulator runtimes for platform
  iphonesimulator". So the asset step can only be verified in CI. After this lands, a Mac without
  the runtime cannot build the app locally; README says so.
- check-ipa-entitlements.sh: production passes; development fails; get-task-allow true fails; no
  file fails. CI re-proves production-pass and development-fail on ad-hoc-signed stand-ins.
- check-app-assets.sh: passes on a stand-in app with a compiled catalog holding both names; fails
  with the launch key emptied and with no Assets.car.

## Waits on
- CI's macOS runner to have an iOS simulator runtime (the toolchain step prints them). If it does
  not, the asset step is red and the block is Josh's `xcodebuild -downloadPlatform iOS`.
