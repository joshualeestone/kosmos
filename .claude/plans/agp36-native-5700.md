# agp36-native-5700: upgrade AGP + Robolectric to support compileSdk 36 natively

kosmos#5700. The Android app targets compileSdk/targetSdk 36 (Play requires targetSdk 36, #4090), but
the toolchain predated API 36 and carried two temporary workarounds. This upgrades the toolchain so
API 36 is supported natively and drops both workarounds.

## Change (toolchain only; no app source or behaviour change, no versionCode bump)

- `android/build.gradle`: AGP `8.6.1` -> `8.13.0`. 8.9.0 was the first AGP to officially support
  compileSdk 36; 8.13.0 is the latest 8.x. Deliberately NOT 9.x (a major-version jump is out of scope).
- `android/gradle/wrapper/gradle-wrapper.properties`: Gradle `8.9` -> `8.13` (AGP 8.13 requires it).
- `android/gradle.properties`: drop `android.suppressUnsupportedCompileSdk=36` (AGP 8.13 supports
  compileSdk 36 natively, so the escape hatch is no longer needed).
- `android/app/build.gradle`: Robolectric `4.14.1` -> `4.17` (4.16 was the first with API 36 support).
  Add `--add-exports=java.base/jdk.internal.access=ALL-UNNAMED` to the unit-test JVM
  (`testOptions.unitTests.all.jvmArgs`): Robolectric 4.16+ at API 36 on JDK 17+ reflects into
  `jdk.internal.access`, which the module system blocks, so every `@RunWith(RobolectricTestRunner)`
  suite otherwise fails with "Failed to interact with raw FileDescriptor internals".
- `android/app/src/test/resources/robolectric.properties`: removed (the `sdk=35` pin). The JVM unit
  tests now run at the manifest targetSdk (36), so they cover the forced edge-to-edge / predictive-back
  behaviour that only exists at API 36.
- `.github/workflows/android.yml`: add `build-tools;36.0.0` to the SDK install (AGP 8.13 + compileSdk 36
  selects build-tools 36.0.0; installed explicitly for determinism, not via AGP auto-download).
  `platforms;android-35` and `build-tools;35.0.0` are RETAINED: dropping them is unverified and is a
  separate, independently-testable change (the card's "reassess" -> kept, deferred).
- `android/README.md`: the file-tree note now reads AGP 8.13.0.

## Verified locally (JDK 21 at /opt/homebrew/opt/openjdk@21, SDK at /opt/homebrew/share/android-commandlinetools)
- `:app:assembleDebug` BUILD SUCCESSFUL under AGP 8.13 / Gradle 8.13 / compileSdk 36, no suppress flag.
- `:app:testDebugUnitTest` (forced `--rerun-tasks`, not from cache): 37 tests, 0 failures, 0 errors, at
  API 36 with Robolectric 4.17.
- Negative control: with the `--add-exports` removed, 9 of the 37 (the Robolectric-runtime suites) FAIL,
  which proves the tests actually run at API 36 and that the flag is load-bearing.
- The built APK is unchanged: package io.kosmos.app, versionCode 4, versionName 0.1.3, targetSdk 36,
  compileSdk 36 (toolchain-only, as intended).

## Remaining / not in this PR
- Emulator smoke (needs-device): the API-35 Moto AVD regression-installs/runs the AGP-8.13 APK. The
  API-36 runtime behaviour is covered by the Robolectric-at-36 suite above (an API-35 emulator cannot
  show the API-36-only behaviour). Captured as device-QA evidence on the card.
- Dropping `platforms;android-35` / `build-tools;35.0.0` from CI: deferred (unverified; separate change).

## Done when
Challenge-loop converged; plan + hash-matched proof committed; CI green (android.yml builds + the unit
tests at API 36); PR opened, `Addresses #5700` (and #4090 as the follow-up origin), reviewer joshualeestone.
