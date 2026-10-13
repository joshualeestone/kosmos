# #6048: the #5331 main arm's reap bound, and what it is for

**Branch:** `qhreap-6048` · **Card:** kosmos#6048 (CI flake on tools/test-queued-heavy-4977.sh, PR #6046's run 38408532993).

## Done looks like

The #5331 main arm fails when the copy's KILL-by-pid misses (the real defect) and does not fail because a CI runner is slow.

## What the failing job showed

Job 115334600486, the arm's own lines: the side turn started at 14:11:23, the payload was killed ("Killed: 9" on the copy's `"$@"`), and the arm then waited `reap $w 60` (60 polls of 0.25 s, 15 s) for the wrapper to exit. The log's last lines had neither "claim released" nor "did not stop", so the wrapper's teardown had not finished within 15 s. From the side turn starting to the verdict was 46 s, on a runner running a whole shard.

## Ruled out, measured

A killed command left as an unreaped zombie, which would keep `_qh_end`'s `kill -0 -- "-$CMD"` loop waiting 10 s: on macOS bash reaps a killed background child at once, and `kill -0` on the group fails straight away (scratch probe, both before and after an explicit wait).

## Why the bound was the wrong instrument

Every step of the copy's teardown is bounded: `_qh_stop_capper`'s loop at 40 polls of 0.25 s (10 s), plus a few `ps` and `pgrep` calls, `_qh_kill_desc` and a file removal. When the KILL misses, the copy prints "did not stop" after that loop and still releases the claim, and the arm already refuses a log containing "did not stop". So the defect is caught by that line, and the 15 s bound only added a race with a loaded runner. Measured: with the KILL-by-pid removed, the teardown took exactly 15 s, the old bound.

## The change

- `side5331` takes its reap bound as a third argument and records the teardown's seconds in `$m.t`.
- The main arm gets 120 polls (30 s); the control keeps 60 (15 s), because its old teardown waits for ever and a longer bound would only slow every run.
- The main arm's line now says how long the teardown took ("teardown N s of 30"), so a future red says which shape it was.

## Shown

- As committed, the whole file: 105 OK, the arm "teardown 1 s of 30".
- With `_qh_stop_capper`'s `kill -KILL "$CAPPER"` removed from tools/queued-heavy.sh: the main arm is BAD ("got 0 ... teardown 15 s of 30"), caught by its "did not stop" check. Restored after.

## Weakest premise

That 30 s covers the worst a loaded runner does to a teardown bounded at about 10 s. If a runner is ever three times slower than this one was, the arm reds again, and its message will now say how long it took.
