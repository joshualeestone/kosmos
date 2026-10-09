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

## Suppress-flag decision (for the PR note)

`android.suppressUnsupportedCompileSdk=36` is acceptable as a short-term measure here: no app code uses an API 36 feature, and the app is a thin TWA launcher. The clean long-term fix is to upgrade AGP and Gradle to a version that officially supports `compileSdk 36`, which should follow as its own card rather than being bundled into this urgent compliance bump.

## Finished looks like

- Challenge-loop converged on this diff; local suite green on the head; this plan plus a hash-matched proof committed.
- PR opened (Addresses #4090), reviewer joshualeestone, with the suppress-flag note and a pointer to the AGP-upgrade follow-up. CI green, merged by name (squash), worktree and branch cleaned up.
- 0.1.3 APK smoke-tested on an emulator (install, open, address chooser and load-error screenshots, edge-to-edge and back), result appended to `/tmp/splinter-msg/liukang-android-api36.md` and posted on #4090.
- Only if the smoke test passes: 0.1.3 APK published as the sideload at installkosmos.com/dist/android/ the way 0.1.2 was, verified by downloading the whole file and checking sha256 `1116634e0037979e13ad69c9ab475bad3ad82f080690df4d700ca3c5c1e20b72`.
