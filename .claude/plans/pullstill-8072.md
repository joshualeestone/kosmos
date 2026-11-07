# pullstill-8072: the end-pull tests wait for a long chat to finish opening (kosmos#8072)

## Problem
PR #8148's UI job went red on two EndPullUITests, on a PR that touches no chat. The landed row was 103 pt from where it
started, the same 103 pt the test's own comment recorded this afternoon: a long chat can still be finishing its open
after a still moment. One test guarded that with a fixed 3 s sleep, the other with nothing.

## Finished means
Both long-chat tests pull only after the row has stopped moving, however slow the runner.

## Change
Test only: `openFinished`, which waits until the row has not moved for 6 s, up to 45 s. No app code.

## Decided
- Rejected: a longer fixed sleep (still a guess, and slow on a fast runner), and widening the 20 pt tolerance (would hide a real bounce failure).
- It gives up at 45 s and goes on rather than failing: the assertions after it still decide.

## Weakest premise
That this is the cause. It rests on the matching 103 pt and on a same-run test skipping itself as too slow to measure, not
on a reproduction. A red again after this means the cause is elsewhere, perhaps in the app: read the bundle.
