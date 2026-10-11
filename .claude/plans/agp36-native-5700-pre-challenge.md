---
pre_challenge: true
method: challenge-loop
branch: agp36-native-5700
diff_hash: 4cf92f09ddbaf50c8e4aca0367a49c2f8289b9faa3fc36fa650d9bde05b28065
validation: passed (android is an isolated Gradle project, so the relevant suite is the Android build+tests, not the repo's node suite: :app:assembleDebug + :app:testDebugUnitTest --rerun-tasks under AGP 8.13.0 / Gradle 8.13 / JDK 21 / compileSdk 36 = BUILD SUCCESSFUL, 37 tests / 0 fail / 0 err across 5 suites at API 36 on HEAD 3d1665c; APK unchanged vc4/0.1.3/target36; gradle daemon stopped)
subdir_audit: passed (no subdir CLAUDE.md changed)
timestamp: 2026-10-10T22:38:43Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, sonnet)
**Converged:** Yes -- iteration 2 (sonnet) returned zero BLOCKER/WARNING/CONVENTION findings (three doc NITs, applied), with the build independently reproduced.
**Fixed:** iteration 1's stale-README WARNING + iteration 2's three doc NITs | **Deferred:** the Gradle-9 deprecation warning (out of scope; the card deliberately stays on AGP 8.x) | **Asked:** 0

### Scope
kosmos#5700: upgrade the Android toolchain so compileSdk 36 is supported natively, dropping two
temporary workarounds. AGP 8.6.1 -> 8.13.0, Gradle 8.9 -> 8.13, Robolectric 4.14.1 -> 4.17; drop
`android.suppressUnsupportedCompileSdk=36` and the `robolectric.properties sdk=35` pin (unit tests now
run at API 36); add `--add-exports=java.base/jdk.internal.access=ALL-UNNAMED` to the unit-test JVM; add
`build-tools;36.0.0` to CI (android-35 + build-tools 35.0.0 retained, their removal a separate change).
Toolchain-only: no app source change, no versionCode bump.

### Validation note
`android/` is an isolated Gradle project; the rest of the repo is a macOS node app, and `android.yml`
CI is path-filtered to `android/**`. So the relevant local suite is the Android build + unit tests
(run above), not the repo's node suite, which this diff does not touch. The node suite is orthogonal and
was not run; the path-filtered `android.yml` is the CI gate for this change.

### Per-Iteration Breakdown
#### Iteration 1 (opus) -- new: 1 WARNING, 2 NITs. Self-generated: 0 (first reviewer).
- [WARNING] android/README.md:31 -- the file-tree layout line still said "Gradle 8.9 wrapper" (only the
  adjacent AGP line had been updated). --> FIXED (bd27008): -> 8.13.
- [NIT] android/README.md:129 -- "Gradle 8.9's daemon criteria..." stale version (claim still true). --> FIXED (bd27008): -> 8.13.
- [NIT] the build's Gradle-9 deprecation warning. --> DEFERRED: expected; the card stays on AGP 8.x / Gradle 8.13, and the AGP 9 jump is a separate future card. The reviewer independently reproduced the full build (37/37 at API 36, APK unchanged) and the negative control (removing the flag fails exactly the 9 Robolectric-runtime tests with "Failed to interact with raw FileDescriptor internals").
#### Iteration 2 (sonnet) -- new: 0 BLOCKER/WARNING/CONVENTION, 3 NITs. CONVERGED.
- [NIT] android/README.md:96-98 -- the Installed list said only build-tools 35.0.0 and pointed the
  android-35 retention at "the #5700 cleanup" (circular: #5700 is this card, which kept it). --> FIXED
  (3d1665c): list 35.0.0 and 36.0.0; reframe as a separate future change.
- [NIT] app/build.gradle:104 -- "needs JDK 21" overstated (the flag is needed on JDK 17+; 21 is used). --> FIXED (3d1665c).
- [NIT] android.yml:121-123 -- the retained-packages comment is wordy and cites #5700; the reviewer said it is not wrong. --> left (accurate: it states the retention + that removal is a separate change).
- The reviewer independently reran the build (BUILD SUCCESSFUL, 37/37, 0 fail/err at API 36), confirmed the unchanged APK, the flag's placement reaching CI, the CI build-tools addition, the per-suite nonzero+clean CI guard holding at API 36, and a clean whole-worktree staleness sweep.

### Final Ledger
| Iter | Category | Issue | Resolution |
|---|---|---|---|
| 1 | WARNING | README file-tree still "Gradle 8.9" | FIXED bd27008 |
| 1 | NIT | README daemon-criteria "8.9" | FIXED bd27008 |
| 1 | NIT | Gradle-9 deprecation warning | DEFERRED (out of scope; stays on 8.x) |
| 2 | NIT | README Installed list / #5700-circular retention note | FIXED 3d1665c |
| 2 | NIT | build.gradle "needs JDK 21" overstated | FIXED 3d1665c |
| 2 | NIT | android.yml retained-packages comment wordy | left (accurate) |

### Outstanding questions (ASKED): none.

### Strengths (across iterations)
- Build reproduced by BOTH reviewers: AGP 8.13.0 / Gradle 8.13 / compileSdk 36 builds with no suppress
  flag; 37 unit tests pass at API 36 across 5 suites; the APK is unchanged (vc4 / 0.1.3 / target 36).
- The `--add-exports` is load-bearing and proven to run at API 36: removing it fails exactly the 9
  Robolectric-runtime tests with the FileDescriptor module-access error (independent negative control).
- Version pairing correct (AGP 8.13 <-> Gradle 8.13 <-> Robolectric 4.17 <-> JDK 21); CI build-tools
  36.0.0 added explicitly; the per-suite nonzero+clean CI guard holds at the new emulated SDK.
- Whole-worktree staleness sweep clean (only historical plans and legitimate emulator-evidence remain);
  robolectric.properties deletion complete.
