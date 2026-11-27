# kosmos#9217 follow-up: queued-heavy.sh tells the board about its heavy run

Slice 1 (#9225, merged) added `kosmos heavy start "<label>" [--pid N]`. Splinter's review asked that the fleet's own
`tools/queued-heavy.sh` call it, so the fleet uses the product feature rather than its queue files.

## Change
- When a heavy run starts (a turn, or a beside run), queued-heavy.sh runs `kosmos heavy start "$WHAT" --pid $$` once,
  detached (the run never waits on the board; a busy one is given 2 s), and says in one line whether it asked.
  The record is tied to the script's own process, so it clears itself when the script exits, however it exits: no end
  call is added to `_qh_end`, the script's most delicate code.
- A `--light` run is not announced, whichever lane it gets, unless it was made an ordinary turn because it runs a suite,
  a page layer, an install harness or a cut (`QH_RUNS_BC`).
- Best-effort: no `kosmos` command, `QUEUED_HEAVY_ANNOUNCE=0`, or any refusal means nothing is said and the run goes on.
  The label is cut to the 80 characters a label may have.
- `tools/run-tests.sh` exports `QUEUED_HEAVY_ANNOUNCE=0`, so a queued-heavy a test starts never writes to a real board
  (tools/test-queued-heavy-4977.sh runs the whole script, and its stand-in jobs would otherwise show on the person's
  board). The outer queued-heavy that runs a validation is above run-tests.sh, so it still announces. The 4977 test sets
  it too, and its seven new arms use a stand-in `kosmos` that records its arguments.

## Weakest premise
That the run's environment can name the agent (an agent token, or a tmux pane) and has `kosmos` on its PATH. A job
started by `tmux run-shell` or launchd may have neither: with no kosmos the run's log says the board was not told; a
refused call is discarded, so the log says only that the board was asked. Best-effort, not a failure.

## Not here
The installed copy (~/.cache/claude-handoffs/queued-heavy.sh) is updated separately, by mv, after this merges.
