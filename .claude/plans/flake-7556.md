# flake-7556: two timing arms of tools/test-site-autodeploy-5589.sh (kosmos#7556)

The 0.7.74 cut went red at 02:45 CDT 10-29 on arms 28 and 18. Its isolated re-run was green (#2006: contention), so
this is a flake fix for after the cut. Test file only; tools/site-autodeploy.sh is unchanged.

## Changes
- Arm 28 (orphan stop) and arm 32 (leaderless group): after the tick, wait up to 10 s for the stopped pid to go
  (kill -0 polled every 0.1 s) instead of one fixed `sleep 1`. A stopped process whose parent also died is a zombie
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
