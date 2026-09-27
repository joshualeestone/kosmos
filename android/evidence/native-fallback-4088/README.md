# Native load fallback evidence

Captured on the `kosmos718` emulator on 2026-09-26 with the upload-key signed release APK.

- `main-chrome-offline.png`: control from `origin/main` with Android airplane mode enabled. The resumed surface is Chrome's Custom Tab and the screen says `You're offline` and `Running in Chrome`.
- `native-offline.png`: the branch cold-started with airplane mode enabled. `am start -W` reports `.LoadErrorActivity`, and the screen is the native Kosmos error page with Retry.
- `native-failed-load.png`: with connectivity available, the launcher was explicitly opened at `https://not-a-real-kosmos-host.invalid/`. Chrome reported a failed top-level navigation through the Custom Tabs callback, and `dumpsys activity` reports `.LoadErrorActivity` as the top resumed activity.
- `retry-success.png`: after the offline capture, connectivity was restored and Retry was tapped. The failed task was replaced with a fresh launch and the Kosmos+ sign-in page painted successfully.

The release build completed with `:app:assembleRelease`, including `lintVitalRelease`, and installed over the existing upload-key build without a signature mismatch.
