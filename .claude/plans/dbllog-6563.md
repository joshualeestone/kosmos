# dbllog-6563: each installer line is in install.log once after `kosmos update`

Card: kosmos#6563 (found by the sandboxed rehearsal of a signed staging update, #6468).

## Finished looks like
After a `kosmos update`, install.log holds each installer line once (the run-id copy). run-setup's own refusal
reasons are still there. A person piping the installer still sees every line on screen.

## Cause
setup.sh's start_log writes every line to install.log (run-id prefixed) AND to the console. cmd_update appends the
run-setup step's console to the same install.log (#4382, kept by #6475), so each line landed twice.

## Change
- setup.sh start_log: with KOSMOS_LOG_FILE_ONLY=1, the awk keeps the file copy and drops the console copy. The
  variable is unset right after it is read, so nothing the run starts (a board, agents) inherits it.
- install/kosmos cmd_update: sets KOSMOS_LOG_FILE_ONLY=1 on the run-setup call. The redirect stays, so lines from
  before start_log, the no-fifo branch, and run-setup's refusals still reach install.log once.

## Rejected
- Dropping cmd_update's redirect: loses run-setup's refusal reasons, which the installer never writes.
- Capturing to a temp file and appending only on failure: loses the installer's pre-start_log lines on success.

## Weakest premise
Version skew: an old CLI with a new installer, or a new CLI with an old one, keeps today's duplicates. Nothing breaks.

## Verify
install.logonce-6563.test.js runs the real start_log under /bin/sh: file-only, unset (control), no fifo, not
inherited, and the cmd_update call; 4/4. Control against main's scripts: 2 fail; without the unset: 1 fails.
Related update and installer tests pass.
