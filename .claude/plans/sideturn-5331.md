# sideturn-5331: the side turn's teardown never blocks; the queued-heavy test is bounded (#5331)

Card: kosmos#5331 (Splinter 13:37, from Renet's measurements). Owner: Angel (wrote the wrapper, #4911/#4977/#5064).

## Finished looks like
A side turn whose capper does not die from a group kill (not a group leader, or stopped) still releases its claim within
seconds, and tools/test-queued-heavy-4977.sh can never hold the runner that runs it: a hang reads FAIL.

## Changes
1. tools/queued-heavy.sh: _qh_stop_capper replaces both `kill -KILL -- -$CAPPER; wait $CAPPER` sites. KILL by group, by
   pid and its children (pkill -P), then wait only once ps says it has died (gone or Z), polling up to 10 s; a capper
   that lives past that is left behind with a line, and the claim is released anyway.
2. tools/test-queued-heavy-4977.sh: a whole-file watchdog (QH_FILE_DEADLINE, default 900 s; TERM then KILL to the file,
   exit 124, FAIL line); a bounded reap() for wrappers it stops (the b-side arm, now an arm of its own); a #5331 arm on a
   copy whose capper is not a group leader and is SIGSTOPped, with a control copy on the old teardown that must hang.

## Decided
- Bound the wait rather than find the exact race: Renet's evidence fits both "not a group leader" and "stopped", and a
  KILL to the pid covers both; the arm reproduces their combination.
- Leaving a capper behind is better than holding the queue: it is a poller over a command that is already gone.
- The live wrapper (~/.cache/claude-handoffs/queued-heavy.sh, older, same two sites) gets the same change after review,
  written to a new file and moved into place (bash reads a running script by offset; an in-place edit would break the
  queue runs using it now), with a backup.

## Weakest premise
The root race itself is not identified; the fix makes it harmless instead. Also seen (not this card): the #5064 ordering
CONTROL arm went BAD once under load (passed on re-run): a timing-sensitive control, separate.

## Validation
The test file: 85/85 (twice; one run had the unrelated #5064 control flake). Perturbation: without the pid KILL the #5331
arm goes BAD while its control still hangs. Watchdog: QH_FILE_DEADLINE=8 stops the file with exit 124 when it is between foreground commands; a hung foreground command is stopped by the KILL step 15 s later (children and this run's sleeps first; exit 137, and $S can be left: stated in the file).
