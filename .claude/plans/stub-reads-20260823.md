# stub-reads: the board's reads honour the tmux variable, and the suite stops measuring the live fleet (#332)

**2026-08-23.** Found on 08-22 while working the agent page: `server.test.js`
set `AGENT_WORKFORCE_TMUX_BIN=/bin/echo`, which stubbed every WRITE (the
engine modules resolve tmux through that variable) and none of the READS
(`engine/status.js` ran bare `tmux` off the PATH). So the suite's board came
from the operator's real tmux: eleven tests ran against whichever of Josh's
agents were up, five more wrote into a folder that only existed because an
earlier test had adopted `angel-discord` off the live fleet, and one used
`angel` "because the route 404s a name no pane holds", which held one here
because that is my own session name.

## What finished looks like

- `engine/status.js` resolves tmux through `AGENT_WORKFORCE_TMUX_BIN` for all
  three reads (list-panes, capture-pane, list-sessions), the same as every
  write.
- `test-support/fake-tmux.sh` answers reads from fixture files (none set means
  an empty board) and echoes everything else, so the write-side receipts the
  tests assert on keep their shape. The three server suites point at it.
- No server test skips on "no live agents on this machine": `anyAgent` makes
  its own fixture fleet every time (not "when the board is empty", because the
  previous test's fixture can still be on the board when this one starts) and
  takes it down with the test. Same for the payload-inspection test.
- The five `angel` tests make their own worker folder; the reports-to test
  makes its own pane.
- A guard test pins it: a fixture pane is seen through the variable, `/bin/echo`
  as the tmux is refused rather than falling through to the PATH, an empty
  fixture is an empty board, and no server suite points the variable at echo.
- `yarn test` passes with 0 skipped on a machine with no tmux server at all.

## Not done here

The same reads in browser checks that start `server.js` directly against a
sandboxed data root still see the live fleet unless they stub the pane source;
the two nav checks do (fleet.install). A sweep of the others is its own card.
