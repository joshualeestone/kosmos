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
- The new trap is installed right AFTER the site-fetch helper block. The block keeps its own plain cleanup trap,
  because tools/test-deploy-site-fetch-4745.sh extracts and runs the block alone. Inside it, the finished check
  would turn every extracted run into a failure (measured: 5 arms of that test went red when the trap sat in the
  block).

## Decided, with what was rejected

- A finished flag rather than guarding each `.` with `[ -r ]`: the guard covers only missing libraries, and the
  flag also covers `set -u`, `${VAR:?}` and readonly assignment. Both kinds were measured.
- Not rewritten for bash 5: it is not installed on Agent1s, and the script is `#!/bin/sh` on purpose.
- Scope: deploy-site.sh only. About 40 other scripts under tools/ share the shape (an EXIT trap plus set -u). Having
  the shape does not make a script affected, so each needs its own look. That stays on the card.

Weakest premise: that the window between the block's trap (line 207) and the new trap holds nothing that can die
this way. Read it: that window only defines functions and variables.

## Tests

`tools/test-deploy-site-exit-trap-6826.sh` lifts the real trap line out of deploy-site.sh and runs it against a
failed `.`, an unset variable, an explicit `exit 3` and a finished `exit 0`, with the old trap as a control. A pin
checks that every `exit 0` sets the flag first. End to end: the 06:13 input now exits 1 (it was 0), and a good dry
run still exits 0.
