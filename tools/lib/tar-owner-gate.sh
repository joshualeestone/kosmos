#!/bin/bash
# The release-tarball owner gate (#6562, from the #1760 shipped-artifact pass). A release tarball must not record the
# account of the Mac that built it as its files' owner: before this, every entry read the build account's name.
# The bundle packs with `--uname kosmos --gname staff`, which changes only the stored NAMES (the numeric ids still come
# from disk), and install/setup.sh extracts with --no-same-owner, so no install applies a recorded owner at all, even
# one run as root (a Linux install can be).
#
# Known limit: a build run by an account literally named `kosmos` or `staff` would be refused, since those are the
# names the bundle stores.
#
# Usage: source this file, then `tar_owner_gate <tarball> [<account>] || exit 1` (account defaults to `id -un`).
# Prints the first offending entries and returns 1 when any entry names the account, or when it cannot list them.

tar_owner_gate() {
  local tarball="$1" account="${2:-$(id -un 2>/dev/null)}" listing bad
  [ -n "$account" ] || { echo "FAIL: the tarball owner gate cannot tell which account built this" >&2; return 1; }
  [ -f "$tarball" ] || { echo "FAIL: the tarball owner gate has no tarball at $tarball" >&2; return 1; }
  listing="$(LC_ALL=C /usr/bin/tar -tvzf "$tarball" 2>/dev/null)" || { echo "FAIL: the tarball owner gate could not list $tarball" >&2; return 1; }
  [ -n "$listing" ] || { echo "FAIL: the tarball owner gate listed no entries in $tarball" >&2; return 1; }
  # kosmos#7281 review 2 (W4): bsdtar lists owner and group as two columns ($3, $4); GNU tar (a Linux host) lists them
  # as one, owner/group ($2). Both are read, so the gate can fail on either host.
  bad="$(printf '%s\n' "$listing" | /usr/bin/awk -v a="$account" '{ split($2, og, "/") } $3 == a || $4 == a || og[1] == a || og[2] == a')"
  [ -z "$bad" ] && return 0
  echo "FAIL: $(printf '%s\n' "$bad" | /usr/bin/wc -l | /usr/bin/tr -d ' ') entries in $(basename "$tarball") record the build account '$account' as owner (#6562), first ones:" >&2
  printf '%s\n' "$bad" | /usr/bin/sed -n '1,3p' | /usr/bin/sed 's/^/  /' >&2
  return 1
}
