# #4319: the pkg install leaves its checksum-verify directory behind

Card: https://github.com/joshualeestone/kosmos/issues/4319
Branch: pkg-verify-cleanup-4319 (off origin/main 3a4a0845a)

## Finished looks like

A pkg install that runs setup leaves no `mktemp -d` verify directory (the downloaded installer and its
checksum) in the console user's temp dir, whether setup succeeds or fails, and the outer `rc` still
reads setup's own exit code.

## The call (Angel, 2026-09-28 03:1x CDT)

Run setup as a child instead of `exec`ing it. The inner script already has
`trap "/bin/rm -rf \"$d\"" EXIT`; without the `exec`, the shell outlives setup, so the trap fires.
setup is the last command, so its status is the shell's exit status, and the EXIT trap does not change
it (it does not call `exit`). Measured on this Mac's /bin/sh (bash 3.2 in sh mode): rc 7 comes back as 7.

Rejected: having setup.sh delete its own directory on an env var. That puts a pkg-only concern into the
installer every path runs, and a new env var would have to cross `sudo -u -H`, which strips the
environment on purpose.

What `exec` preserved, checked: setup.sh has no trap, no `$0`-based self-location and no parent-pid
read (it reads `$$`, its own pid, for a liveness watcher and unique suffixes), so the extra shell above
it changes nothing it can see.

Signals, measured by the round-1 reviewer: a SIGTERM sent to the inner shell alone now ends that shell
(the EXIT trap DOES run, rc 143) while setup runs on from its open file; with `exec` the same signal
reached setup. Decided: documented, not engineered. Only something signalling that one pid (not the
process group) hits it, and nothing in a normal pkg install does. The fix (background setup, forward
TERM/HUP/INT, `wait`) was rejected because a background job in a non-interactive shell gets stdin from
/dev/null, a change to setup's input that is riskier than the case it covers.

Weakest premise: that Installer never signals the postinstall's inner shell by pid on its own. If it
does, the next reader should add the forwarding with an explicit `</dev/stdin`-preserving shape.

## Overlap

#4298's fix (in flight elsewhere) renames the `mktemp -d` template on the line above the trap. This
branch changes only the last line of the block and adds a comment, so the two touch different lines.

## Tests

tools/test-pkg-checksum-1670.sh (run by `yarn test:shell`): the fake installer records its directory;
ARM 1, the new ARM 1b (failing setup, exit 7) and ARM 4 (retry then run) assert the directory is gone.
Control, automated in the same file: the lifted script with `exec` restored leaves the directory.
Refusal paths (ARM 2, 3) are not checked for cleanup: their setup never runs, so no directory is
recorded, and that path did not change.
tools/test-postinstall-inline-quoting.sh still passes (the new comment has no apostrophe).
