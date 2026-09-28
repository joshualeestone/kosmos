# shtmp-4298: shell tests keep their temp files under TMPDIR (kosmos#4298, #4273 slice 2)

## What
- macOS `mktemp` IGNORES TMPDIR (measured on 26.7, #4273). So every template-less `$(mktemp)` / `$(mktemp -d)` in a shell test landed a `tmp.XXXXXXXXXX` in the real temp root, outside run-tests.sh's per-run root.
- All 90 sites in 54 tools/test-*.sh now pass an explicit template, `"${TMPDIR:-/tmp}/<script-stem>.XXXXXXXXXX"`: 86 directories and 4 files.
  - Under run-tests.sh they land in the run root, which is removed at the end.
  - A leak now names the script it came from.
  - The tail is 10 X's, because the #4273 guard recognises only 6 or 10.
- test-versions-entry-gate.sh had one site with no cleanup, inside a `bash -c` string. It now removes its dir.
- After #4273 (PR #4306) merges: remove `tmp` from tools/test-leak-allowlist.txt, so the guard catches any shell leak by its script's name.

## Measured
- Each of the 54 scripts was run alone with its own fresh TMPDIR.
  - 52 passed and left nothing.
  - test-versions-entry-gate left one `versions-entry-gate.*`. Fixed; rerun: rc 0, nothing left.
  - test-install.sh skips (exit 1) without built dist/ trees. It is not in test:shell and nothing runs it. Its 15 sites are the same mechanical swap. Not run.
- No script puts a tmux socket inside its temp dir (no `-S` or TMUX_TMPDIR under it). So the longer path does not touch the socket-length budget, which depends on TMPDIR itself, and TMPDIR is unchanged.

## Weakest premise
- That no script relies on its temp dir being OUTSIDE TMPDIR, for example a test that sets TMPDIR to its own sandbox and then expects mktemp to land elsewhere. The 52 clean runs are the evidence. test-install.sh is unmeasured.

## Review record
