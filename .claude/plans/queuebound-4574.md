# queuebound-4574: the suite queue gave up on every waiter behind a long line

Card: #4574 (filed by Splinter from my stalled queue). The card's suspect (waiting wrappers counted as busy) is
FALSIFIED, measured 10:59 to 11:01 CDT: 7 of 8 wrappers held valid suitewait markers and were skipped; the one counted
(24502) was really running (test:shell, 38 min in). Details on the card, comment 5893893227.

## Cause
The #4498 queue runs one full suite per Mac, FIFO. A waiter gave up after KOSMOS_WAIT_MAX_S=1200 s of waiting IN TOTAL,
but a full suite takes 14 to 26 min (my own START/END log, 14 runs today), so a waiter 2nd in line or later reached the
bound before its turn, ended with no validation, and rejoined at the back.

## Call (as revised by review 1)
In the suite queue only, the bound counts from the last time a live waiter AHEAD of this run left the queue
(_kosmos_suite_waiters_ahead fell). New arrivals queue behind, so the count only falls and cannot flap. The queue's default bound is 2700 s (45 min), above the longest suite measured, so the waiter at the FRONT, whose run
ahead cannot change until it ends, does not give up behind one normal suite. Outside the queue (harness, browser, cut
waits) nothing changes: 1200 s from the start.

## Rejected
- Raising the default bound for everyone: a hung suite would then hold every waiter far longer.
- Two suites at once: undoes #4498's measured reason (a suite beside a suite turns greens red); its own card if wanted.
- Counting node --test children: fixes a mechanism the measurement shows is not there.

## Weakest premise
That "a waiter ahead left" means the queue moved. A waiter ahead that GIVES UP also leaves, so behind a hung suite each
waiter in turn spends one full bound (45 min) at the front before giving up. That is slower than the old 20 minutes
for the waiters behind a hung suite, and it is the price of not giving up on a healthy long queue.

## Measured
- tools/test-cut-guard.sh on 1735710e1: 0 failures.
- CONTROL, the same tests against origin/main's cut-guard.sh: the moving queue gives up at call 3 (the jam), the
  default is 1200, three FAILs; the two non-queue controls pass on both.

## Review iteration 1 (blind, opus)
0 BLOCKER, 3 WARNING, all taken:
- (W) the signal was the refusal's first line, which names the LOWEST pid, not the blocking run's root: after pid wrap
  a suite's own subshell, or a queue-jumping harness, changes it and restarts the bound forever. REPLACED: progress is
  one fewer live waiter ahead. A test pins that a refusal whose words change every call does NOT restart the bound.
- (W) the wall-clock arm of the bound was untested (every arm slept with ':'). A clock seam (KOSMOS_WAIT_NOW) and a fake
  sleeper that advances it: a moving queue survives a 60 s bound at 100 s per step, and a stuck one gives up on the
  clock alone. Mutation (the reset no longer moves bstart): both moving-queue arms red.
- (W) the first notice said "for up to 2700s": it now says it gives up if the queue does not move for that long.
- (N) the queue note, the KNOWN RESIDUAL and run-tests.sh's two 20-minute comments are updated.
Measured on b4162a7e1: test-cut-guard.sh 0 failures; against origin/main's cut-guard.sh, five #4574 arms red.
