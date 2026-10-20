#!/bin/bash
# The release-tarball macOS metadata gate (#6678, from the #1760 shipped-artifact pass on the 0.7.60 bundles). A release
# tarball must not carry the build Mac's extended attributes, either as AppleDouble `._name` entries or as
# xattr pax headers (SCHILY.xattr.* / LIBARCHIVE.xattr.*). The bundle packs with COPYFILE_DISABLE=1 and
# --no-mac-metadata (no `._` entries) and --no-xattrs (no xattr headers); each flag alone leaves the other kind in.
#
# 🛑 It reads the raw entries with Python's tarfile, NOT `tar -t`: macOS bsdtar folds a `._name` entry back into its
# file when it lists, so a `tar -tzf` of a tarball holding one shows nothing (measured 2026-10-20).
#
# Usage: source this file, then `tar_macmeta_gate <tarball> || exit 1`.
# Prints the first offending entries and returns 1 when any is found, or when it cannot read every entry.

tar_macmeta_gate() {
  local tarball="$1" out
  [ -f "$tarball" ] || { echo "FAIL: the tarball metadata gate has no tarball at $tarball" >&2; return 1; }
  command -v python3 >/dev/null 2>&1 || { echo "FAIL: the tarball metadata gate needs python3 to read raw entries" >&2; return 1; }
  out="$(python3 -I - "$tarball" <<'PY'
import os, sys, tarfile
bad, n = [], 0
try:
    with tarfile.open(sys.argv[1], 'r:gz') as t:
        for m in t:
            n += 1
            if os.path.basename(m.name.rstrip('/')).startswith('._'):
                bad.append('AppleDouble entry ' + m.name)
            for k in m.pax_headers:
                if '.xattr.' in k:
                    bad.append('extended attribute %s on %s' % (k, m.name))
except Exception as e:
    print('UNREADABLE ' + str(e)); sys.exit(2)
if n == 0:
    print('EMPTY'); sys.exit(2)
for b in bad[:3]:
    print(b)
sys.exit(1 if bad else 0)
PY
)"
  case $? in
    0) return 0 ;;
    1) echo "FAIL: $(basename "$tarball") carries macOS metadata from the build Mac (#6678), first ones:" >&2
       printf '%s\n' "$out" | /usr/bin/sed 's/^/  /' >&2; return 1 ;;
    *) echo "FAIL: the tarball metadata gate could not read every entry of $tarball ($out)" >&2; return 1 ;;
  esac
}
