# Moto G Play 2024 performance baseline attempt

Issue #4090 asked for a measured Android 14 performance bar matching a Moto G Play 2024 as closely as the emulator allows. The requested emulator was created, but the bundled Chrome browser crashes repeatedly in its compositor under both tested graphics backends. This prevents a trustworthy Android 14 baseline.

The Android 14 environment failure is tracked in #4100. It is not evidence of a Kosmos application crash. A time-boxed Android 15/API 35 retry with identical screen, density, memory, and CPU constraints ran cleanly and produced the provisional measurements below.

## Test environment

Before every timing run, require a quiet machine with `bash tools/heavy-gate.sh
--twice --quiet-box --except-cwd <measurement-worktree>`. The `--quiet-box` option also
detects full validation suites, whose CPU load can otherwise distort plausible-looking
emulator timings while the ordinary heavy gate reads clear.

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

## Provisional Android 15 baseline

The API 35 Google Play ARM64 image ships Chrome 124.0.6367.219. It completed first-run setup, rendered the sign-in page, and completed seven cold launches without any fatal entry in Android's crash buffer.

This is Android 15, not the requested Android 14. The screen, density, memory, CPU allocation, APK, and host-GPU renderer remained the same.

| Run | Launch state | `am start -W` TotalTime | `am start -W` WaitTime | Detected sign-in paint |
| ---: | --- | ---: | ---: | ---: |
| 1 | COLD | 411 ms | 413 ms | 3,519 ms |
| 2 | COLD | 431 ms | 454 ms | 3,516 ms |
| 3 | COLD | 834 ms | 841 ms | 3,077 ms |
| 4 | COLD | 362 ms | 373 ms | 3,142 ms |
| 5 | COLD | 426 ms | 428 ms | 2,904 ms |
| 6 | COLD | 829 ms | 837 ms | 3,508 ms |
| 7 | COLD | 1,118 ms | 1,138 ms | 3,837 ms |
| **Median** |  | **431 ms** | **454 ms** | **3,508 ms** |

Each run force-stopped both `io.kosmos.app` and `com.android.chrome`, waited two seconds, then started the TWA. Sign-in paint was detected independently from `am start -W` by polling screenshots and comparing a fixed crop containing the static sign-in heading with a known rendered reference. Screenshot polling adds measurement granularity, so the paint result should be read to roughly the nearest few hundred milliseconds.

The roughly three-second gap between Android activity handoff and visible sign-in confirms that `am start -W` is not the user-visible launch time for this TWA.

### Frame statistics

One additional cold launch after `dumpsys gfxinfo com.android.chrome reset` produced:

- 29 total frames rendered;
- 11 janky frames, 37.93 percent;
- 50th percentile 23 ms, 90th 113 ms, 95th 150 ms, and 99th 600 ms;
- 6 missed vsync events;
- 36 high-input-latency events;
- 7 slow UI-thread frames;
- 8 slow issue-draw-command frames;
- 0 slow bitmap uploads.

The full output is in `api35-gfxinfo.txt`. This is a short cold-start sample on an emulator, so it is evidence of visible launch jank, not a substitute for the physical Moto result.

### Fit and interaction

The Android 15 sign-in page fits fully at 720 by 1600 and 268 dpi. The card, field, button, and link are readable and uncut. A horizontal swipe across the page left a static logo-and-heading crop byte-identical before and after, supporting that the page does not move sideways.

## Evidence index

- `host-gpu-stability.png`: clean 720p sign-in frame captured after host-GPU compositor retries.
- `chrome-compositor-crash.txt`: first concise host-GPU SIGSEGV trace.
- `chrome-keeps-stopping.png`: visible browser failure under SwiftShader.
- `signin-after-20s.png`: delayed sign-in paint under SwiftShader.
- `signin-baseline.png`: splash still present eight seconds after the warm activity handoff.
- `cold-probe.png`: failed cold-probe state.
- `first-launch.png`: Chrome first-run screen before Use without an account was selected.
- `api35-first-launch.png`: Chrome 124 splash on the first API 35 TWA launch.
- `api35-after-20s.png`: Chrome 124 first-run choice before selecting Use without an account.
- `api35-signin.png`: clean API 35 sign-in page at the target dimensions.
- `api35-cold-1.png` through `api35-cold-7.png`: the detected sign-in-paint frame for each measured cold run.
- `api35-gfxinfo.txt`: full Chrome frame statistics from the additional cold launch.
- `api35-before-horizontal-swipe.png` and `api35-after-horizontal-swipe.png`: fit evidence around the horizontal interaction check.

## Next valid measurement

Repeat on Josh's physical Moto G Play 2024 when it arrives. The phone is the true performance bar and will remove emulator host-renderer effects. Keep the APK fixed and use the same separation between Android activity handoff and actual sign-in paint.
