# android36-play: target API 36 for Google Play

## Problem

Google Play rejected the first internal-testing upload of the Android app: it targets API level 35 and must target at least API level 36. The app (io.kosmos.app) is a Trusted Web Activity launcher; the board itself renders in Chrome.

## Change (built by Liu Kang, gates are mine)

Liu Kang's core change is two files, no app code (the branch also carries the test, CI, and doc follow-ons listed further down):

- `android/app/build.gradle`: `compileSdk` 35 -> 36, `targetSdk` 35 -> 36, `versionCode` 3 -> 4, `versionName` 0.1.2 -> 0.1.3.
- `android/gradle.properties`: add `android.suppressUnsupportedCompileSdk=36`.

The suppress flag is needed because AGP 8.6.1 predates API 36 and otherwise refuses to compile against it. It is the documented escape hatch, not an app-behavior change.

## Risk and what API 36 forces

The app already targeted API 35, where edge-to-edge is already enforced, and it never sets the `windowOptOutEdgeToEdgeEnforcement` opt-out, so API 36 removing that opt-out changes nothing visible: the two native screens the launcher draws itself (the address chooser and the load-error page) already draw edge-to-edge today. API 36 also enables predictive back by default, but the app registers no custom back handling, so that is a no-op too. The board itself renders in Chrome, which draws its own system bars. The smoke test is therefore a regression check that the two native screens still render correctly and the back gesture still works on the enforced edge-to-edge regime, not a check of new behaviour, which is why running it on an API 35 AVD is representative (same regime, no opt-out in play). Separately: the native screens use fixed padding rather than window-insets handling. That is a pre-existing layout concern this SDK bump does not introduce or change (the behaviour is identical at 35 and 36 with no opt-out set); it is worth its own card if we want insets-aware padding, not part of this urgent compliance bump.

## Toolchain consequences (test and CI), beyond the two-file diff

Bumping `targetSdk`/`compileSdk` to 36 has test and CI consequences that the initial two-file diff did not cover, so this branch also carries:

- `android/app/src/test/resources/robolectric.properties` with `sdk=35`. Robolectric 4.14.1 supports Android only up to API 35 and defaults its emulated SDK to the manifest `targetSdk` (now 36), so the `@RunWith(RobolectricTestRunner)` suites would error "Robolectric does not support API level 36" in `:app:testDebugUnitTest` (the CI "Unit tests" gate). Pinning the JVM unit tests to API 35 avoids that; they exercise app logic, not API-36 runtime behaviour. The pin comes out when Robolectric is upgraded (same follow-up as the AGP upgrade).
- `.github/workflows/android.yml`: add `platforms;android-36` to the SDK install so `compileSdk 36` does not depend on AGP auto-downloading the platform on the runner.
- Doc and comment sync: `android/README.md`, `android/phone-test-checklist.md`, and the stale `android/build.gradle` header comment updated to SDK 36 / version 0.1.3.

## Suppress-flag decision (for the PR note)

`android.suppressUnsupportedCompileSdk=36` is acceptable as a short-term measure here: no app code uses an API 36 feature, and the app is a thin TWA launcher. The clean long-term fix is to upgrade AGP and Gradle to a version that officially supports `compileSdk 36`, which follows as its own card (#5700) rather than being bundled into this urgent compliance bump. #5700 also covers upgrading Robolectric so the API-35 unit-test pin can be removed.

## Finished looks like

- Challenge-loop converged on this diff; local suite green on the head; this plan plus a hash-matched proof committed.
- PR opened (Addresses #4090), reviewer joshualeestone, with the suppress-flag note and a pointer to the AGP-upgrade follow-up. CI green, merged by name (squash), worktree and branch cleaned up.
- 0.1.3 APK smoke-tested on an emulator (install, open, address chooser and load-error screenshots, edge-to-edge and back), result posted on #4090.
- Only if the smoke test passes: 0.1.3 APK published as the sideload at installkosmos.com/dist/android/ the way 0.1.2 was, verified by downloading the whole file and checking its sha256 against the release APK.
