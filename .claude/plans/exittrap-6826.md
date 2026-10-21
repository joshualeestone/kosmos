# exittrap-6826: deploy-site.sh must not exit 0 when it dies

Card: joshualeestone/kosmos#6826 (filed and taken by Baron Draxum, 2026-10-21).

## Why

On macOS /bin/sh (GNU bash 3.2.57), a script with `set -eu` and an EXIT trap whose last command succeeds exits 0
when it dies on a failed `.` (a missing library) or an unset variable. `$?` is already 0 when the trap runs, so the
trap cannot recover it. A dry run of deploy-site.sh from a worktree died on a missing tools/lib/setup-floor.sh on
2026-10-21 06:13 and exited 0. Measured table on the card.

## Shape

- `_DS_FINISHED=0`, and an EXIT trap that runs the cleanup, keeps any non-zero status, and turns a 0 into exit 1
  (with a line saying the run did not finish) unless `_DS_FINISHED=1`.
- Both success exits (the dry-run end and the trailing `exit 0`) set `_DS_FINISHED=1` directly before `exit 0`.
- The finished check IS the block's EXIT trap (the `_ds_rc` trap line), so it covers the run from the moment a trap exists.
  `_DS_FINISHED=0` is set just before the block. The trap reads `${_DS_FINISHED:-1}`, so the block run on its own
  (tools/test-deploy-site-fetch-4745.sh extracts it) counts as finished and keeps its exits as they were.
  First version: the trap sat after the block. That left the old plain trap armed for about 110 lines, and a
  review round caught it. Measured: with the trap in the block and no default, 5 arms of the #4745 test went red.

## Decided, with what was rejected

- A finished flag rather than guarding each `.` with `[ -r ]`: the guard covers only missing libraries, and the
  flag also covers `set -u`, `${VAR:?}` and readonly assignment. Both kinds were measured.
- Not rewritten for bash 5: it is not installed on Agent1s, and the script is `#!/bin/sh` on purpose.
- Scope: deploy-site.sh only. About 40 other scripts under tools/ share the shape (an EXIT trap plus set -u). Having
  the shape does not make a script affected, so each needs its own look. That stays on the card.

Weakest premise: before the `_ds_rc` trap line there is no EXIT trap at all, so a death there keeps its real status (measured:
a failed `.` with no trap exits 1). The only `.` before it is the served-verify one.

## Tests

`tools/test-deploy-site-exit-trap-6826.sh` lifts the real trap line out of deploy-site.sh and runs it against a
failed `.`, an unset variable, an explicit `exit 3` and a finished `exit 0`, with the old trap as a control. A pin
checks every exit in command position (outside quotes): a literal non-zero code, or `exit 0` as the whole line
directly after `_DS_FINISHED=1`; a bare `exit`, `exit "$var"` or `|| exit 0` is reported. E1/E2 copy the REAL deploy-site.sh, inject a death straight after its trap line, and
run it (site repo, real tools, stub vercel), with the old trap as the control; moving the flag after the block
makes them red. `tools/test-deploy-site-exit0-2791.sh` B1d runs a COMPLETED dry run against its fake live
site and asserts rc 0 with no #6826 line (dropping the dry-run flag makes it red); B1 already covers the publish
exit. By hand on Agent1s: the 06:13 input now exits 1 (it was 0).
