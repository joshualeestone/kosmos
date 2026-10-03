# #5033: a refusal at the update pause takes back the board.stopped our own stop wrote

Card: joshualeestone/kosmos#5033 (Baron, 2026-10-02; residual of #4818 / PR #4827). Owner: Renet Tilley.

## Problem
`install/setup.sh` pauses the board for an update with `kosmos stop --force`, which writes `board.stopped`.
#4818's put-back (restart the board on a failed run) is armed only after the pause's three refusals:
our board would not pause, another Kosmos answers on the port, another app answers on the port. Those
refusals exit 1 with the marker our stop wrote still on disk. launchd's KeepAlive, `kosmos board-run`
and the watchdog obey it, so the board stays off after the port is free.

## Decision
- A separate clear-only arm, `_kosmos_marker_ours`, set from `_kosmos_was_running` on the line right before
  the pause's stop (so a signal while the stop runs is covered), and set back to `no` right after the put-back is armed (`_kosmos_paused_board=...`).
- `_kosmos_on_exit`, on a non-zero exit, runs the put-back and then `_kosmos_clear_own_marker`, which removes
  `board.stopped` only when armed and the mode, read again, still runs a board here. It starts nothing.
- Same EXIT trap (the card: a second `trap ... EXIT` would replace #4818's).

Rejected: arming the full put-back before the refusals (Angel's first suggestion): it would run
`kosmos start` over a port another app or another Kosmos holds. Rejected: the another-app refusal only
(the card's wording): the another-Kosmos refusal can carry our marker too (our board killed, something
still answering). The our-board refusal takes it back as well. Review 3 had it disarmed (a failed kill takes
its own marker back); review 7 found our stop can write one in a launchd-restart gap and then meet the board
answering. On that branch the board is running, so a marker there is wrong whoever wrote it.

Weakest premise: that any `board.stopped` present at the refusal was written by our own stop. It holds
because `_kosmos_was_running=yes` requires no marker before the stop; a person writing one in the same
second (a `kosmos stop` during the update) would lose it.

## Tests (tools/test-update-putback-4818.sh, run by `npm run test:shell`)
- order: the marker line sits directly before the pause's stop (review 8: a signal during the stop is covered), before the three refusals; no disarm before the
  arming line; the disarm sits after it and before the port wait.
- each refusal's shipped die after the marker line: marker gone, nothing started, sentence kept.
- the pause's real routing (probe through esac) with another app, another Kosmos, and our own board on the port.
- a hang-up in the armed window takes the marker back (5h).
- controls: a board the person stopped keeps its marker; switched to connect before the refusal keeps it; past the
  arming point a connect computer keeps it (#4818); a person's stop after the new board started keeps it (5f, the
  disarm's case); exit 0 keeps it.

Mutations (each restored, tree checked clean) are listed per review round in the commit history; the latest:
no take-back call reds every take-back arm; a stray disarm before a refusal reds the count check.

## Status
- [x] fix + tests committed (140eb74ab, a598d86a9), then one commit per review round
- [x] sibling suites: pause-foreign-board-964, update-abort-2055, install-static (+control), runnable-guard
- [ ] challenge loop
- [ ] PR
