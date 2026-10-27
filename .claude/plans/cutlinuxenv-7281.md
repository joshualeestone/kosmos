# cutlinuxenv-7281: the cut's KOSMOS_CUT_LINUX must not reach its own suite (kosmos#7281)

## Why
The 0.7.71 staging cut (the first with the Linux family) ran `KOSMOS_CUT_LINUX=1 ... release.sh 0.7.71` and aborted
at step 3: tools.release-gate.test.js red 9, red alone 3 times. The exported variable reached step 3's suite, and the
test's nested `release.sh` runs (run_git) took it, cut the Linux family on a sandbox channel, and stopped at
1d-linux ("cut on the staging channel only until promote-channel.sh moves its pointer..."). Same class as 0.7.25's
KOSMOS_CUT_CHANNEL leak, which the file already strips. Reproduced locally: with the variable exported the file
is 55 pass / 9 fail, the same nine.

## Change
1. tools/release.sh: `unset KOSMOS_CUT_LINUX` right after `release_linux_decide` (the decision lives in CUT_LINUX
   from there; nothing else reads the variable, checked with a grep of tools/). Root cause: the suite never sees it.
2. tools.release-gate.test.js: sandboxEnv deletes it and run_git strips it (as KOSMOS_CUT_CHANNEL), so the file is
   safe run by hand with the variable exported.
3. tools/test-release-linux-7281.sh: asserts the unset sits after the decision and before step 3.

## Proof
- `KOSMOS_CUT_LINUX=1 node --test tools.release-gate.test.js`: 55/9 before, 64/0 after.
- test-release-linux-7281: 68/0; with the unset removed, the new check reds (67/1).
