# #4319: the pkg install leaves its checksum-verify directory behind

Card: https://github.com/joshualeestone/kosmos/issues/4319
Branch: pkg-verify-cleanup-4319 (off origin/main 3a4a0845a)

## Finished looks like

A pkg install that runs setup leaves no `mktemp -d` verify directory (the downloaded installer and its
checksum) in the console user's temp dir, whether setup succeeds or fails, and the outer `rc` still
reads setup's own exit code.

## The call (Angel, 2026-09-28 03:1x CDT)

Run setup as a child instead of `exec`ing it. The inner script already has `set -e` and
`trap "/bin/rm -rf \"$d\"" EXIT`; without the `exec`, the shell outlives setup, so the trap fires, and
the shell exits with setup's status (0 on success; on failure `set -e` exits with it; the EXIT trap does
not change the status because it does not call `exit`).

Rejected: having setup.sh delete its own directory on an env var. That puts a pkg-only concern into the
installer every path runs, and a new env var would have to cross `sudo -u -H`, which strips the
environment on purpose.

What `exec` preserved, checked: setup.sh never reads its parent process id (it uses `$$` only as a
unique suffix), so the extra shell above it changes nothing it can see. The exit code is covered by a
test arm (a setup that exits 7 comes back as 7).

Weakest premise: signals. If Installer kills the inner shell with an untrapped signal, the EXIT trap
may not run and the directory is left, as it always was. Not a regression.

## Overlap

#4298's fix (in flight elsewhere) renames the `mktemp -d` template on the line above the trap. This
branch changes only the last line of the block and adds a comment, so the two touch different lines.

## Tests

tools/test-pkg-checksum-1670.sh (run by `yarn test:shell`): the fake installer records its directory;
ARM 1, the new ARM 1b (failing setup, exit 7) and ARM 4 (retry then run) assert the directory is gone.
Control, run by hand: with `exec` restored, ARM 1, 1b and 4 all fail with the left-behind path.
tools/test-postinstall-inline-quoting.sh still passes (the new comment has no apostrophe).
