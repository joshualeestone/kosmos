# rerunbudget-5907: a cut re-runs the whole suite once, not three times (kosmos#5907 follow-up 2)

## Problem
When a cut's suite goes red with node reporting 0 failing tests, `kosmos_whole_suite_rerun_verdict`
(tools/lib/cut-rerun-guard.sh) re-runs the whole `yarn test` up to `max` times, sharing the file-by-file path's
budget (release.sh passes none, so 3). Its comment priced each attempt at "~2 min". A full suite is 30 to 36 min now,
run while the cut holds the box, so a real red costs up to three suites before the cut aborts.

## Measured
Every cut log on Agent1s that reached this path (grep for "isolation-rerun: re-running 'yarn test' ALONE"), six cuts,
10-07 to 10-08: cut-0729, cut-0742 (aborted for another reason later), cut-0726 PASSED on attempt 1; cut-0707,
cut-0708, cut-0723 stayed red on attempts 1, 2 and 3. **Attempts 2 and 3 changed no verdict**; each real red paid two
extra suites.
Also ~/.claude/logs/cut-suite-runs.log (last written 09-27; found by review iteration 7, counted here): five more
whole-suite reruns, all "still red alone" on attempts 1/3, 2/3 and 3/3, zero passes (some may be retries of one version). Eleven cut runs in all: 3 passed on
attempt 1, 8 real reds paid two extra suites each, no attempt 2 or 3 ever passed.

## Change
- The whole-suite path has its own budget, `KOSMOS_SUITE_RERUN_MAX`, default 1. The file-by-file path keeps `max`.
- The COST comment states the measurement instead of "~2 min"; the seams list names the new variable.
- tools/test-cut-rerun-guard.sh: the transient (red then green) and errexit multi-attempt arms set the budget
  explicitly (3 and 2); a new arm pins the default: a command that would pass on a second try aborts after one run,
  with no max passed, as release.sh calls it.

## Probe (both arms)
A command red on its first run and green after: this branch, rc 1 after 1 run; origin/main, rc 0 after 2 runs.

## Weakest premise
Six cuts. The leniency given up is real: contention that clears on a second attempt now aborts the cut, and a re-cut
costs more than one suite. None of the six showed it; all three real reds paid two wasted suites. What would change
my mind: a cut log where attempt 2 or 3 passed.
