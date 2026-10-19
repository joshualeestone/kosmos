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
- package.json test:shell: `bash -n` on the lib and the new test.

## Why not change the numeric ids
They would matter only if a tarball were extracted as root. The installer extracts unprivileged (install/setup.sh:
"Nothing needs sudo"), which applies no owner. Setting uid 0 could make files root-owned in a home folder if that ever
changed; keeping the ids keeps every extraction exactly as today.

## The tmux bundle
Only future tmux rebuilds change: the cut copies the served tmux pair (#6476) and does not rebuild it, so no tmux sha
changes and KOSMOS_CUT_NEW_TMUX is not needed.

## Test
tools/test-tar-owner-gate-6562.sh: CONTROL a tarball packed with the neutral names passes; refused: a plainly packed
tarball (owner = this account, named in the message), an entry whose group name is the account, the default account
(id -un), a file that is not a tarball, a missing one, an unreadable account; not refused: an unrelated account; the
build packs with the neutral names and calls the gate; the tmux build packs with them.

## Weakest premise
That every extraction of a release tarball is unprivileged. The ones I read are (setup.sh, the in-app update, the
Windows zip has no owners). The numeric ids are unchanged either way, so this change cannot make a root extraction
worse than today.
