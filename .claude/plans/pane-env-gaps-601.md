# pane-env-gaps-601 - the three small gaps #587's challenge loop recorded but did not fix

Card: kosmos#601 (three gaps Angel recorded at iteration 5 of the #587 challenge loop,
"recorded rather than fixed because the loop was bounded there"). Each is a few-line
hardening of the pane-environment test / witness. Verified all three still present on
current main before fixing.

## Gap 1 - engine/create.test.js pane-environment test

The SET case loops the four launch `branches` (claude/codex x model/no-model); the UNSET
and EMPTY cases ran only the default line (claude, no model). So a codex or model launch
line that grew a hardcoded `-e VAR=$VAR` beside PANE_ENV would ride an empty value into
the pane and the test would stay green. Fix: cross the two env cases with the same
`branches` array. The renderer preference (CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN) is
claude-only, so it is excluded from the "nothing rides" check and asserted-present
per-runner (mirroring the set case's `expected.push`), not blanket.

## Gap 2 - tools/witness-pane-env.sh, the rc= wait

The wait for the `rc=` line fell through to a verdict after five iterations rather than
exiting 2, so "a report cannot be half a report" held only inside the timeout: on a slow
machine an incomplete report was scored as an account answer. Fix: after the wait, a
missing `rc=` line is a setup failure (exit 2), like every other setup failure in the
script.

## Gap 3 - tools/witness-pane-env.sh, the process-group kill

The cleanup's group kill (`kill -- -$SUPPID`) depends on `set -m` having placed the job
in its own process group, which needs a controlling terminal. Without one (CI, cron) the
group is not created, the group kill finds nothing, and the fallback `kill $SUPPID`
reaches only the supervisor's bash -- its child `sleep` then runs out on its own. That is
harmless (a bounded sleep, the temp dir already gone), not a leak. Fix: document it in the
comment so a stray `sleep` after a CI run is not read as a leak (no behavior change).

## Verification

- `node --test engine/create.test.js` - 161/161 green, including the reworked pane-env
  test now running all four branches across set/unset/empty.
- `bash -n tools/witness-pane-env.sh` - parses (CI only syntax-checks the witness).
- The witness run end-to-end on main (spawns a real supervisor + tmux) to confirm the
  Gap 2/3 edits did not break the happy path.

## Done-when (from the card)

Each is a few-line change with existing tests green; the witness still fails against
70eddf3 and passes against main. The against-70eddf3 arm is the witness's original
purpose (it detects the pre-fix supervisor that dropped the pane env) and is unchanged by
these edits -- Gap 2 only adds an exit-2 on an incomplete report, Gap 3 is comment-only.
