# #2044 - release step 10 verifies the OUTCOME, not a fixed 10s window

## The bug
`tools/release.sh` step 10 runs `tools/restart-local-board.sh`, which restarts the
developer's local Kosmos board (launchd `com.kosmos.board`, KeepAlive) after a cut and
waits for it to come back on the new code. The wait was a fixed loop: `for i in 1..10;
do sleep 1; curl /api/status; done`, exit 1 if the version didn't match in that ~10s.

The launchd job has no `ThrottleInterval`, so `launchctl stop` respawns it under
launchd's default 10-second throttle; the board then boots node and only then answers
on the new version, commonly at ~10-13s - just past the cap. So a perfectly healthy
board exited 1. release.sh runs step 10 under `set -euo pipefail`, so that false exit 1
aborted the whole cut, AFTER the pointer was already live and the served bytes already
verified (steps 9d/9e). That is why `release.sh`'s exit code could not be trusted in
either direction (kosmos bulletin).

## The fix (restart-local-board.sh only)
Verify the OUTCOME - the board serving the code on disk - on a generous, clock-based
deadline (`KOSMOS_BOARD_WAIT_SECS`, default 45s), returning success the instant the
board serves the wanted version, however long it took. A board still not on that
version after the deadline is a genuine failure (stale, or down) and STILL exits 1.
The fix removes the false positive without weakening the real check.

Deliberately NOT changing `release.sh`'s fatal gating of step 10: step 11
(refresh-local-cli) documents the same bare-fatal shape as intended to red the cut by
design - the cut is not done until the developer's own board and CLI are on the new
code (the #360 rationale). So a genuinely stale local board should still fail loudly.
The #2044 bug was only the timing false-positive, not the fatal gating.

## Decisions
- Generous 45s default: comfortably past launchd's 10s throttle + node boot. Overridable
  via `KOSMOS_BOARD_WAIT_SECS` (also the test seam).
- Guards added: an empty wanted version is a failure (not a false "back on " success
  against a silent board); a non-numeric or zero-padded (octal-trap) `KOSMOS_BOARD_WAIT_SECS`
  is refused / normalised to base 10.
- All failure messages routed to stderr; success/status to stdout.

## Test
`tools/test-restart-local-board.sh` drives the poll in isolation via a
`KOSMOS_BOARD_POLL_ONLY` seam against a stub board (ephemeral port, no launchd, no real
restart). Arms: two controls, success, a past-the-old-cap arm (board flips to the wanted
version at ~11s with a 20s deadline, asserting exit 0 AND elapsed > 10s - the old cap
would have failed this exact healthy board), failure (never serves it -> exit 1),
not-answering, bad-knob, empty-want, and zero-padded-knob. Wired into `test:shell`.

## Weakest premise
45s is a heuristic margin over the observed ~10-13s. If a real board legitimately needs
longer, `KOSMOS_BOARD_WAIT_SECS` is the knob. `WAIT_SECS` has a lower guard but no upper
bound (a deliberate absurd override could hang) - accepted, since release.sh never sets
it and it defaults to 45.
