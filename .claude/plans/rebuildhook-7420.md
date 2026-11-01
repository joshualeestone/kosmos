# rebuildhook-7420: the rebuild check's hook waits for all the recovery asks for

Card: kosmos#7420. CI on #7708 read "sample rebuilt 0": testRebuiltListShowsTheNewestMessage's hook ran the recovery while its decision
gave no rebuild. It had waited only for the newest; Board.emptyRecovery also needs nobody scrolling and the place "within".

## Finished looks like
The hook (Debug only) waits up to 15 s for all three, then runs the real recovery. Release is unchanged. The check goes on counting, so
it still fails if a real rebuild does not happen once.

## Decided
Wait on the same inputs recoverEmpty reads. Rejected: rerunning the job, which hides a flake that reaches every iOS PR.

## Weakest premise
That the two reds were this cause: a run with 0 does not say which input was missing. If the place never reads within in 15 s, the check
still fails, which is right.
