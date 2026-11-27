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
- Best-effort: with no `kosmos` command, with nothing to name the agent, or with a name that leaves no label, one line
  says the board was not told; with `QUEUED_HEAVY_ANNOUNCE=0` nothing is said; a refusal by the board is not seen (the
  line says "asked"). In every case the run goes on.
  The label is cut to the 80 characters a label may have.
- Unset, announcing is on only when the run markers are the real ones (`KOSMOS_RUN_MARKER_DIR` unset): every test
  points them at a private folder, so a test's queued-heavy never writes to a real board, whether tools/run-tests.sh runs
  it or it is run on its own. `QUEUED_HEAVY_ANNOUNCE=1` or `0` decides outright. As a second guard, `tools/run-tests.sh` exports `0`
  (tools/test-queued-heavy-4977.sh runs the whole script, and its stand-in jobs would otherwise show on the person's
  board). The outer queued-heavy that runs a validation is above run-tests.sh, so it still announces. The 4977 test sets
  it too, and its fourteen new arms use a stand-in `kosmos` that records its arguments, including the fleet's default
  (real markers: it announces) and a run with nothing to name the agent (it says so and asks nothing).

## Weakest premise
That the run's environment can name the agent (an agent token, or a tmux pane) and has `kosmos` on its PATH. A job
started by `tmux run-shell` or launchd may have neither: with no kosmos the run's log says the board was not told; a
refused call is discarded, so the log says only that the board was asked. Best-effort, not a failure.

## Not here
The installed copy (~/.cache/claude-handoffs/queued-heavy.sh) is updated separately, by mv, after this merges.

## Handled after review
- The detached `kosmos heavy start` carries the label in its argv for up to about 17 s,
  where #5467 took the run's name out of argv. So the label has / and .sh broken up ("cut tools/release.sh" becomes
  "cut tools release sh"): no word of it can read as a script path to heavy-gate.sh or a cut wrapper's pgrep. The
  hyphenated script names an unanchored pgrep might look for (run-tests, browser-checks, test-install) are broken up too.
- A name starting with `-` is skipped, with a line saying so (the board refuses such a label).

## Known, not handled
- `.sh` inside a word is broken up too ("a.shape" becomes "a shape"): cosmetic.
- A plain word such as "release" stays in the label, so an unanchored `pgrep -f release` sees it for those few seconds;
  breaking it would garble ordinary names. Measured 2026-11-27: no `pgrep -f` in tools/ outside the tests matches a
  bare word; each matches a script path (such as `run-tests\.sh`), a listener pattern or a sandbox path.
