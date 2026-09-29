# queuebound-4574: the suite queue gave up on every waiter behind a long line

Card: #4574 (filed by Splinter from my stalled queue). The card's suspect (waiting wrappers counted as busy) is
FALSIFIED, measured 10:59 to 11:01 CDT: 7 of 8 wrappers held valid suitewait markers and were skipped; the one counted
(24502) was really running (test:shell, 38 min in). Details on the card, comment 5893893227.

## Cause
The #4498 queue runs one full suite per Mac, FIFO. A waiter gave up after KOSMOS_WAIT_MAX_S=1200 s of waiting IN TOTAL,
but a full suite takes 14 to 26 min (my own START/END log, 14 runs today), so a waiter 2nd in line or later reached the
bound before its turn, ended with no validation, and rejoined at the back.

## Call
In the suite queue only, the bound counts from the last change in the first line of the refusal (a different suite
running, a different waiter ahead): a moving queue restarts it, the same run ahead for the whole bound still gives up.
The queue's default bound is 2700 s (45 min), above the longest suite measured, so the waiter at the FRONT, whose run
ahead cannot change until it ends, does not give up behind one normal suite. Outside the queue (harness, browser, cut
waits) nothing changes: 1200 s from the start.

## Rejected
- Raising the default bound for everyone: a hung suite would then hold every waiter far longer.
- Two suites at once: undoes #4498's measured reason (a suite beside a suite turns greens red); its own card if wanted.
- Counting node --test children: fixes a mechanism the measurement shows is not there.

## Weakest premise
That the refusal's first line is a faithful "who am I waiting on". Measured: every refusal this wait can print (machine
claim, suite live, harness live, earlier waiter) names its blocker and carries no counter. A future refusal with a
clock or a count in its first line would read as a queue that always moves, and that waiter would never give up.

## Measured
- tools/test-cut-guard.sh on 1735710e1: 0 failures.
- CONTROL, the same tests against origin/main's cut-guard.sh: the moving queue gives up at call 3 (the jam), the
  default is 1200, three FAILs; the two non-queue controls pass on both.
