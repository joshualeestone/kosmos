# tarowner-6562: the release tarball does not record the build Mac's account as owner (#6562)

Follow-up to #6549 (the #1760 shipped-artifact pass). Measured on the served staging 0.7.59 tarball: all 378 entries
read `mortalkombat staff` (uid 501, gid 20), the build account's name in a shipped artifact's metadata.

## Change
- tools/build-kosmos-bundle.sh and tools/build-tmux-bundle.sh pack with `--uname kosmos --gname staff`. bsdtar stores
  those NAMES; the numeric ids still come from disk, so an extraction behaves exactly as before (measured: names
  `kosmos staff`, numeric ids unchanged).
- tools/lib/tar-owner-gate.sh `tar_owner_gate <tarball> [<account>]`: lists the tarball and refuses when any entry's
  owner or group name is the building account (default `id -un`), or when it cannot list it, or has no account.
  The bundle build calls it right after packing.
- install/setup.sh extracts both tarballs with `--no-same-owner` (review 1, below). install.manifest-sig-6468 and
  install.tmux-sig-6473 find those lines by their prefix, which is unchanged (42/42 pass).
- tools/build-tmux-bundle.sh also calls the gate (review 1).
- package.json test:shell: `bash -n` on the lib and the new test.

## Root extraction (review 1)
The plan first said every install extracts unprivileged. Not so: a Linux install run as root (`curl | sh` in a
container or VM) runs setup.sh's two `tar -xzf` as root, and its in-app updates run them as the board's user, which
is root there. As root, tar applies the archive's owner (name first, else the numeric id). So setup.sh now extracts
both tarballs with `--no-same-owner` (bsdtar and GNU tar both take it): no install applies a recorded owner at all.
The numeric ids are left as they are; with --no-same-owner they never matter. The .pkg postinstall runs setup.sh as
the console user (launchctl asuser + sudo -u), so it was never a root extraction.

## The tmux bundle
Only future tmux rebuilds change: the cut copies the served tmux pair (#6476) and does not rebuild it, so no tmux sha
changes and KOSMOS_CUT_NEW_TMUX is not needed.

## Test
tools/test-tar-owner-gate-6562.sh: CONTROL a tarball packed with the neutral names passes; refused: a plainly packed
tarball (owner = this account, named in the message), an entry whose group name is the account, the default account
(id -un, named), a file that is not a tarball, a tarball cut in half (its listing fails part way), an archive
with no entries, a missing one, an unreadable account; not refused: an unrelated account; the
build packs with the neutral names and calls the gate; the tmux build does both; setup.sh extracts both tarballs with
--no-same-owner. Mutants: removing the listing's exit check or its empty check each turns its arm red.

## Weakest premise
That `--no-same-owner` is honoured on every platform setup.sh runs on (bsdtar on macOS, GNU tar and busybox tar on
Linux). bsdtar and GNU tar document it; busybox tar's support was not checked.
