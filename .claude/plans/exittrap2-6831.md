# exittrap2-6831: scripts with set -e and an EXIT trap must not exit 0 when they die

Card: joshualeestone/kosmos#6831 (filed and taken by Baron Draxum, 2026-10-21), the follow-up to #6826.

## Why

On this fleet's bash 3.2 (macOS /bin/bash and /bin/sh), a script with `set -e` AND an EXIT trap that dies on an
unset variable, a failed `.`, `${VAR:?}` or a readonly assignment reaches the trap with `$?` already 0, and exits 0.
Measured table on #6826 (comment of 08:05 CDT): without `set -e`, or without an EXIT trap, the status is kept.

## Shape

- `tools/lib/exit-guard.sh`: `kosmos_exit_guard <cleanup-function> <name>` replaces a script's EXIT trap. The trap
  runs the cleanup in a subshell with `set +u` and `|| :` (so a cleanup that returns non-zero, or dies on an unset
  variable, neither stops the check nor fails a finished run), turns a 0 into 1 with one line unless
  `kosmos_finished` ran, and exits with the result.
  An unset flag counts as NOT finished (nothing extracts these scripts' blocks, so failing safe costs nothing).
- Guarded with it: build-installer-pkg.sh, build-tmux-from-source.sh, build-kosmos-bundle.sh and
  build-kosmos-windows.sh (each succeeds by falling off the end, so `kosmos_finished` is its last line), and
  dist-retention.sh (marked directly before its final `exit 0`).
- release.sh: its two main EXIT traps both call `cut_record_done "$_rc"`, so a dying cut was RECORDED as completed
  as well as exiting 0. Both now turn a 0 into 1 unless the last line set `_REL_FINISHED=1`, record that, and exit
  with it. They keep their own bodies rather than move onto the library: each does several things in order (record,
  free the machine claim, restore the site, thaw), and moving them is a larger change than the bug.

**Consequence for the next cut:** build-installer-pkg.sh is one of the hashed inputs of `pkg_input_sha`
(tools/lib/pkg-inputs.sh), so this edit changes the pkg input sha: the next cut rebuilds, notarises and publishes
Kosmos.pkg although the package itself is unchanged. That is the hash doing its job. exit-guard.sh is deliberately
NOT added to the hashed inputs: it does not change what the pkg does.

## Decided, with what was rejected

- A shared library rather than seven hand copies of #6826's inline trap.
- build-kosmos-windows.sh: its two traps (STAGE, then STAGE and TMP) become one guard whose cleanup removes TMP only
  once this script has made it. TMP is a common environment variable, so an unconditional `rm -rf "$TMP"` in a
  cleanup that can run before line 264 could remove an inherited directory.
- ci-runner-setup.sh left as it is: its EXIT traps are a recovery action inside one install step (restart the
  runner, print "install failed"), cleared with `trap - EXIT` after; it is run by hand, and a death there already
  says it failed. Its two `exit 0` lines are inside a hook body it writes out.
- release.sh's claim-renewer subshell (`trap - EXIT` and its own `exit 0`s) is not the cut's flow; untouched.

Weakest premise: that every success path of each script reaches its finish mark. A success path that ended early
with a bare `exit` or `exit 0` would now be reported as a failure. The pin in the test finds every `exit 0` in each
guarded script's own flow (outside quotes) after the guard. A finished run of each builder has not been observed:
the cut exercises bundle, pkg and release, and the first cut after this merges is that observation.

## Tests

`tools/test-exit-guard-6831.sh`: the library under /bin/sh and /bin/bash with controls showing the old trap exits 0
here; release.sh's two trap lines lifted and run with a stub recorder (a death records 1 and exits 1, a finished cut
records 0, `exit 3` records 3); a pin per guarded script (any exit after the guard that could carry 0), and one
for release.sh (no `exit 0` or bare `exit` after its first guarded trap). Mutants (one release.sh trap reverted, a finish mark
dropped, the library's conversion removed) go red. The 42 shell tests and 6 node files that name release.sh, and
the tests that name each builder, pass.
