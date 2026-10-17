# twosuites-6334: two test suites at once on one Mac

Card: #6334 (fleet waiting). Owner: Angel. Splinter 18:40 CDT: "reversible so it is yours, build it now".

## Done means
`tools/run-tests.sh` starts beside one other live suite by default (KOSMOS_SUITE_MAX, default 2) and waits for one to
finish when two are live. An install harness, a queued-heavy turn and a release cut still wait for no suite at all.
KOSMOS_SUITE_MAX=1 restores one at a time. One suite seen as several processes (a bash subshell keeps its parent's
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
2. [x] tools/run-tests.sh: reads KOSMOS_SUITE_MAX (default 2, also when set empty; junk or 0 reads as 1; "03" is 3,
   not octal) and passes max - 1 to the suite check.
3. [x] tools/test-cut-guard.sh: unit arms (one allowed beside one; default still refuses; a third waits for two;
   a parent and its child count once; roots keep the parent; two separate suites stay two; junk allowance is 0),
   end-to-end arms through run-tests.sh (beside one it reaches the harness check; beside two it refuses; 1, 0, x
   read as one at a time; 03 allows two others). The #4498 one-at-a-time arms now pin KOSMOS_SUITE_MAX=1.

## Decided, not missed
- queued-heavy.sh is NOT changed. Its turns hold the machine claim, which stays exclusive: a browser-check proof, a
  relay cargo build or a suite run through queued-heavy still runs alone. Only suites started directly
  (yarn test, bash tools/run-tests.sh) gain the second slot. Widening the machine claim touches release cuts.
- Queue order is unchanged (FIFO): a queued-heavy waiter ahead of a second suite still goes first, so pairs of
  suites cannot starve heavy turns.
- No fixed-port guard test. Surveyed: no *.test.js calls listen() on a literal port, and the shell tests' literal
  KOSMOS_PORT values (17777, 19999, 65000) feed stubs, a mocked curl or an uninstall, none binds. A regex guard
  would have nothing real to catch and could only pass vacuously or flag those false hits.
- Default 2 everywhere, not only on this Mac. Weakest premise: one measured pair, one commit, one machine. Mortals
  has not been measured with two. Rollback is one variable (KOSMOS_SUITE_MAX=1) or a one-line revert.

## After merge
Log the first paired runs on #6334 (wall time and any red that appears only under a pair). Drop the default to 1 on
the first collision.
