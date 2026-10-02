# #5033: a refusal at the update pause takes back the board.stopped our own stop wrote

Card: joshualeestone/kosmos#5033 (Baron, 2026-10-02; residual of #4818 / PR #4827). Owner: Renet Tilley.

## Problem
`install/setup.sh` pauses the board for an update with `kosmos stop --force`, which writes `board.stopped`.
#4818's put-back (restart the board on a failed run) is armed only after the pause's three refusals:
our board would not pause, another Kosmos answers on the port, another app answers on the port. Those
refusals exit 1 with the marker our stop wrote still on disk. launchd's KeepAlive, `kosmos board-run`
and the watchdog obey it, so the board stays off after the port is free.

## Decision
- A separate clear-only arm, `_kosmos_marker_ours`, set from `_kosmos_was_running` on the line right after
  the pause's stop, and set back to `no` right after the put-back is armed (`_kosmos_paused_board=...`).
- `_kosmos_on_exit`, on a non-zero exit, runs the put-back and then `_kosmos_clear_own_marker`, which removes
  `board.stopped` only when armed and the mode, read again, still runs a board here. It starts nothing.
- Same EXIT trap (the card: a second `trap ... EXIT` would replace #4818's).

Rejected: arming the full put-back before the refusals (Angel's first suggestion): it would run
`kosmos start` over a port another app or another Kosmos holds. Rejected: the another-app refusal only
(the card's wording). The other two refusals leave the same marker for the same reason; clearing it there
restores the state the run found (no marker) and starts nothing.

Weakest premise: that any `board.stopped` present at the refusal was written by our own stop. It holds
because `_kosmos_was_running=yes` requires no marker before the stop; a person writing one in the same
second (a `kosmos stop` during the update) would lose it.

## Tests (tools/test-update-putback-4818.sh, run by `npm run test:shell`)
- order: the marker line sits directly after the pause's stop, before the three refusals; the disarm sits
  after the arming line and before the port wait.
- another app on the port, board meant to run: marker gone, our board not started, refusal sentence kept.
- controls: a board the person stopped keeps its marker; past the arming point a computer switched to
  connect keeps its marker; switched to connect before the refusal keeps it; exit 0 keeps it.

Mutations (each restored, tree checked clean): no take-back call (5 reds), no disarm (anchor red), no mode
re-read (5d reds), marker armed unconditionally (anchor red), disarm moved after the survivor die (order
reds), a line between the stop and the marker (order reds).

## Status
- [x] fix + tests committed (140eb74ab, a598d86a9)
- [x] sibling suites: pause-foreign-board-964, update-abort-2055, install-static (+control), runnable-guard
- [ ] challenge loop
- [ ] PR
