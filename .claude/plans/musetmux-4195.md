# musetmux-4195: musesignin uses the shared hidden-tmux plumbing (kosmos#4195, step 2)

## Problem
engine/musesignin.js kept its own copies of what engine/tmuxsignin.js already holds for agysignin, so a fix to one would miss the other.

## Change
musesignin takes homeSocket, live, runTmux, deliveryUnknown, shq, tmuxBin and forgetTmuxBin from tmuxsignin. Its test file and agysignin's are unchanged, as the card asked. The guard in tmuxsignin.test.js now lists musesignin.

## Weakest premise
That the copies were identical. Compared by eye, and the two test files pass unchanged. One behaviour change follows from sharing: the tmux path cache is now shared, so one sign-in's forgetTmuxBin clears it for both, which tmuxsignin.js already documents as intended.

## Verification
agysignin and musesignin tests unchanged, 101 passing. Reverting musesignin.js makes the guard fail.
