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
(_kosmos_suite_waiters_ahead fell). New arrivals queue behind, so each restart needs a waiter ahead to leave or to
read as gone for one pass (review 2 and review 5 name the cases). The queue's default bound is 2700 s (45 min), above the longest suite measured, so the waiter at the FRONT, whose run
ahead cannot change until it ends, does not give up behind one normal suite. Outside the queue (harness, browser, cut
waits) nothing changes: 1200 s from the start.

## Rejected
- Raising the default bound for everyone: a hung suite would then hold every waiter far longer. (In the queue, though,
  the 45 minutes does cover every blocker run-tests.sh waits on: a release claim and an install harness as well as a
  suite, where it was 20. Stated in the #4574 note; all three are long runs, and review 3 asked for it said, not split.)
- Two suites at once: undoes #4498's measured reason (a suite beside a suite turns greens red); its own card if wanted.
- Counting node --test children: fixes a mechanism the measurement shows is not there.

## Weakest premise
(A hard ceiling, review 9, now bounds every queued wait at four bounds, 3 hours, so this premise can only delay a
give-up, never prevent it.) That "a waiter ahead left" means the queue moved. A waiter ahead that GIVES UP also leaves, so behind a hung suite each
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

## Review iteration 2 (blind, sonnet)
0 BLOCKER, 2 WARNING, both taken:
- (W) the #4498 header still said "for up to KOSMOS_WAIT_MAX_S (1200, 20 minutes)": it now names the queue's 2700 s and
  points at the #4574 note, and lists KOSMOS_WAIT_NOW as a seam.
- (W) the two new helpers sat between kosmos_wait_until_clear's doc comment and the function: moved above it.
- (N, taken) the waiters-ahead loop duplicated kosmos_refuse_if_earlier_suite_waiter's: ONE helper now lists the pids
  ahead, and the refusal (first line, via a read loop) and the bound (the count) both read it. Control: a helper that lists nobody reds the
  #4498 queue-order arms AND the #4574 moving-queue arms.
- (N, SELF, taken) "the count cannot flap" overclaimed: a waiter re-marked by the second ask raises it. The note now says
  a rise only arms the next fall, so each restart still needs a waiter ahead to leave.
- (N) the wall-clock test's name: now "three waiters leaving 100 s apart".
- (N, left) a same-second arrival with a lower pid counts as ahead; a killed run leaves sleep 300 stand-ins for 5 min.

## Review iteration 3 (blind, opus)
0 BLOCKER, 2 WARNING, both taken:
- (W) the queue's 45 minutes also covers a release claim and an install harness, never stated: the #4574 note, the plan
  and run-tests.sh's comment now say so. Kept rather than split by blocker (all three are long runs).
- (W, SELF) "gives up only when the run in front of it has held the box for the whole bound" was false (the bound runs
  from the last waiter ahead leaving): now "gives up when no waiter ahead has left for the whole bound".
- (N, taken) the give-up line says "no waiter ahead left for Ns" (the claim/harness message above it names the blocker);
  "|| true" on the two pipelines (set -e safety for a future bare caller); a clock seam printing no number falls back
  to date (a test pins it); the default-bound arms unset KOSMOS_WAIT_EVERY_S too; the refusal's comment is back above
  it; a comment on the first-pass early restart.
- (N, left) KOSMOS_WAIT_NOW runs a command from the environment, as KOSMOS_WAIT_SLEEP already does.

## Review iteration 4 (blind, sonnet)
0 BLOCKER, 1 WARNING, taken:
- (W, SELF) run-tests.sh's comment said every suite wait gives up only after 45 minutes "whatever the blocker"; a run
  that skips the suite check (the override, a run inside a test) does not queue and keeps 20 minutes from its start. The
  comment now says both.
- (N, taken) ahead defaults to 0 if the count prints nothing; the #4574 note is reflowed and names a failed ps (a waiter
  ahead read as gone for one pass) as the other way a restart can happen.
- (N, left) start only seeds bstart (kept: it reads as the wait's start); a trap to reap the stand-in waiters if the test
  file is killed mid-arm (they end on their own in 5 minutes).

## Review iteration 5 (blind, opus)
0 BLOCKER, 2 WARNING, both taken:
- (W) a failed ps makes _kosmos_suite_waiter_live REMOVE a live waiter's marker, and the waiter never re-marked: it then
  counted every waiter as ahead while the others counted it as a running suite, a mutual wait that pre-dates this card
  but now lasts up to 45 minutes. The loop now re-marks a queued run whose own marker vanished, with its old queue time
  (a test: the marker is removed after call 2 and is back, same time, on call 3; with the re-mark line removed it reds).
  The note's sentence about a failed ps (SELF) is rewritten to what the code does.
- (W, SELF) a test comment still described the retired wording signal: now says wsame is used because nothing varies.
- (N, taken) the plan's Call section no longer says "cannot flap"; the note names the second ask's brief unmark; the
  stand-in waiters are marked only after ps shows them as sleep.
- (N, left) start only seeds bstart; the refusal now walks every marker (twice a poll): negligible at 30 s.

## Review iteration 6 (blind, sonnet)
0 BLOCKER, 2 WARNING:
- (W, taken, premise narrowed) "a clock seam that exits non-zero kills a set -e caller": the helper's && list did end on
  a failing assignment, now `|| t=""`. BUT the wait only calls _kosmos_wait_now inside $( ), and bash outside POSIX mode
  does not inherit set -e there, so the reviewer's failure path is not reachable today. Measured the hard way: my first
  arm (the whole wait, under set -e) stayed GREEN with the guard removed, a test that could not fail. The arm now calls
  the helper directly under set -e: rc 3 with the guard removed, green with it.
- (W, taken as documentation) the second ask's brief unmark can read as a fall: the note now calls the restart a
  heuristic. A waiter is in its second ask only when its own check had just passed (the box was clear), so a false
  fall needs a harness to take the box in that moment; each false restart costs a queue-jumping harness. A two-sample
  filter was rejected: new state to prevent a rare, bounded restart.
- (N, taken) the bound comment said "the longer of" slept and wall time; it is whichever gets there first.
- (N, left) the give-up line's "waiting Ns" is the whole wait (can exceed the bound, next to "no waiter ahead left for
  Ns"); the wording arm runs with nobody ahead (it pins the retired signal, not the count); the refusal walks every
  marker twice a poll.

## Review iteration 7 (blind, opus)
0 BLOCKER, 1 WARNING, taken:
- (W) nothing pinned that churn BEHIND a waiter never restarts its bound; only the shared helper protected it. New arm:
  one waiter ahead that never leaves, one with a later time whose marker comes and goes each call: gives up at call 3.
  Control: counting every suitewait marker instead reds it (it restarted 4870 times and started anyway).
- (N, taken) a dead run's marker under this run's (recycled) pid is cleared on entry, so the first pass cannot read this
  run as already queued; the refusal reads the first waiter ahead with a read, not head -1 (no "Broken pipe" in its
  message); the note is reflowed and no longer says every false restart costs a harness (a failed ps does not).
- (N, taken) the re-mark arm's comment names calls 2, 3 and 4, and drops a redundant condition.
- (N, left) the front waiter's give-up line ("no waiter ahead left") is true but empty for it; the line above names the
  real blocker.

## Review iteration 8 (blind, sonnet)
0 BLOCKER, 3 WARNING, all taken:
- (W, SELF) the give-up line "no waiter ahead left for Ns" named a cause that is wrong for the front waiter (nothing was
  ever ahead). Round 3 had moved it off "the queue did not move"; now it states the rule instead of a cause: "the bound
  counts from the last time a waiter ahead left the queue". The line above still names the blocker.
- (W) a fall and an old-time re-mark in the same poll net to zero: one sentence in the note (errs toward giving up).
- (W) the re-mark arm could not tell an old queue time from a new one (no sleep, one second for every mark): wlose now
  sleeps 1 s. Control: a re-mark that takes a NEW time reds it.
- (N, taken) the plan no longer says the refusal uses head -1.
- (N, left) bstart uses the wait clock and ts the real one: ts is only a queue position, never a duration.

## Review iteration 9 (blind, opus)
0 BLOCKER, 2 WARNING, both taken:
- (W) ending a queued wait rested on the restart heuristic, and ps -o lstart prints in the READER's zone and locale
  (measured: Chicago, UTC and fr_FR all differ): a waiter in another zone or locale deleted a live marker every poll,
  its owner re-marked it every pass, and everyone behind saw endless falls. Two fixes: (1) the start time is written
  in UTC and the C locale; a marker written the older way (local) still matches, since worktrees on older copies of
  this lib run alongside; (2) a hard ceiling, KOSMOS_WAIT_QUEUE_CEIL_S (default four bounds, 3 hours), ends any queued
  wait whatever the heuristic says.
- (W) behind a hung suite the Nth waiter held about N x 45 min (8 waiters: about 6 hours): the ceiling caps it.
- (N, taken) the entry clear of a recycled-pid marker is tested; the first notice states the rule and the ceiling.
- Controls, one per mechanism: unpinned lstart reds the zone arm; no ceiling reds the ceiling arm (it started at call
  10); no entry clear reds the recycled-pid arm. The four arms not about the ceiling set it high explicitly (the
  wall-clock arm's fake clock passed the default 240 s ceiling that a 60 s bound gives).

## Review iteration 10 (blind, sonnet)
0 BLOCKER, 2 WARNING, both taken:
- (W) compatibility was one-way: this lib read older markers, but an OLDER copy (another worktree) compares line 3
  against its own local start time and would have deleted every UTC-form marker this lib wrote, the mutual wait of
  review 5 again, until its 20-minute bound. Line 3 now keeps the writer's local form (all an older reader reads) and
  the UTC form goes on a new line 4; a reader accepts line 4 (UTC), or line 3 in either form. Controls: writing UTC on
  line 3 reds the format arm; ignoring line 4 reds the time-zone arm.
- (W) the give-up line did not say which limit fired: it now gives the total wait and the time since a waiter ahead
  last left (the ceiling has its own line).
- (N, taken) `local over` is declared with the other locals; the time-zone arm explains why the writer is in Tokyo.
- (N, left) ts (queue position) uses the real clock, not the wait seam: it is a position, never a duration.
