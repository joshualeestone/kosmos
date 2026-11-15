# scancpu-8544: the backupscan backtracking test times CPU, not wall time

Card: kosmos#8544 (the unexplained devbucket-8529 backup-suite red; Splinter 11-14 19:59).

## Finding (on the card)
Reproduced once in 100 runs (run 36): a machine-wide stall slowed every test. The heavy #7746 tests passed a 30 s
per-test timeout, and their work leaked into the next tests of the same file (cascade assertion failures). One check
was a genuine wall-clock limit: backupscan.test.js "#5686 review 7" read 2522 ms against 1000 ms with no regression.

## Change
That test's four timers use process.cpuUsage (user + system) instead of hrtime wall time, with the same limits, as
#7235 did for the backuprestore ratio test. The work is synchronous CPU with nothing to wait on.

## Decided
- The heavy #7746 tests are left as they are: without a per-test timeout (the default) a stall only slows them. The
  cascade under a short --test-timeout is a property of node's runner (a timed-out test is not stopped) and is written
  on the card for anyone reading such a red.
- Weakest premise: CPU time still rises on an efficiency core or with contended caches; the limits (500 and 1000 ms)
  are 10 to 100 times the clean cost (about 70 ms here) and far under the regressions (1.6 to 17 s).

## Verified
backup suite 529/529. Arms, each as predicted: a 1.2 s wall pause with no CPU (Atomics.wait) in pathDecision: the new
test PASSES and the old wall-time test FAILS; a 1.5 s busy loop: the new test FAILS; clean: passes (about 71 ms).

## Review 1 (sonnet, blind): no blocker
- W taken: a second wall-clock limit the card missed, backupagy.test.js "review 1: on an IDLE event loop": its child was
  killed at 10 s, which a stall also reaches. The failure guarded is a hang, so 60 s keeps it red (measured: a stageAgy
  that never finishes fails at 60031 ms; clean passes in 122 ms) and lets a stall pass.
- W taken: the comment says cpuUsage counts the whole process (GC, other threads), so it can only read high.
- NIT named on the card, no change: backupsnapshot.test.js 2005's 30 s bound needs a 30 s stall.
- The 100-run loop finished: 99 clean, run 36 the only red (and the only slow run, 173 s).
