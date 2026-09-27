# ios-archive-718: iOS ready to upload the moment Apple approves (kosmos #4089, #718)

## Finished looks like

- Setting one line (`DEVELOPMENT_TEAM` in `ios/Signing.xcconfig`) is the only code change needed
  once Apple approves Kosmos Agent Manager, Inc. (#3643).
- `ios/tools/archive.sh --build N [--upload]` archives, exports, refuses any `.ipa` whose
  `aps-environment` is not `production`, and uploads that same checked file.
- The app icon (`assets/Kosmos-1024.png`) and a navy launch screen are in an asset catalog, and iOS
  CI proves the built app carries both.
- `docs/phone-push-go-live.md` Step 4 says what is done and what waits on approval.

## Decisions

- **Team ID home: an xcconfig set as the target's base configuration.** Rejected: a plain text file
  read only by the script (Xcode would not see it, so a build from Xcode signs with no team), and
  editing `DEVELOPMENT_TEAM` straight into the pbxproj (two configurations, so two places, and the
  script would have to parse the pbxproj). Measured: a test value in the xcconfig reaches
  `xcodebuild -showBuildSettings` for the target.
- **ExportOptions.plist is committed without a team.** `archive.sh` adds `teamID` to a copy, so the
  Team ID still has one home.
- **Upload sends the checked file.** Rejected: a second `-exportArchive` with `destination=upload`,
  which re-signs and so uploads a file that was never checked. The price: `--upload` needs an App
  Store Connect API key (altool). Without one the script still exports and checks, and the `.ipa`
  goes up by Transporter.
- **`--build` is required**, not read from the project: App Store Connect refuses a repeated build
  number, so it is chosen per upload.
- **Launch screen via a partial `Kosmos-Info.plist`** (only `UILaunchScreen` > `UIColorName`),
  outside the synchronized `Kosmos/` folder so it is not also copied in as a resource.
  `INFOPLIST_KEY_UILaunchScreen_Generation` is removed so the generated empty dictionary cannot
  compete with it. Navy is `#17233D`, `UIColor.kosmosNavy`'s value.
- **The catalog icon is a copy** of `assets/Kosmos-1024.png`, not a symlink; `check-app-assets.sh`
  fails if the two differ, so the artwork keeps one source.

## Weakest part

- **Nothing here has compiled the asset catalog yet.** This Mac has no iOS runtime (measured:
  actool fails for both simulator and device platforms), so the first proof is the PR's iOS CI run.
  If the runner's image also lacks a runtime, the icon check goes red and the card is blocked on
  Josh running `xcodebuild -downloadPlatform iOS`.
- **The archive and export with signing have never run**, and cannot until there is a Team ID. CI
  runs the same archive command unsigned; the export options are Apple's documented keys, not
  measured.
- **Whether a TestFlight export really re-signs `aps-environment` to production** is Apple's
  documented behaviour, not measured here. That is exactly why the check exists.

- **`xcrun altool --upload-app` has not run here** and Apple has been retiring altool subcommands.
  If it refuses on approval day, the checked `.ipa` goes up through Transporter, which the script
  already names as the fallback.
- **`check-app-assets.sh` reads `assetutil --info` JSON by a text match** (`"Name" : "AppIcon"`)
  that has not been seen against real output yet; it fails closed (no match is MISSING), so the
  risk is a false red on the first CI run, not a false green.

## Challenge loop
- The entitlement check takes the Team ID from `archive.sh` and refuses another team's signature
  (application identifier and `com.apple.developer.team-identifier`). That key has dots, so it is
  read with PlistBuddy: `plutil -extract` treats the dots as a path and never finds it, which made
  the first version refuse every correct build.
- A shared `Kosmos` scheme is committed so `-scheme Kosmos` does not depend on Xcode creating one.
- iOS CI's timeout is 40 minutes: it now compiles the catalog twice and archives on top of the two
  simulator builds.

## What would change my mind

- A CI run showing the generated `UILaunchScreen` overrides the partial plist: then keep the
  generation key off and move the colour into build settings some other way, or a storyboard.
- Josh preferring upload from Xcode's Organizer: then `--upload` is optional sugar and the export +
  check is the part that matters.
