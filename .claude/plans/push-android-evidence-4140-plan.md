# push-android-evidence-4140

Card: kosmos #4140 (prove an Android push on the Moto AVD, then design only).

## Finished looks like
android/evidence/push-4140/ holds the prompt, notification, and tap screenshots from the
Moto AVD run with a README that states provenance (APK hash, how the local coordinator was
reached, revert of device changes) and the three findings, each marked measured or reasoned:
1. delegation works (usagestats: posted by io.kosmos.app);
2. small icon is Chrome's because androidx.browser decodes the vector SMALL_ICON with
   BitmapFactory (reasoned from bytecode, not yet measured with a fix);
3. tap opens Chrome because sw.js opens the address with no #2854 nonce.

## Scope
Evidence only, no code change. The tap design goes on the issue, not in this PR.
