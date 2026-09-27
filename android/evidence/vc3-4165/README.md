# Android vc3 update evidence (#4165)

Built and captured from main commit
`8a3decc0202b99f407eb0ec0f5cc4fb56874102b`. Ancestry checks establish that
this commit contains the browser warmup from #4148, the vc3 version bump from
#4166, the notification icon fix from #4172, and the push-tap fix from #4178.

The signed release build completed both `assembleRelease` and `bundleRelease`,
including signing validation and release lint.

- APK SHA-256: `f8163e689ae0da5713197a35fa888bbd6646c02e0e8e4179df7559983aaa05dc`
- AAB SHA-256: `f3df3d1a864a809c6c1d01ae5338d89147c1e819c224c0ad92f5959d199f4a88`
- Package: `io.kosmos.app`
- Version: versionCode 3, versionName 0.1.2
- APK and AAB signer SHA-256: `21:4A:61:04:67:09:08:20:B0:05:DC:40:D9:EC:EE:09:65:84:44:2E:40:AB:0F:DC:0F:EF:32:E6:EC:43:78:E8`, matching vc1 and vc2

The API 35 Moto G Play 2024 AVD first reported versionCode 2 and versionName
0.1.1. `adb install -r` installed vc3 successfully without uninstalling vc2,
after which package manager reported versionCode 3 and versionName 0.1.2.

- `signin-vc3.png` shows the live Kosmos+ sign-in page in the app with no URL bar.
- `offline-vc3.png` shows `io.kosmos.app/.LoadErrorActivity`, with the native
  “Kosmos couldn’t open” message and Retry button after networking was disabled.

Screenshot SHA-256 values:

- `signin-vc3.png`: `683f769cad0c619bc16e041eab49e42ccb4d856f66f15a90a38d67e507d9b77a`
- `offline-vc3.png`: `29632f4b060dad0fad09f660b1ce36791c3c475bafd394dba4ea22ab53badadc`

Networking was restored after the offline capture. The real push and Kosmos-icon
shade capture through the #4140 local setup are pending the coordinated AVD turn.
