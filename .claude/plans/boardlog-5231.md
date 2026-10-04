# #5231: a check whose board died prints that board's server log before cleanup removes it

Baron, 2026-10-04 00:4x: render-org-sectors-4434 failed twice on a loaded Mortals full run. The first attempt timed
out (a slow board); on the retry the same board refused connections (its server had died). The harness removes
sandboxes at cleanup, so the server's last words were lost. Not day-one; built and held for after Monday.

## Change (tools/browser-checks.sh)
- wait_up <port> <log> records "port<TAB>log" in $RUN_DIR/board-logs.tsv: every board boot goes through wait_up, so
  every board is mapped, including one that never answered.
- board_log_tail <capture>: for each 127.0.0.1:<port> named in a refused connection (node's ECONNREFUSED or Playwright's
  net::ERR_CONNECTION_REFUSED, the card's exact line), prints whether that board still answers and the last 20 lines
  of its server.log; a refused port the run never booted is said plainly; a failure with no refused connection prints
  nothing.
- run_one calls it after EACH failed attempt: the retry overwrites the first attempt's capture, and in #5231 the
  refusal came on the retry.

## Not done (part 2 of the card)
Why the org board died under load: needs the log this change keeps. If it recurs, the run log now names the cause.

## Rejected
- Keeping the whole sandbox on failure: large, and it would also keep sandboxes of healthy boards.
- Printing every board's log on every failure: noise; a timeout is not a dead board.

## Tests
tools/test-board-log-tail-5231.sh (wired in test:shell beside #1073's): 6 arms on the REAL extracted functions,
including the card's exact Playwright line, node's spelling, an unknown port, and a timeout CONTROL that prints
nothing. Mutations, each red: the Playwright spelling dropped from the pattern; the port map written elsewhere; the
call after the retry removed. Existing harness tests green: test-wait-up-collision-1073, test-bc-quarantine (39/39),
test-browser-checks-workflow.

## Review 1 (opus, blind)
No WARNING+ (shell safety checked: set -uo pipefail, no -e, so nothing here can abort the run or change a verdict).
NITs FIXED: each printed line is cut at 300 characters (one huge heap-dump line stays readable); a refused port that is
not a board (e.g. a stub's 127.0.0.1:9 relayed in an error) is said as "not a board this run booted"; two arms added
(a re-booted port shows the later board's log; a board that answers again is not called GONE). NIT ACCEPTED: when a
board died during attempt 1, attempt 2 prints the same tail again.

## Review 2 (opus, blind)
No WARNING+. NITs FIXED: the listener wait is up to 10 s and a listener that never starts is named, not misread; the
EXIT trap kills it. NIT ACCEPTED: cut -c counts bytes with no locale, so a multibyte character at byte 300 can split
(cosmetic). Converged.

## Weakest premise
That a dying board's server.log holds its cause. An OOM kill by the OS (SIGKILL) writes nothing to it; the line
"is GONE" with an ordinary tail would then point at the OS, which is still more than today's nothing.
