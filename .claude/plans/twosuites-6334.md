# twosuites-6334: two test suites at once on one Mac

Card: #6334 (fleet waiting). Owner: Angel. Splinter 18:40 CDT: "reversible so it is yours, build it now".

## Done means
`tools/run-tests.sh` starts beside one other live suite by default (KOSMOS_SUITE_MAX, default 2) and waits for one to
finish when two are live. An install harness, a queued-heavy turn and a release cut still wait for no suite at all.
KOSMOS_SUITE_MAX=1 makes the run that sets it wait until no other suite runs; it does not change anyone else's run. One suite seen as several processes (a bash subshell keeps its parent's
command line) counts once.

## Evidence the change rests on
Card comment 6226744143: inside one queued-heavy turn on the 12-core Mac, two full suites on origin/main d272b3dc38
ran side by side with KOSMOS_TESTS_IGNORE_SUITE=1. Both exited 0 (21287 node tests, 0 failures, shell stages too),
about 34 minutes each against 30 alone. The collisions behind the one-suite rule (#4410 suite beside the install
harness; #4498 three suites on Mortals, 2026-09-28) did not reproduce.

## Steps
1. [x] tools/lib/cut-guard.sh: kosmos_refuse_if_suite_live takes an optional third argument, how many OTHER live
   suites are allowed (default 0, so every existing caller is unchanged). New _kosmos_suite_roots keeps one line per
   suite tree. KOSMOS_SUITE_MAX joins KOSMOS_WAIT_CONTROL_VARS so no test inherits it.
2. [x] tools/run-tests.sh: reads KOSMOS_SUITE_MAX (default 2, also when set empty; anything not one to three digits, or 0, reads as 1, so 1000 and 0003 are 1;
   "08" is 8, not an octal error) and passes max - 1 to the suite check.
2b. [x] tools/run-tests.sh: a Mac-wide cap file, suite-max in the run-marker dir, lowers the limit for every run
   (never raises it; junk reads as 1).
3. [x] tools/test-cut-guard.sh: unit arms (one allowed beside one; default still refuses; a third waits for two;
   a parent and its child count once; roots keep the parent; two separate suites stay two; junk allowance is 0),
   end-to-end arms through run-tests.sh (beside one it reaches the harness check; beside two it refuses; 1, 0, x
   1000 and 0003 read as one at a time; 08 allows two others). The #4498 one-at-a-time arms now pin KOSMOS_SUITE_MAX=1.

## Decided, not missed
- queued-heavy.sh is NOT changed. Its turns hold the machine claim, which stays exclusive: a browser-check proof, a
  relay cargo build or a suite run through queued-heavy still runs alone. Only suites started directly
  (yarn test, bash tools/run-tests.sh) gain the second slot. Widening the machine claim touches release cuts.
- Queue order is unchanged (FIFO): a queued-heavy waiter ahead of a second suite still goes first, so pairs of
  suites cannot starve heavy turns. A directly started install harness is not in that queue, but it marks itself
  before it waits (test-install.sh, kosmos_mark_run harness) and every suite refuses beside a live harness, waiting or
  not, so no new suite starts while it waits and the running ones drain to zero. Reasoned from the code, not run.
- A candidate that exits between the waiter filter and the roots walk can make one poll refuse with no suite left.
  That is the refusing side and clears on the next poll; accepted.
- Two runs starting together beside one live suite cannot both start: each is a live run-tests.sh before it asks,
  so whichever asks second sees the first and waits.
  A queued waiter is dropped from the count while marked, so a run that does not queue (KOSMOS_NO_WAIT, a --side
  turn) can pass in the moment the head waiter's first ask passes; the waiter then unmarks and asks again, sees it,
  and goes back to waiting (that second ask is #4498's). The limit holds; the waiter loses its turn once. (Iteration 10 raised it; iteration 5 had shown it unreachable.)
- When every candidate is gone between the waiter filter and the roots walk, the list as it was is counted (refuses
  one 30 s poll). Kept: an empty roots walk is otherwise indistinguishable from a failed one, and failing closed is
  the rule here. The roots walk is O(n^2) ps walks for n candidates; n is a handful today.
- An install harness (or a cut) started directly waits outside the queue with its own 20-minute bound. Beside a
  staggered pair it waits for the later suite (about 34 minutes paired), so it can give up where it would have
  started beside one suite. A longer wait, not starvation; left as is and named for the post-merge watch.
- No fixed-port guard test. Surveyed: no *.test.js calls listen() on a literal port, and the shell tests' literal
  KOSMOS_PORT values (17777, 19999, 65000) feed stubs, a mocked curl or an uninstall, none binds. A regex guard
  would have nothing real to catch and could only pass vacuously or flag those false hits.
- Default 2 everywhere, not only on this Mac. Weakest premise: one measured pair, one commit, one machine. Mortals
  has not been measured with two. Rollback for the whole Mac at once: `echo 1 > ~/.cache/kosmos-run-markers/suite-max`. Every run with this
  code reads that file, whatever tree it runs from, and it can only lower the limit (junk reads as 1). The variable
  only governs the run that sets it, and reverting the default reaches a tree only once it rebases, so the file is
  the switch to use on a collision.

## After merge
Log the first paired runs on #6334 (wall time and any red that appears only under a pair). On the first collision,
write 1 to the suite-max file at once, then change the default back to 1 in a PR.
