#!/bin/bash
# kosmos#6678: tools/lib/tar-metadata-gate.sh refuses a release tarball that carries this Mac's own file metadata
# (an AppleDouble entry, or extended attributes), passes one packed the way the bundles pack, and refuses rather than
# skips when it cannot look. Both bundle builders must pack that way and call the gate.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib/tar-metadata-gate.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/tar-metadata-gate-6678.XXXXXXXXXX")"; trap 'rm -rf "$T"' EXIT
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
mkdir -p "$T/s/app/K.app"; printf 'x\n' > "$T/s/app/K.app/f"; printf 'y\n' > "$T/s/VERSION"

# The control: packed as the bundles pack, from a folder that HAS an extended attribute (so the flags are what keep
# it out, not a tree that never had one).
if command -v xattr >/dev/null 2>&1 && xattr -w com.apple.macl kosmos-6678-test "$T/s/app/K.app" 2>/dev/null; then
  COPYFILE_DISABLE=1 /usr/bin/tar --no-mac-metadata --no-xattrs -czf "$T/clean.tgz" --uname kosmos --gname staff -C "$T/s" app VERSION
  if tar_metadata_gate "$T/clean.tgz" 2>/dev/null; then pass "CONTROL: a folder with an extended attribute, packed as the bundles pack, passes"
  else fail "CONTROL: the bundles' own packing was refused, so every refusal below is vacuous"; fi

  /usr/bin/tar -czf "$T/xattr.tgz" -C "$T/s" app VERSION
  out="$(tar_metadata_gate "$T/xattr.tgz" 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | /usr/bin/grep -q 'extended-attribute records'; then pass "the same folder packed plainly (its extended attribute kept) is refused, and says why"
  else fail "a tarball carrying an extended attribute must be refused (rc=$rc): $out"; fi
else
  echo "SKIP  the extended-attribute arms: this machine cannot set one (no xattr command)"
  COPYFILE_DISABLE=1 /usr/bin/tar --no-mac-metadata --no-xattrs -czf "$T/clean.tgz" --uname kosmos --gname staff -C "$T/s" app VERSION 2>/dev/null \
    || /usr/bin/tar -czf "$T/clean.tgz" -C "$T/s" app VERSION
  if tar_metadata_gate "$T/clean.tgz" 2>/dev/null; then pass "CONTROL: a plain tarball passes"
  else fail "CONTROL: a plain tarball was refused, so every refusal below is vacuous"; fi
fi

# An AppleDouble entry, made by hand so the arm does not depend on when macOS chooses to write one. Packed with
# COPYFILE_DISABLE=1 so tar stores ._K as an entry (without it, macOS tar folds ._K into K and stores no such entry).
mkdir -p "$T/d/app"; printf 'x\n' > "$T/d/app/K"; printf 'meta\n' > "$T/d/app/._K"
COPYFILE_DISABLE=1 /usr/bin/tar -czf "$T/dbl.tgz" -C "$T/d" app
out="$(tar_metadata_gate "$T/dbl.tgz" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | /usr/bin/grep -qF 'app/._K'; then pass "an AppleDouble entry is refused and named"
else fail "an AppleDouble entry must be refused and named (rc=$rc): $out"; fi

mkdir -p "$T/e"; printf 'x\n' > "$T/e/._top"
COPYFILE_DISABLE=1 /usr/bin/tar -czf "$T/dbltop.tgz" -C "$T/e" ._top
if ! tar_metadata_gate "$T/dbltop.tgz" 2>/dev/null; then pass "an AppleDouble entry at the top level is refused too"
else fail "a top-level ._ entry must be refused"; fi

mkdir -p "$T/n/app"; printf 'x\n' > "$T/n/app/a._b"; printf 'x\n' > "$T/n/app/x.y"
/usr/bin/tar -czf "$T/near.tgz" -C "$T/n" app
if tar_metadata_gate "$T/near.tgz" 2>/dev/null; then pass "a name with ._ inside it, not at its start, is not a hit"
else fail "a name that only contains ._ must not be refused"; fi

for i in $(seq 1 300); do printf '%s\n' "$i" > "$T/s/app/f$i"; done
COPYFILE_DISABLE=1 /usr/bin/tar --no-mac-metadata --no-xattrs -czf "$T/big.tgz" -C "$T/s" app VERSION 2>/dev/null || /usr/bin/tar -czf "$T/big.tgz" -C "$T/s" app VERSION
n=$(/usr/bin/wc -c < "$T/big.tgz"); /usr/bin/head -c $((n / 2)) "$T/big.tgz" > "$T/half.tgz"
if ! tar_metadata_gate "$T/half.tgz" 2>/dev/null; then pass "a tarball cut in half is refused"
else fail "a truncated tarball must be refused, not judged on its first part"; fi

printf 'not a tarball\n' > "$T/junk.tgz"
if ! tar_metadata_gate "$T/junk.tgz" 2>/dev/null; then pass "a file that is not a tarball is refused"
else fail "an unreadable tarball must be refused"; fi

/usr/bin/tar -czf "$T/empty.tgz" -T /dev/null
if ! tar_metadata_gate "$T/empty.tgz" 2>/dev/null; then pass "an archive with no entries is refused"
else fail "an empty archive must be refused"; fi

if ! tar_metadata_gate "$T/missing.tgz" 2>/dev/null; then pass "a missing tarball is refused"
else fail "a missing tarball must be refused"; fi

# A long path (over 100 bytes; bsdtar stores it in the ustar prefix) ending in an AppleDouble name.
L="$T/l/app/$(printf 'x%.0s' $(seq 1 120))"; mkdir -p "$L"; printf 'x\n' > "$L/K"; printf 'm\n' > "$L/._K"
COPYFILE_DISABLE=1 /usr/bin/tar -czf "$T/long.tgz" -C "$T/l" app
if ! tar_metadata_gate "$T/long.tgz" 2>/dev/null; then pass "an AppleDouble entry behind a long path (the ustar prefix) is refused"
else fail "an AppleDouble entry with a long path must be refused"; fi

# Review 1: a GNU long name (an L entry) is the next entry's name. Packed with --format gnutar and a deep path, the
# ._K entry's own header holds only the first 100 bytes of its path.
COPYFILE_DISABLE=1 /usr/bin/tar --format gnutar -czf "$T/gnu.tgz" -C "$T/l" app
if ! tar_metadata_gate "$T/gnu.tgz" 2>/dev/null; then pass "an AppleDouble entry behind a GNU long name is refused"
else fail "an AppleDouble entry with a GNU long name must be refused"; fi

# Review 1: a pax path record (path=app/._K) ahead of an entry whose own header says app/K. bsdtar never writes this
# (it keeps the start of a name in the header), so it is made by hand; only reading the pax path can refuse it.
# mkhdr NAME TYPE SIZE prints one 512-byte ustar header with a right checksum.
mkhdr() { /usr/bin/perl -e '
  my ($name, $type, $size) = @ARGV;
  my $h = pack("a100 a8 a8 a8 a12 a12 a8 a1 a100 a6 a2 a32 a32 a8 a8 a155 a12",
    $name, "0000644", "0000000", "0000000", sprintf("%011o", $size), "00000000000", " " x 8, $type, "",
    "ustar", "00", "kosmos", "staff", "", "", "", "");
  my $sum = unpack("%32C*", $h); substr($h, 148, 8) = sprintf("%06o\0 ", $sum); print $h;' "$@"; }
{ rec2="path=app/._K"; len=$(( ${#rec2} + 4 )); r="$len $rec2"; [ ${#r} -lt "$len" ] || len=$(( len + 1 )); r="$len $rec2"
  mkhdr "PaxHeader/K" x $(( ${#r} + 1 )); printf '%s\n' "$r"; /usr/bin/head -c $(( 512 - ${#r} - 1 )) /dev/zero
  mkhdr "app/K" 0 2; printf 'x\n'; /usr/bin/head -c 510 /dev/zero; /usr/bin/head -c 1024 /dev/zero; } | /usr/bin/gzip -c > "$T/pax.tgz"
paxn="$(/usr/bin/gzip -dc "$T/pax.tgz" | /usr/bin/head -c 600 | LC_ALL=C /usr/bin/grep -a -c 'path=app/._K')"
if [ "$paxn" = 1 ] && ! tar_metadata_gate "$T/pax.tgz" 2>/dev/null; then pass "an entry whose pax path is an AppleDouble name is refused (its header says app/K)"
else fail "a pax path naming an AppleDouble entry must be refused (fixture holds it: $paxn)"; fi
{ mkhdr "app/K" 0 2; printf 'x\n'; /usr/bin/head -c 510 /dev/zero; /usr/bin/head -c 1024 /dev/zero; } | /usr/bin/gzip -c > "$T/plain-made.tgz"
if tar_metadata_gate "$T/plain-made.tgz" 2>/dev/null; then pass "CONTROL: the same hand-made entry without the pax path passes (the fixture maker is sound)"
else fail "CONTROL: a hand-made plain entry was refused, so the pax arm above proves nothing"; fi

# Review 1: a header whose checksum does not match is refused, never read as something else.
{ mkhdr "app/K" 0 2 | /usr/bin/perl -pe 'BEGIN { binmode STDIN; binmode STDOUT } substr($_, 0, 1) = "b" if $. == 1'; printf 'x\n'; /usr/bin/head -c 510 /dev/zero; /usr/bin/head -c 1024 /dev/zero; } | /usr/bin/gzip -c > "$T/badsum.tgz"
if ! tar_metadata_gate "$T/badsum.tgz" 2>/dev/null; then pass "a header whose checksum does not match is refused"
else fail "a damaged header must be refused"; fi

for B in "$HERE/build-kosmos-bundle.sh" "$HERE/build-tmux-bundle.sh"; do
  b=$(basename "$B")
  if [ "$(/usr/bin/grep -c '^COPYFILE_DISABLE=1 /usr/bin/tar --no-mac-metadata --no-xattrs -czf ' "$B")" = 1 ] \
    && [ "$(/usr/bin/grep -vE '^[[:space:]]*#' "$B" | /usr/bin/grep -c -E '(^|[^a-z])tar -c')" = 0 ] \
    && /usr/bin/grep -qx 'tar_metadata_gate "$TARBALL\(_OUT\)\{0,1\}" || exit 1' "$B"; then
    pass "$b packs once, without this Mac's metadata, and calls the gate"
  else fail "$b must pack once with COPYFILE_DISABLE=1 /usr/bin/tar --no-mac-metadata --no-xattrs and call tar_metadata_gate"; fi
done

if [ "$fails" -ne 0 ]; then echo "$fails check(s) failed"; exit 1; fi
echo "all checks passed"
