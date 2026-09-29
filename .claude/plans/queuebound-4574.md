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
(A hard ceiling bounds every queued wait: four bounds plus one per waiter ahead at entry (review 13), so this premise
can only delay a give-up, never prevent it, and a healthy queue k deep, about k suites long, stays inside it.) That "a waiter ahead left" means the queue moved. A waiter ahead that GIVES UP also leaves, so behind a hung suite each
waiter in turn spends one full bound (45 min) at the front before giving up. That is slower than the old 20 minutes
for the waiters behind a hung suite, and it is the price of not giving up on a healthy long queue.

## Measured (current, 1ec7f7f62)
- tools/test-cut-guard.sh: 0 failures; every #4574 arm passes.
- Each mechanism has a control that reds only its own arm (recorded per round below): the waiter-ahead reset (review
  1), the shared helper (2), the re-mark and its old queue time (5, 8), churn behind (7), the start-time pin and its
  locale half (9, 11), the ceiling and its scaling (9, 13), the empty start time (11), the four-line shape (10), the
  entry clear (9), the missing-own-marker pass (15).
- Against origin/main's cut-guard.sh the queue arms red: the moving queue gives up at call 3 (the jam).

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
  this lib run alongside; (2) a hard ceiling, KOSMOS_WAIT_QUEUE_CEIL_S (default four bounds, 3 hours; SUPERSEDED by review 13: four bounds plus one per waiter ahead at entry), ends any queued
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

## Review iteration 11 (blind, opus)
0 BLOCKER, 2 WARNING, both taken:
- (W) an empty start time from ps compared equal to an empty line 4 (an older 3-line marker), so the marker read as
  LIVE: the unsafe side, where main read it as stale. An empty start time is now stale before any comparison (a test
  stubs both helpers to print nothing; removing the check reds it).
- (W) the reviewer saw one failure in eight runs of the file and lost its output. Likely cause: the stand-in readiness
  loop gave up silently after 1 s and wrote a marker known to be stale, shifting the exact call counts. It now waits up
  to 3 s and FAILS BY NAME ("FIXTURE: stand-in waiter never showed as sleep") if the stand-in never execs. Not proven to
  be that failure: three consecutive clean runs after the change, and the next flake will name itself.
- (N, taken) run-tests.sh names the ceiling (its 3-hour wording superseded by review 13); an arm pins the default ceiling at four bounds (x5 reds it); the
  time-zone arm's writer also uses fr_FR, so the locale half of the pin is guarded (dropping LC_ALL=C reds it); the
  refusal's comment says it walks every marker.

## Review iteration 12 (blind, sonnet): nothing at BLOCKER or WARNING
Its CONVENTION line only confirms the plan exists and matches the code (not a finding). NITs taken, comments only: the
#4498 queue note now describes all four marker lines; ts says why it uses the real clock. NITs left: the first-pass
early restart (documented, bounded by the ceiling); q_ready can fail under heavy load (by name, as intended).
Because the two comment edits changed the diff, one more blind round follows.

## Review iteration 13 (blind, opus)
0 BLOCKER, 2 WARNING, both taken:
- (W) the fixed 3-hour ceiling (four bounds from entry) would END A HEALTHY QUEUE about 7 to 9 deep (k suites of 14 to
  26 min), the card's own symptom one level down, and nothing said so. The default is now four bounds PLUS ONE PER
  WAITER AHEAD AT ENTRY; KOSMOS_WAIT_QUEUE_CEIL_S still sets it outright. Arms: six ahead leaving every 60 s (360 s on
  a 60 s bound) start (a fixed ceiling cuts them at call 9); a waiter ahead whose marker flaps forever is ended at
  (4+1) x 60 = 300 s (no ceiling: 1001 calls).
- (W) the test fixtures wrote a shape no writer produces (UTC on line 3, three lines) and passed only through a reader
  clause that matched nothing in production. All eight now write the real four-line marker (local line 3, UTC line 4)
  and the dead clause is gone.
- (N, taken) the give-up line reports the wall time since the last fall when that arm fired (was slept seconds).
- (N, left) KOSMOS_WAIT_QUEUE_CEIL_S=0 gives up at once (documented; as KOSMOS_WAIT_MAX_S=0); ps calls per poll.

## Review iteration 14 (blind, sonnet)
0 BLOCKER, 2 WARNING, both taken (both SELF: a figure left behind when review 13 changed the ceiling):
- (W) run-tests.sh still said a queued suite gives up "after 3 hours in any case": it now says four bounds plus one per
  waiter ahead at entry. My own sweep for "3 hours" missed it at first: the phrase is hard-wrapped across two lines,
  so the search now uses the short tokens "hours" and "ceiling" over every added line.
- (W) the plan's round 9 and round 11 records still stated the fixed ceiling as if current: marked SUPERSEDED (kept as
  history, not rewritten).
- (N, taken) the first notice says the ceiling grows with the queue ahead at entry.
- (N, left) the refusal names the first waiter ahead in glob order, as the old code did (the message stays true).

## Review iteration 15 (blind, opus)
0 BLOCKER, 1 WARNING, taken:
- (W) a THIRD source of false restarts, where waiters BEHIND did count: another reader's failed ps can remove this
  run's own marker during the check (after the loop-top re-mark), and the count then took every waiter as ahead; the
  next pass read the drop back as a fall. A queued pass whose own marker is missing now takes no count. Arm: the check
  removes it on every even call, one waiter ahead and one behind never move: the bound runs out at call 5. Control:
  without the guard it restarted for 3335 calls until the (explicit) ceiling.
- (N, taken) the give-up line says how the ceiling was set; run-tests.sh's long line rewrapped; this Measured section is
  current.
- (N, left) stand-in waiters are not in the file's EXIT trap (they end in 5 minutes, and their markers are in the
  sandbox's marker dir).

## Review iteration 16 (blind, sonnet): CONVERGED (nothing at BLOCKER, WARNING or CONVENTION)
Its CONVENTION line only confirms the plan matches the code. NITs, left (changing code now would need another round):
the second ask's brief unmark is a known, bounded false restart (documented, capped by the ceiling);
_kosmos_pid_started_local could say it is deliberately unpinned (it is the older lib's form; follow-up); the ceiling
counts one extra waiter when one marked in the same second behind (the safe side).
Next: the full validation (tools/run-tests.sh) on the final head, through the queue, then the proof.

## After convergence: run-tests.sh stops handing the queue overrides to its tests (2026-09-29 13:06 CDT, suite deadlock)
Splinter's unstick plan had this branch's full validation run with KOSMOS_TESTS_IGNORE_SUITE=1. Baron found the
override is INHERITED (an env prefix is inherited exactly like an export) by the #4498 queue tests' own run-tests.sh,
which then skip the queue and fail ("a plain run did not queue"), so no validation run with the override could pass.
run-tests.sh now unsets KOSMOS_TESTS_IGNORE_SUITE and KOSMOS_TESTS_IGNORE_HARNESS once this run's wait has read them.
Arm: a copy of run-tests.sh (one root test file so the coverage gate passes) runs with both set and a stand-in node
first on PATH, which reports what it inherited. Control: without the unset it reports IGNORE_SEEN=1 HARNESS_SEEN=1.
The first attempt at the arm never reached node (the stray-file copy stops at the coverage gate; with no test files at
all bash 3.2's set -u calls the empty list unbound), so a green there would have meant nothing. One more blind round
follows because this is code after convergence.
