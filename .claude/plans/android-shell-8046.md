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
- **Jetpack Compose** for slice 1's native screens (approved by Liu Kang, 2026-11-06; recorded on #8046).
  iOS is SwiftUI, so Compose is the closest declarative match and Android's current default. Compose
  dependencies are added with the first native screen and verified by a build on a clear box.
- **Dots as a custom `View`**, not Compose — kept on purpose: the dots pin by content to the board CSS and
  their JVM tests (`SweepLogicTest`, `SweepGuardTest`) need no Compose. They render on a Canvas either way.
- **Reuse the existing app identity and signing** (`io.kosmos.app`, versionCode 4) untouched — #8046 says
  the app must stay the same app on Play and on existing devices.

## Board client + shell: what the iOS reference actually is (studied 2026-11-06)
The iOS "shell and board client" is a **hybrid**, not fully-native screens:
- `ShellLogic.swift` (Foundation-only, proven by `ios/LogicTests` with no simulator) holds: load-failure
  classification (`Shell.LoadFailure`: offline / unreachable / macUnreachable / other), link routing
  (in-app vs Safari vs block), retry/back actions, the "a Mac isn't answering" wording, and the whole
  **`AppTabs` + `PressTracker` tab brain** — Agents is a native tab, the other tabs load the board in **one
  WebView** through a JS "door" (`window.kosmosAppTab`).
- `BoardClient.swift` / `SignInClient.swift` / `SessionKeychain.swift` / `SignInLogic.swift` / `BoardLogic.swift`
  are the networking + token-storage + sign-in layer.
- The existing Android app is already a **Trusted Web Activity** (a WebView board with native sign-in
  handoff via `OpenAddressActivity`, a native `LoadErrorActivity`, and notification delegation).

### DECISION — Path A, mirror the iOS hybrid (ruled by Liu Kang, 2026-11-06; recorded on #8046)
Android slice 1 mirrors iOS's **hybrid**: a native (Compose) shell and chrome, the board in one WebView
through the board's JS door (`AppTabs`/`PressTracker` model), with native screens replacing board pages
slice by slice (Agents first), as iOS did. Reasons: #8046 asks for the same product/structure as iOS; the
hybrid is what iOS shipped; it reuses the existing TWA board; it reaches Josh's device fastest. Rejected:
a fully-native slice 1 (Compose screens hitting the API, no board WebView) — a much larger slice 1 and
more rework risk. Consequence: most of `ShellLogic` (load-failure, link routing, retry/back, the tab/door
brain) ports to Kotlin as the shell's framework-agnostic logic; the WebView + Compose chrome are thin
callers of it, as iOS's `ContentView` is.

## DONE this increment — load-failure classification (`ShellLoadLogic.kt` + `ShellLoadLogicTest.kt`)
Ported the `Shell.LoadFailure` classifier and the failure-page helpers (offersOtherComputer, retriesOnShow,
macName, macUnreachableTitle/Message, retryAction, backAction, isMacHost) to pure Kotlin with a JVM test
mirroring the iOS `ShellLogic` cases. **Android divergences, written here and on #8046:**
- iOS reads `NSURLError` codes and gets "offline" from specific codes; Android reads `WebViewClient.ERROR_*`
  codes and gets "offline" from `ConnectivityManager`, so `classify` takes an explicit `online: Boolean`.
- TLS certificate errors reach Android via `onReceivedSslError` (a different callback), so they are out of
  scope here; `ERROR_FAILED_SSL_HANDSHAKE` (the handshake failing) IS handled.
- "Cancelled / superseded" has no standard Android code, so the WebViewClient caller pre-filters
  (main-frame only, failing URL == the one it meant to load).
**Weakest part:** the `WebViewClient.ERROR_*` → category mapping is a reasoned translation of the iOS
`NSURLError` mapping; the error-code integers are declared as local constants (no Android import, so the
file is plain-JVM-testable) and must equal the real `android.webkit.WebViewClient` values — verified by the
build on a clear box.

## Next increment
The shell's link routing + tab/door brain (`AppTabs`/`PressTracker` analogs) and the board client
(sign-in/token: `BoardClient`/`SignInClient`/`SessionKeychain` analogs, token in Android Keystore /
EncryptedSharedPreferences). Then the native Compose chrome + WebView host, and the first native screen.

## Still to do in slice 1 (after the decision above)
- The shell per the hybrid-vs-native ruling: load-failure page (native), link routing, same-app upgrade check.
- Board client: sign-in + token handling (`BoardClient`/`SignInClient`/`SessionKeychain` analogs; token in
  Android Keystore / EncryptedSharedPreferences, not the iOS Keychain).
- First native Compose screen, then build + run on the box (gated), then a signed debug APK with its
  SHA-256 on the card for Josh's device.

## Build/▸machine discipline
No Gradle build runs on Mortals until `who-has-the-box.sh` / `heavy-gate` report the box clear and no cut
is in flight (#8046; handoff). This push adds source + tests only; nothing was built here.
