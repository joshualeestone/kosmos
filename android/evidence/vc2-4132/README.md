# Android vc2 update evidence (#4132)

Captured on the API 35 Moto G Play 2024 AVD from signed APK commit
`a936fb83facd46a945f94ae12cfba14a80d5f511`.

The AVD first reported `io.kosmos.app` versionCode 1. The signed vc2 APK was
installed with `adb install -r`, without uninstalling vc1, and package manager
then reported versionCode 2, versionName 0.1.1.

- `signin-vc2.png` shows the live Kosmos+ sign-in page after the update.
- `offline-vc2.png` shows the native Kosmos offline page and Retry button after
  airplane mode was enabled and Wi-Fi and mobile data were disabled. The resumed
  activity was `io.kosmos.app/.LoadErrorActivity`, not Chrome.

Screenshot SHA-256 values:

- `signin-vc2.png`: `31fed2671373b239f5a97ca4c0ba6d73b5675f16dfcabd65d09c3d8c1d2d22d6`
- `offline-vc2.png`: `e41420423046f5c88f42ebf721f98cab1161376ea16a5a0244727b5c568f5bc3`

Networking was restored after the offline capture. The AVD was left running and
explicitly handed to Kano for #4140.
