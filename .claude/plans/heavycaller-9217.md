# kosmos#9217 follow-up: queued-heavy.sh tells the board about its heavy run

Slice 1 (#9225, merged) added `kosmos heavy start "<label>" [--pid N]`. Splinter's review asked that the fleet's own
`tools/queued-heavy.sh` call it, so the fleet uses the product feature rather than its queue files.

## Change
- When a heavy run starts (a turn, or a beside run), queued-heavy.sh runs `kosmos heavy start "$WHAT" --pid $$` once.
  The record is tied to the script's own process, so it clears itself when the script exits, however it exits: no end
  call is added to `_qh_end`, the script's most delicate code.
- A `--light` run is not announced, whichever lane it gets, unless it was made an ordinary turn because it runs a suite,
  a page layer, an install harness or a cut (`QH_RUNS_BC`).
- Best-effort: no `kosmos` command, `QUEUED_HEAVY_ANNOUNCE=0`, or any refusal means nothing is said and the run goes on.
  The label is cut to the 80 characters a label may have.
- `tools/run-tests.sh` exports `QUEUED_HEAVY_ANNOUNCE=0`, so a queued-heavy a test starts never writes to a real board
  (the stand-in jobs of five test scripts would otherwise show on the person's board). The outer queued-heavy that runs
  a validation is above run-tests.sh, so it still announces. tools/test-queued-heavy-4977.sh sets it too, and its four
  new arms use a stand-in `kosmos` that only records its arguments.

## Weakest premise
That the run's environment can name the agent (an agent token, or a tmux pane). A job started by `tmux run-shell` may
have neither; then the board refuses the call and nothing is shown, which is the best-effort case, not a failure.

## Not here
The installed copy (~/.cache/claude-handoffs/queued-heavy.sh) is updated separately, by mv, after this merges.
