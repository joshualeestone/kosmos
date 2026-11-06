# Native Android — Slice 1: shell and board client (#8046)

Owner: Raiden (Mortals). Branch: `android-shell-8046`. Card: #8046 (Liu Kang runs it; slice list
in the #8046 comments, modelled on the iOS plan #6838). Slice 1 is the gate for slices 2–5.

## What "done" looks like for slice 1
A native Android activity shell that:
- hosts the board client (sign-in and token handling), a load-failure page, and a same-app upgrade check;
- shows **only the Sweep dots** as its loading indicator, from the first screen — no `ProgressBar`, no
  Material progress indicator, no `ProgressDialog`, no `SwipeRefreshLayout` default spinner (Josh
  2026-11-05 18:33, mirrored from iOS #8058 / kosmos#7954);
- builds and runs on Josh's real Android device (verified on the box, not here).

Not done at merged — done is a native build on Josh's device doing the core jobs.

## This push (first increment — the dots rule from the first screen)
Sonya Blade handed slice 1 over with this first task, and it is done in this push:
1. **`SweepLogic.kt`** — a pure-Kotlin port of `ios/Kosmos/SweepLogic.swift` (no Android imports, so a
   plain JVM unit test runs it). Every constant is pinned to the board's CSS in `web/index.html`
   (`.spin-sweep`, `@keyframes sweepLite`, `@keyframes calmPulse`): count 8, loop 1.2s, step 0.15s,
   rest .2/.6, lit 1/1.08, peak 20%, rest-from 72%, calm 1.6s .85→.4, dot share .19, launchAt, calmFrom.
2. **`SweepDots.kt`** — a custom `View` that draws the eight-dot ring on a `Canvas` from
   `SweepLogic.shown`, the direct analog of iOS's SwiftUI `Canvas` `SweepDots`. First frame is the
   launch frame (`launchAt`); honors Reduce Motion (Android "Remove animations" →
   `ANIMATOR_DURATION_SCALE == 0`) with the calm pulse / still-frame; scales with `fontScale`; hides
   from TalkBack when it has no label.
3. **`SweepLogicTest.kt`** — mirrors `ios/LogicTests/sweep/main.swift`: pins the constants to
   `web/index.html` (with a negative control that moves a keyframe and must fail the pins) and checks
   the motion (ease-in-out, keyframes, each dot peaking 0.15s after the last with a reversed control,
   geometry, Reduce Motion, the launch frame, `shown`, the 24s wrap).
4. **`SweepGuardTest.kt`** — the "dots only" guard: scans `android/app/src/main` and fails if any app
   source names `ProgressBar`, a Material `*ProgressIndicator`, `ProgressDialog`, or `SwipeRefreshLayout`
   (// comment lines skipped, like the iOS guard), with a positive control that a banned token IS caught.

## Decisions (and the weakest parts, named)
- **Kotlin** for all new native code (plugin `org.jetbrains.kotlin.android` 2.0.21, compatible with the
  pinned AGP 8.13 / Gradle 8.13 / JDK 17). Rejected: Java (consistent with the existing TWA module, but
  the wrong foundation for a from-scratch native rebuild — Josh: "built the way Android does things").
  **Weakest part:** the Kotlin gradle wiring is reasoned, NOT built — this box has no local Kotlin/Java
  toolchain and Gradle builds are gated on the box being clear (#8046). First build on a clear box is the
  verification; if the plugin/version pin is wrong, that build is where it shows.
- **Dots as a custom `View`**, not Jetpack Compose. The dots map cleanly onto `Canvas.drawCircle` either
  way; a `View` keeps this increment self-contained with one new gradle plugin instead of a whole Compose
  toolchain I cannot build-verify here. **The screen-layer framework (Compose vs Views) for the rest of
  slice 1 is deferred and flagged to Liu Kang** — that is the truly foundational call and it deserves a
  build + his eyes, not a silent commitment buried in this push.
- **Reuse the existing app identity and signing** (`io.kosmos.app`, versionCode 4) untouched — #8046 says
  the app must stay the same app on Play and on existing devices.

## Still to do in slice 1 (after this push)
- Native activity shell + board client (sign-in, token handling) wired to the dots.
- Load-failure page (native) and the same-app upgrade check.
- The screen-framework decision above, then the first native screen.
- Build + run on the box (gated), then a signed debug APK with its SHA-256 on the card for Josh's device.

## Build/▸machine discipline
No Gradle build runs on Mortals until `who-has-the-box.sh` / `heavy-gate` report the box clear and no cut
is in flight (#8046; handoff). This push adds source + tests only; nothing was built here.
