# flake-7556: two timing arms of tools/test-site-autodeploy-5589.sh (kosmos#7556)

The 0.7.74 cut went red at 02:45 CDT 10-29 on arms 28 and 18. Its isolated re-run was green (#2006: contention), so
this is a flake fix for after the cut. Test file only; tools/site-autodeploy.sh is unchanged.

## Changes
- Arm 28 (orphan stop) and arm 32 (leaderless group): after the tick, wait up to 10 s for the stopped pid to go
  (`gone`, 100 polls 0.1 s apart) instead of one fixed `sleep 1`, at all six such sites (22, 23, 27, 28, 29, 32). A stopped process whose parent also died is a zombie
  until launchd reaps it, and kill -0 succeeds on a zombie; on a loaded box that takes more than a second.
- Arm 18 (unreleased build mirrored): the FAIL message prints rc and the tick's output. The cut's line proved the
  tick left before its mirror but could not say why. No retry is added, so a product path that fired stays visible.

## Measured (this Mac, 10-29)
- Unpatched: 112/112 once and in each of 6 concurrent copies (neither red reproduced here).
- Patched: 112/112.
- Mutation: with the deploy script's orphan stop replaced by `true`, the patched test is red on BOTH arms (alive=yes),
  so the wait cannot hide a process the tick did not stop.

## Weakest premise
That the zombie race is what failed arm 28 on Mortals; it fits every visible fact (alive=no is the FAIL message's own
later kill -0) but was not reproduced. Arm 18's cause is unknown until it fails with the new message.

## Review rounds (ledger)
1. sonnet: 0 BLOCKER, 0 MAJOR, 3 MINOR. Fixed:
   - The same `sleep 1; kill -0` race was also in arms 22, 23, 27 and 29. All six sites now use one helper,
     `gone <pid>` (100 polls 0.1 s apart), so the class is fixed in one place. 112/112, 71 s (was 79 s: the fixed
     sleeps are gone). Mutation (orphan stop removed) still reds 28 and 32.
   - An empty pid passed the poll vacuously in 28 and 32; `gone` refuses an empty pid. Checked directly: empty is
     not gone, a live process is not gone after the polls (22 s on this busy Mac), a killed one is gone.
   Decided, not done: treating a Z-state process as stopped (exact, no wait). The wait is cheap and only paid on a
   failure path; ps state parsing would be a new thing to get wrong.
2. sonnet: 0 BLOCKER, 0 MAJOR, 0 MINOR. Converged. Confirmed every replaced condition keeps its meaning, no removed
   sleep was a wait anything other than kill -0 needed (the tick writes last-failure, the log and the lock synchronously),
   and gone() is correct under set -uo pipefail.
