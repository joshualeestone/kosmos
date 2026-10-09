# android36-play: target API 36 for Google Play

## Problem

Google Play rejected the first internal-testing upload of the Android app: it targets API level 35 and must target at least API level 36. The app (io.kosmos.app) is a Trusted Web Activity launcher; the board itself renders in Chrome.

## Change (built by Liu Kang, gates are mine)

Two files only, no app code:

- `android/app/build.gradle`: `compileSdk` 35 -> 36, `targetSdk` 35 -> 36, `versionCode` 3 -> 4, `versionName` 0.1.2 -> 0.1.3.
- `android/gradle.properties`: add `android.suppressUnsupportedCompileSdk=36`.

The suppress flag is needed because AGP 8.6.1 predates API 36 and otherwise refuses to compile against it. It is the documented escape hatch, not an app-behavior change.

## Risk and what API 36 forces

API 36 makes edge-to-edge mandatory (the opt-out is gone) and turns predictive back on by default. Because the board renders in Chrome (which draws its own system bars), the only native surfaces that can change are the two small screens the launcher draws itself: the address chooser and the load-error page, which may now draw under the status bar. The smoke test checks exactly those plus the back gesture.

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
- 0.1.3 APK smoke-tested on an emulator (install, open, address chooser and load-error screenshots, edge-to-edge and back), result appended to `/tmp/splinter-msg/liukang-android-api36.md` and posted on #4090.
- Only if the smoke test passes: 0.1.3 APK published as the sideload at installkosmos.com/dist/android/ the way 0.1.2 was, verified by downloading the whole file and checking sha256 `1116634e0037979e13ad69c9ab475bad3ad82f080690df4d700ca3c5c1e20b72`.
