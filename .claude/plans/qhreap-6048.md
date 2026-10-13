# #6048: the #5331 main arm's reap bound, and what it is for

**Branch:** `qhreap-6048` · **Card:** kosmos#6048 (CI flake on tools/test-queued-heavy-4977.sh, PR #6046's run 38408532993).

## Done looks like

The #5331 main arm fails when the copy's KILL-by-pid misses (the real defect) and does not fail because a CI runner is slow.

## What the failing job showed

Job 115334600486, the arm's own lines: the side turn started at 14:11:23, the payload was killed ("Killed: 9" on the copy's `"$@"`), and the arm then waited `reap $w 60` (60 polls of 0.25 s, 15 s) for the wrapper to exit. The log's last lines had neither "claim released" nor "did not stop", so the wrapper's teardown had not finished within 15 s. From the side turn starting to the verdict was 46 s, on a runner running a whole shard.

## Ruled out, measured

A killed command left as an unreaped zombie, which would keep `_qh_end`'s `kill -0 -- "-$CMD"` loop waiting 10 s: on macOS bash reaps a killed background child at once, and `kill -0` on the group fails straight away (scratch probe, both before and after an explicit wait).

## What the red was, and why this is a diagnosis, not a cure

**Not established.** Two causes fit the CI log, and it cannot tell them apart: a runner slow enough to stretch a ~1 s release past 15 s (over 15 times slower, which is a lot), or the KILL-by-pid really missing once on that runner. A missed KILL leaves `_qh_stop_capper` waiting out its 10 s loop (longer if the test's TERM lands mid-teardown; the exact path was not measured) before it says "did not stop" and releases. The old 15 s bound could cut the arm off before that line, so the red said neither. Measured here: with the KILL-by-pid removed, the teardown took exactly 15 s.

**So this change makes the next red say which.** With 30 s, a missed KILL ends in "did not stop", which the arm refuses, so it stays red and names itself; a slow release passes and shows its time. The card stays open until a run says which it was.

## The change

- `side5331` takes its reap bound as a third argument and records the teardown's seconds in `$m.t`.
- The main arm gets 120 polls (30 s); the control keeps 60 (15 s), because its old teardown waits for ever and a longer bound would only slow every run.
- The main arm's line now says how long the teardown took ("teardown N s of 30"), so a future red says which shape it was.

## Shown

- As committed, the whole file: 105 OK, the arm "teardown 1 s of 30".
- With `_qh_stop_capper`'s `kill -KILL "$CAPPER"` removed from tools/queued-heavy.sh: the main arm is BAD ("got 0 ... teardown 15 s of 30"), caught by its "did not stop" check. Restored after.

## Weakest premise

That a missed KILL ends within 30 s (measured here at 15 s; the 10 s loop plus other waits). If it ever does not, the arm reds as "not done after 30 s", which is still the defect's shape, not a false pass.
