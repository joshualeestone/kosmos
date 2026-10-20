#!/bin/bash
# kosmos#6678: tools/lib/tar-macmeta-gate.sh refuses a release tarball that carries the build Mac's extended attributes
# (an AppleDouble `._` entry, or an xattr pax header), passes one packed the way the bundles pack, and refuses rather
# than skips when it cannot read the tarball. Each pack flag is shown leaving its own kind of metadata in when alone.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib/tar-macmeta-gate.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/tar-macmeta-gate-6678.XXXXXXXXXX")"; trap 'rm -rf "$T"' EXIT
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
mkdir -p "$T/s/app"; printf 'x\n' > "$T/s/app/f"; printf 'y\n' > "$T/s/VERSION"

if [ "$(uname -s)" = Darwin ] && command -v xattr >/dev/null 2>&1 && xattr -w user.kev6678 probe "$T/s/app/f" 2>/dev/null; then
  pack() { env "$@" -czf "$T/p.tgz" --uname kosmos --gname staff -C "$T/s" app VERSION; }
  pack COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs
  if tar_macmeta_gate "$T/p.tgz" 2>/dev/null; then pass "CONTROL: a file with an xattr, packed the way the bundles pack, passes"
  else fail "CONTROL: the bundles' own packing was refused, so every refusal below is vacuous"; fi
  pack X=1 tar
  out="$(tar_macmeta_gate "$T/p.tgz" 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | /usr/bin/grep -qF 'AppleDouble entry app/._f' && printf '%s' "$out" | /usr/bin/grep -qF 'xattr.user.kev6678'; then pass "a plain pack is refused for both the AppleDouble entry and the xattr header"
  else fail "a plain pack must be refused for both kinds (rc=$rc): $out"; fi
  pack X=1 tar --no-xattrs
  out="$(tar_macmeta_gate "$T/p.tgz" 2>&1)"
  if printf '%s' "$out" | /usr/bin/grep -qF 'AppleDouble entry'; then pass "--no-xattrs alone still leaves the AppleDouble entry, and it is caught"
  else fail "--no-xattrs alone: the AppleDouble entry must be caught: $out"; fi
  pack COPYFILE_DISABLE=1 tar --no-mac-metadata
  out="$(tar_macmeta_gate "$T/p.tgz" 2>&1)"
  if printf '%s' "$out" | /usr/bin/grep -qF 'extended attribute' && ! printf '%s' "$out" | /usr/bin/grep -qF 'AppleDouble'; then pass "--no-mac-metadata alone still leaves the xattr header, and it is caught"
  else fail "--no-mac-metadata alone: the xattr header must be caught: $out"; fi
else
  echo "  skip the xattr arms: not a Mac, or no xattr here (the bundles are built on a Mac)"
fi

python3 - "$T/ad.tgz" <<'PY'
import io, sys, tarfile
with tarfile.open(sys.argv[1], 'w:gz', format=tarfile.PAX_FORMAT) as t:
    for name, data, pax in (('app/f', b'x\n', {}), ('app/._f', b'Mac OS X', {}), ('app/g', b'y\n', {'SCHILY.xattr.com.apple.provenance': 'p'})):
        i = tarfile.TarInfo(name); i.size = len(data); i.pax_headers = pax; t.addfile(i, io.BytesIO(data))
PY
out="$(tar_macmeta_gate "$T/ad.tgz" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | /usr/bin/grep -qF 'AppleDouble entry app/._f' && printf '%s' "$out" | /usr/bin/grep -qF 'SCHILY.xattr.com.apple.provenance'; then pass "a built tarball with both kinds is refused and each named (any OS)"
else fail "a built tarball with both kinds must be refused (rc=$rc): $out"; fi

tar -czf "$T/clean.tgz" -C "$T/s" VERSION
if tar_macmeta_gate "$T/clean.tgz" 2>/dev/null; then pass "a tarball of a file with no attributes passes"
else fail "a clean tarball must pass"; fi

printf 'not a tarball\n' > "$T/junk.tgz"
if ! tar_macmeta_gate "$T/junk.tgz" 2>/dev/null; then pass "a file that is not a tarball is refused, never passed"
else fail "an unreadable tarball must be refused"; fi

for i in $(seq 1 300); do printf '%s\n' "$i" > "$T/s/app/f$i"; done
tar -czf "$T/big.tgz" -C "$T/s" app VERSION
n=$(/usr/bin/wc -c < "$T/big.tgz"); /usr/bin/head -c $((n / 2)) "$T/big.tgz" > "$T/half.tgz"
if ! tar_macmeta_gate "$T/half.tgz" 2>/dev/null; then pass "a tarball cut in half is refused (it cannot read every entry)"
else fail "a truncated tarball must be refused, not judged on its first entries"; fi

tar -czf "$T/empty.tgz" -T /dev/null
if ! tar_macmeta_gate "$T/empty.tgz" 2>/dev/null; then pass "an archive with no entries is refused"
else fail "an empty archive must be refused"; fi

if ! tar_macmeta_gate "$T/missing.tgz" 2>/dev/null; then pass "a missing tarball is refused"
else fail "a missing tarball must be refused"; fi

for f in build-kosmos-bundle.sh:TARBALL_OUT build-tmux-bundle.sh:TARBALL; do
  s="$HERE/${f%%:*}"; v="${f##*:}"
  if [ "$(/usr/bin/grep -cE '^COPYFILE_DISABLE=1 tar -czf "\$'"$v"'" --uname kosmos --gname staff -C "\$[A-Z]+" --no-mac-metadata --no-xattrs ' "$s")" = 1 ] \
     && /usr/bin/grep -qx 'tar_macmeta_gate "$'"$v"'" || exit 1' "$s"; then pass "${f%%:*} packs with all three metadata flags and calls the gate"
  else fail "${f%%:*} must pack with COPYFILE_DISABLE=1 --no-mac-metadata --no-xattrs and call tar_macmeta_gate"; fi
done

[ "$fails" -eq 0 ] && { echo "tar macmeta gate: all arms passed"; exit 0; }
echo "tar macmeta gate: $fails failed"; exit 1
