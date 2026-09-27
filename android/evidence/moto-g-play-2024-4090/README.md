# Moto G Play 2024 performance baseline attempt

Issue #4090 asked for a measured Android 14 performance bar matching a Moto G Play 2024 as closely as the emulator allows. The requested emulator was created, but the bundled Chrome browser crashes repeatedly in its compositor under both tested graphics backends. This prevents a trustworthy cold-start, first-paint, or jank baseline.

The environment failure is tracked in #4100. It is not evidence of a Kosmos application crash.

## Test environment

| Property | Verified value |
| --- | --- |
| AVD | `moto-g-play-2024` |
| Image | Android 14/API 34, Google Play, ARM64 |
| Resolution | 720 by 1600 physical pixels |
| Density | 268 dpi |
| Memory | 4,017,048 kB reported by the guest |
| CPU allocation | 2 cores |
| ABI | `arm64-v8a` |
| Chrome | 113.0.5672.136 |
| Test APK SHA-256 | `04e1bd7df346d2b9f9446be8be23373fb993570845bde817fe84cdd8c3e3eac7` |
| APK launcher | `com.google.androidbrowserhelper.trusted.LauncherActivity` |

The first clean emulator boot took 138 seconds. The supplied APK installed successfully.

## Blocker

With `-gpu swiftshader_indirect`, Chrome's privileged compositor process repeatedly received SIGSEGV on its `CompositorGpuTh` thread. The stack is in the image's Trichrome `libmonochrome_64.so`. The browser displayed a Chrome keeps stopping dialog, retried, and sometimes rendered the sign-in page after a long delay.

The same failure reproduced after a fresh gated boot with `-gpu host`, which selected the Apple M4 Pro through MoltenVK. Six fatal compositor signals occurred during one 25-second launch. The concise host-GPU trace is in `chrome-compositor-crash.txt`.

## Invalid timing observations

These observations demonstrate why the requested numbers cannot be reported as a performance baseline:

| Renderer | Launch state | TotalTime | WaitTime | What happened afterward |
| --- | --- | ---: | ---: | --- |
| SwiftShader | WARM | 2,133 ms | 2,137 ms | Gold splash remained at 8 seconds; sign-in appeared around 20 seconds amid compositor failures. |
| SwiftShader | COLD | 375 ms | 379 ms | Chrome crash dialog appeared by 12 seconds. |
| Host GPU | COLD | 270 ms | 275 ms | First compositor SIGSEGV occurred about 2 seconds after process start; six fatal signals were logged in 25 seconds. |

`am start -W` measures the Android activity handoff here, not the sign-in page's paint. A median of these values would be precise but false. `dumpsys gfxinfo` would likewise include repeated browser process deaths and retries, so no jank percentage is claimed.

## 720p layout observation

`host-gpu-stability.png` captures the sign-in page at the requested physical 720 by 1600 and 268 dpi after Chrome recovered enough to paint. In that frame:

- the full card, email field, primary action, and create-account link fit within the viewport;
- no content is cut off horizontally;
- no horizontal scrollbar is visible;
- body text and controls are legible at the target density.

This is valid static fit evidence, but not stability or performance evidence.

## Evidence index

- `host-gpu-stability.png`: clean 720p sign-in frame captured after host-GPU compositor retries.
- `chrome-compositor-crash.txt`: first concise host-GPU SIGSEGV trace.
- `chrome-keeps-stopping.png`: visible browser failure under SwiftShader.
- `signin-after-20s.png`: delayed sign-in paint under SwiftShader.
- `signin-baseline.png`: splash still present eight seconds after the warm activity handoff.
- `cold-probe.png`: failed cold-probe state.
- `first-launch.png`: Chrome first-run screen before Use without an account was selected.

## Next valid measurement

Repeat the same profile on a trusted API 34 Google Play image with a current stable Chrome, or on Josh's physical Moto G Play 2024. Keep the APK and hardware constraints fixed, collect at least five cold runs, measure actual sign-in paint separately from `am start -W`, and collect `dumpsys gfxinfo com.android.chrome framestats` only after confirming the browser process remains stable.
