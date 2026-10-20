#!/bin/bash
# kosmos#6678: tools/lib/tar-metadata-gate.sh refuses a release tarball that carries this Mac's own file metadata
# (an AppleDouble entry, or extended attributes), passes one packed the way the bundles pack, and refuses rather than
# skips when it cannot look. Both bundle builders must pack that way and call the gate.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib/tar-metadata-gate.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/tar-metadata-gate-6678.XXXXXXXXXX")" || { echo "FAIL  could not make a scratch folder"; exit 1; }; trap 'rm -rf "$T"' EXIT
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
mkdir -p "$T/s/app/K.app"; printf 'x\n' > "$T/s/app/K.app/f"; printf 'y\n' > "$T/s/VERSION"

# The control: packed as the bundles pack, from a folder that HAS an extended attribute (so the flags are what keep
# it out, not a tree that never had one).
chflags hidden "$T/s/app/K.app/f" 2>/dev/null || true   # review 3: and a file flag, which --no-fflags keeps out
if command -v xattr >/dev/null 2>&1 && xattr -w com.apple.macl kosmos-6678-test "$T/s/app/K.app" 2>/dev/null; then
  COPYFILE_DISABLE=1 /usr/bin/tar --no-mac-metadata --no-xattrs --no-fflags -czf "$T/clean.tgz" --uname kosmos --gname staff -C "$T/s" app VERSION
  if tar_metadata_gate "$T/clean.tgz" 2>/dev/null; then pass "CONTROL: a folder with an extended attribute, packed as the bundles pack, passes"
  else fail "CONTROL: the bundles' own packing was refused, so every refusal below is vacuous"; fi

  /usr/bin/tar -czf "$T/xattr.tgz" -C "$T/s" app VERSION
  out="$(tar_metadata_gate "$T/xattr.tgz" 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | /usr/bin/grep -q 'metadata records'; then pass "the same folder packed plainly (its extended attribute kept) is refused, and says why"
  else fail "a tarball carrying an extended attribute must be refused (rc=$rc): $out"; fi
else
  echo "SKIP  the extended-attribute arms: this machine cannot set one (no xattr command)"
  COPYFILE_DISABLE=1 /usr/bin/tar --no-mac-metadata --no-xattrs --no-fflags -czf "$T/clean.tgz" --uname kosmos --gname staff -C "$T/s" app VERSION 2>/dev/null \
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
COPYFILE_DISABLE=1 /usr/bin/tar --no-mac-metadata --no-xattrs --no-fflags -czf "$T/big.tgz" -C "$T/s" app VERSION 2>/dev/null || /usr/bin/tar -czf "$T/big.tgz" -C "$T/s" app VERSION
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
if ! tar_metadata_gate "$T/long.tgz" 2>/dev/null; then pass "an AppleDouble entry at the end of a long path is refused (its last part is in the name field either way)"
else fail "an AppleDouble entry with a long path must be refused"; fi

# Review 1: a GNU long name (an L entry) is the next entry's name. Packed with --format gnutar and a deep path, the
# ._K entry's own header holds only the first 100 bytes of its path.
COPYFILE_DISABLE=1 /usr/bin/tar --format gnutar -czf "$T/gnu.tgz" -C "$T/l" app
if ! tar_metadata_headers "$T/gnu.tgz" 2>/dev/null; then pass "an AppleDouble entry behind a GNU long name is refused (the header layer alone)"
else fail "an AppleDouble entry with a GNU long name must be refused"; fi

# Review 1: a pax path record (path=app/._K) ahead of an entry whose own header says app/K. bsdtar never writes this
# (it keeps the start of a name in the header), so it is made by hand; only reading the pax path can refuse it.
# mkhdr NAME TYPE SIZE prints one 512-byte ustar header with a right checksum.
mkhdr() { /usr/bin/perl -e '
  my ($name, $type, $size, $mode) = @ARGV; $mode = "0000644" unless defined $mode;
  my $h = pack("a100 a8 a8 a8 a12 a12 a8 a1 a100 a6 a2 a32 a32 a8 a8 a155 a12",
    $name, $mode, "0000000", "0000000", sprintf("%011o", $size), "00000000000", " " x 8, $type, "",
    "ustar", "00", "kosmos", "staff", "", "", "", "");
  my $sum = unpack("%32C*", $h); substr($h, 148, 8) = sprintf("%06o\0 ", $sum); print $h;' "$@"; }
{ rec2="path=app/._K"; len=$(( ${#rec2} + 4 )); r="$len $rec2"; [ ${#r} -lt "$len" ] || len=$(( len + 1 )); r="$len $rec2"
  mkhdr "PaxHeader/K" x $(( ${#r} + 1 )); printf '%s\n' "$r"; /usr/bin/head -c $(( 512 - ${#r} - 1 )) /dev/zero
  mkhdr "app/K" 0 2; printf 'x\n'; /usr/bin/head -c 510 /dev/zero; /usr/bin/head -c 1024 /dev/zero; } | /usr/bin/gzip -c > "$T/pax.tgz"
paxn="$(/usr/bin/gzip -dc "$T/pax.tgz" | /usr/bin/head -c 600 | LC_ALL=C /usr/bin/grep -a -c 'path=app/._K')"
if [ "$paxn" = 1 ] && ! tar_metadata_headers "$T/pax.tgz" 2>/dev/null; then pass "an entry whose pax path is an AppleDouble name is refused (its header says app/K)"
else fail "a pax path naming an AppleDouble entry must be refused (fixture holds it: $paxn)"; fi
{ mkhdr "app/K" 0 2; printf 'x\n'; /usr/bin/head -c 510 /dev/zero; /usr/bin/head -c 1024 /dev/zero; } | /usr/bin/gzip -c > "$T/plain-made.tgz"
if tar_metadata_gate "$T/plain-made.tgz" 2>/dev/null; then pass "CONTROL: the same hand-made entry without the pax path passes (the fixture maker is sound)"
else fail "CONTROL: a hand-made plain entry was refused, so the pax arm above proves nothing"; fi

# Review 2: pax records the reader cannot read whole are refused. blk BODY prints BODY padded to 512-byte blocks;
# paxtar BODY ENTRY... makes a tarball whose x header holds BODY, then plain entries (each "x\n").
blk() { /usr/bin/perl -e 'my $b = shift; print $b, "\0" x ((512 - length($b) % 512) % 512)' "$1"; }
paxtar() { local body="$1"; shift; { mkhdr "PaxHeader/x" x ${#body}; blk "$body"
  for e in "$@"; do case "$e" in L:*) mkhdr "././@LongLink" L $(( ${#e} - 2 + 1 )); blk "${e#L:}"; ;; *) mkhdr "$e" 0 2; blk "x"; ;; esac; done
  /usr/bin/head -c 1024 /dev/zero; } | /usr/bin/gzip -c; }
# A record of length 0 looped the reader for ever; under a 20-second alarm it must be refused, not hang (142).
paxtar "0 path=x
" app/K > "$T/zero.tgz"
/usr/bin/perl -e 'alarm 20; exec @ARGV' bash -c '. "$1"; tar_metadata_gate "$2"' _ "$HERE/lib/tar-metadata-gate.sh" "$T/zero.tgz" 2>/dev/null; rc=$?
if [ "$rc" = 1 ]; then pass "a pax record of length 0 is refused, not looped on"
else fail "a pax record of length 0 must be refused (rc=$rc; 142 is the alarm: it hung)"; fi
# A record that does not parse used to end the loop quietly, hiding an extended attribute after it.
paxtar "garbage
20 SCHILY.xattr.a=b
" app/K > "$T/hidden.tgz"
if tar_metadata_gate "$T/hidden.tgz" 2>&1 | /usr/bin/grep -q 'could not read all'; then pass "a pax record that does not parse is refused (it hid the attribute after it)"
else fail "an unreadable pax record must be refused"; fi
# A record that claims more bytes than the body holds would swallow the attribute record after it into its own
# value; the length rule refuses it.
paxtar "99 path=x
20 SCHILY.xattr.a=b
" app/K > "$T/long-rec.tgz"
if tar_metadata_gate "$T/long-rec.tgz" 2>&1 | /usr/bin/grep -q 'could not read all'; then pass "a pax record longer than its body is refused (it would swallow the attribute after it)"
else fail "a pax record longer than its body must be refused"; fi
# A record of the right length that is not KEY=VALUE, then an attribute: refused too, by the KEY=VALUE rule.
paxtar "12 noequals
20 SCHILY.xattr.a=b
" app/K > "$T/noeq.tgz"
if tar_metadata_gate "$T/noeq.tgz" 2>&1 | /usr/bin/grep -q 'could not read all'; then pass "a pax record that is not KEY=VALUE is refused"
else fail "a pax record that is not KEY=VALUE must be refused"; fi
paxtar "20 SCHILY.xattr.a=b
" app/K > "$T/goodx.tgz"
out="$(tar_metadata_gate "$T/goodx.tgz" 2>&1)"
if printf '%s' "$out" | /usr/bin/grep -q '1 metadata records'; then pass "CONTROL: the same attribute as a well-formed record is read and refused for what it is"
else fail "CONTROL: a well-formed attribute record was not read as one: $out"; fi
# A pax path followed by a GNU long name: both are names the entry could be extracted under, so both are checked.
paxtar "17 path=app/._P2
" L:app/ok2 app/ok2 > "$T/paxL.tgz"
if tar_metadata_headers "$T/paxL.tgz" 2>&1 | /usr/bin/grep -q 'AppleDouble entries'; then pass "a pax path naming an AppleDouble entry is still seen when a GNU long name follows it"
else fail "a pax path followed by a long name must still be checked"; fi

# Review 3: more of this Mac metadata, and records that would desynchronise the reader from bsdtar.
mkdir -p "$T/fl/app"; printf 'x\n' > "$T/fl/app/f"; chflags hidden "$T/fl/app/f" 2>/dev/null
COPYFILE_DISABLE=1 /usr/bin/tar --no-mac-metadata --no-xattrs -czf "$T/fflags.tgz" -C "$T/fl" app
if [ "$(/usr/bin/gzip -dc "$T/fflags.tgz" | LC_ALL=C /usr/bin/grep -a -c 'SCHILY.fflags')" -ge 1 ] && ! tar_metadata_gate "$T/fflags.tgz" 2>/dev/null; then pass "a file flag (chflags hidden), packed without --no-fflags, is refused"
else fail "a tarball carrying a file flag must be refused"; fi
chflags nohidden "$T/fl/app/f" 2>/dev/null
# Review 6: an install-style extraction does NOT restore a stored file flag (only tar --fflags does; measured), so the
# header layer is what refuses one, and the extraction layer's flag scan is a backstop for a future default. This arm
# records that: if bsdtar ever starts restoring flags on a plain -x, it goes red and the scan is then what catches it.
if tar_metadata_extracted "$T/fflags.tgz" 2>/dev/null; then pass "an install-style extraction restores no stored file flag (the header layer refuses the record)"
else fail "an install-style extraction now restores a stored file flag: the header layer is no longer the only refusal"; fi
# Review 7: a folder with no permissions at all (0000) is still scanned and still removed.
mkdir -p "$T/gtmp3"   # hand-made: tar cannot pack the inside of a 0000 folder, but bsdtar extracts one (modes last)
{ mkhdr app/ 5 0 0000755; mkhdr app/shut/ 5 0 0000000; mkhdr app/shut/f 0 2; blk "x"; /usr/bin/head -c 1024 /dev/zero; } | /usr/bin/gzip -c > "$T/z0.tgz"
if ( TMPDIR="$T/gtmp3" tar_metadata_gate "$T/z0.tgz" ) 2>/dev/null && [ -z "$(ls -A "$T/gtmp3")" ]; then pass "a tarball with a 0000 folder is scanned and passes, leaving nothing behind"
else fail "a 0000 folder was refused or left behind: $(ls -A "$T/gtmp3" | tr '\n' ' ')"; chmod -R u+rwX "$T/gtmp3" 2>/dev/null; fi
# Review 6: a read-only folder in the tarball must not leave the unpacked copy behind (rm alone failed on it).
mkdir -p "$T/ro/app/locked" "$T/gtmp"; printf 'x\n' > "$T/ro/app/locked/f"; chmod 0555 "$T/ro/app/locked"
COPYFILE_DISABLE=1 /usr/bin/tar --no-mac-metadata --no-xattrs --no-fflags -czf "$T/ro.tgz" -C "$T/ro" app; chmod 0755 "$T/ro/app/locked"
if ( TMPDIR="$T/gtmp" tar_metadata_gate "$T/ro.tgz" ) 2>/dev/null && [ -z "$(ls -A "$T/gtmp")" ]; then pass "a tarball with a read-only folder passes and leaves nothing behind"
else fail "a read-only folder left the unpacked copy behind, or was refused: $(ls -A "$T/gtmp" | tr '\n' ' ')"; chmod -R u+rwX "$T/gtmp" 2>/dev/null; fi
paxtar "10 size=0
" app/K > "$T/psize.tgz"
if tar_metadata_gate "$T/psize.tgz" 2>&1 | /usr/bin/grep -q 'could not read all'; then pass "a pax size record is refused (bsdtar would follow it and read different entries)"
else fail "a pax size record must be refused"; fi
paxtar "25 LIBARCHIVE.xattr.x=eA
" app/K > "$T/libx.tgz"
paxtar "31 SCHILY.acl.access=user::rw-
" app/K > "$T/acl.tgz"
if tar_metadata_gate "$T/acl.tgz" 2>&1 | /usr/bin/grep -q '1 metadata records'; then pass "an ACL record is refused (review 5)"
else fail "an ACL record must be refused"; fi
if tar_metadata_gate "$T/libx.tgz" 2>&1 | /usr/bin/grep -q '1 metadata records'; then pass "an attribute in the LIBARCHIVE form alone is refused"
else fail "a LIBARCHIVE.xattr record alone must be refused"; fi
{ mkhdr "GlobalHead" g 20; blk "20 SCHILY.xattr.a=b
"; mkhdr app/K 0 2; blk "x"; /usr/bin/head -c 1024 /dev/zero; } | /usr/bin/gzip -c > "$T/glob.tgz"
if tar_metadata_gate "$T/glob.tgz" 2>&1 | /usr/bin/grep -q '1 metadata records'; then pass "an attribute in a global (g) pax header is refused"
else fail "an attribute in a g header must be refused"; fi
# Review 3: the reader's own truncation guards, reached past gzip -t by compressing a cut stream whole.
mkdir -p "$T/tr/app"; /usr/bin/head -c 3000 /dev/urandom > "$T/tr/app/big"; COPYFILE_DISABLE=1 /usr/bin/tar --no-mac-metadata --no-xattrs --no-fflags -cf "$T/tr.tar" -C "$T/tr" app
/usr/bin/head -c 2048 "$T/tr.tar" | /usr/bin/gzip -c > "$T/midbody.tgz"
/usr/bin/head -c 1024 "$T/tr.tar" | /usr/bin/gzip -c > "$T/noend.tgz"
for c in midbody noend; do
  if /usr/bin/gzip -t "$T/$c.tgz" && tar_metadata_gate "$T/$c.tgz" 2>&1 | /usr/bin/grep -q 'could not read all'; then pass "a whole gzip of a tar cut short ($c) is refused by the header reader itself"
  else fail "a tar cut short ($c), compressed whole, must be refused"; fi
done
mkhdr app/K 0 2 | /usr/bin/perl -e 'binmode STDIN; binmode STDOUT; local $/; my $h = <STDIN>; substr($h, 124, 12) = "\x80" . ("\0" x 11); substr($h, 148, 8) = " " x 8; my $sum = unpack("%32C*", $h); substr($h, 148, 8) = sprintf("%06o\0 ", $sum); print $h' > "$T/b256.hdr"
{ cat "$T/b256.hdr"; blk "x"; /usr/bin/head -c 1024 /dev/zero; } | /usr/bin/gzip -c > "$T/b256.tgz"
if tar_metadata_gate "$T/b256.tgz" 2>&1 | /usr/bin/grep -q 'could not read all'; then pass "a base-256 size (8 GiB or more) is refused"
else fail "a base-256 size must be refused"; fi
# Review 4: bsdtar reads no body for a folder or a link whatever its size says; one with a size would make the
# reader skip the next entry (a ._ file bsdtar extracts). Refused, as is a type byte bsdtar does not know.
for ty in 5 2 1; do
  # The ._ entry has no body, so a reader that skipped it as the sized entry's body would see a clean end and pass.
  { mkhdr a/file 0 2; blk "x"; mkhdr a/thing "$ty" 512; mkhdr a/._hidden 0 0; /usr/bin/head -c 1024 /dev/zero; } | /usr/bin/gzip -c > "$T/sized$ty.tgz"
  if tar_metadata_gate "$T/sized$ty.tgz" 2>&1 | /usr/bin/grep -q 'could not read all'; then pass "a type-$ty entry with a size is refused (it would hide the ._ entry after it)"
  else fail "a type-$ty entry with a size must be refused"; fi
done
{ mkhdr a/file Z 0; /usr/bin/head -c 1024 /dev/zero; } | /usr/bin/gzip -c > "$T/badtype.tgz"
if tar_metadata_gate "$T/badtype.tgz" 2>&1 | /usr/bin/grep -q 'could not read all'; then pass "an entry type bsdtar does not know is refused"
else fail "an unknown entry type must be refused"; fi
mkdir -p "$T/ln/app/sub"; printf 'x\n' > "$T/ln/app/f"; ln -s f "$T/ln/app/s"; ln "$T/ln/app/f" "$T/ln/app/h"
COPYFILE_DISABLE=1 /usr/bin/tar --no-mac-metadata --no-xattrs --no-fflags -czf "$T/links.tgz" -C "$T/ln" app
if tar_metadata_gate "$T/links.tgz" 2>/dev/null; then pass "CONTROL: a real tarball with a symlink, a hard link and folders passes"
else fail "CONTROL: a tarball with links and folders was refused"; fi
# Review 5: the source of truth is what bsdtar extracts. A forged shape the header reader misreads (a GNU long name
# with a NUL in it: bsdtar cuts the name there, this reader does not) carrying REAL AppleDouble bytes (made here by
# bsdtar --mac-metadata from a file with an attribute) passes the header layer and is refused by the extraction layer.
mkdir -p "$T/mm/a"; printf 'k\n' > "$T/mm/a/K"
if command -v xattr >/dev/null 2>&1 && xattr -w com.example.kosmos6678 v "$T/mm/a/K" 2>/dev/null; then
  /usr/bin/tar --mac-metadata -cf "$T/mm.tar" -C "$T/mm" a
  # forge IN OUT: re-emit the a/._K entry of IN under a GNU long name with a NUL in it (bsdtar cuts there).
  forge() { /usr/bin/perl -e '
    binmode STDIN; binmode STDOUT;
    sub ck { my $h = shift; substr($h, 148, 8) = " " x 8; my $s = unpack("%32C*", $h); substr($h, 148, 8) = sprintf("%06o\0 ", $s); $h }
    sub hd { my ($n, $t, $sz) = @_; ck(pack("a100 a8 a8 a8 a12 a12 a8 a1 a100 a6 a2 a32 a32 a8 a8 a155 a12", $n, "0000644", "0000000", "0000000", sprintf("%011o", $sz), "00000000000", " " x 8, $t, "", "ustar", "00", "", "", "", "", "", "")) }
    sub pd { my $b = shift; $b . ("\0" x ((512 - length($b) % 512) % 512)) }
    while (read(STDIN, my $h, 512) == 512) {
      last if $h eq ("\0" x 512);
      my ($n) = $h =~ /^([^\0]*)/; my $sz = oct("0" . ((substr($h, 124, 12) =~ /([0-7]+)/)[0] // 0)); my $t = substr($h, 156, 1);
      my $b = ""; my $p = ($sz + 511) & ~511; read(STDIN, $b, $p) if $p;
      next if $t eq "x";
      if ($n eq "a/._K") { my $ln = "a/._K\0/zz"; print hd("././\@LongLink", "L", length($ln) + 1), pd($ln . "\0");
        substr($h, 0, 100) = pack("a100", "a/zz"); print ck($h), $b; next }
      print $h, $b;
    }
    print "\0" x 1024;' < "$1" | /usr/bin/gzip -c > "$2"; }
  forge "$T/mm.tar" "$T/nul.tgz"
  hdr="$(tar_metadata_gate "$T/nul.tgz" 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$hdr" | /usr/bin/grep -q 'unpacked as an install does' && printf '%s' "$hdr" | /usr/bin/grep -q 'com.example.kosmos6678'; then pass "a forged ._ entry the header reader misreads (a NUL in its long name) is refused by what bsdtar extracts, naming the attribute it planted"
  else fail "a forged ._ entry with a NUL in its long name must be refused by the extraction layer (rc=$rc): $hdr"; fi
  /usr/bin/tar -czf "$T/plainx.tgz" -C "$T/mm" a
  if ! tar_metadata_extracted "$T/plainx.tgz" 2>/dev/null; then pass "the extraction layer alone refuses a tarball that unpacks with an attribute"
  else fail "the extraction layer must refuse a tarball that unpacks with an attribute"; fi
  mkdir -p "$T/sl/a" "$T/outside"; printf 'o\n' > "$T/outside/o"; xattr -w com.example.kosmos6678 v "$T/outside/o"; ln -s "$T/outside/o" "$T/sl/a/link"
  COPYFILE_DISABLE=1 /usr/bin/tar --no-mac-metadata --no-xattrs --no-fflags -czf "$T/symlink.tgz" -C "$T/sl" a
  if tar_metadata_extracted "$T/symlink.tgz" 2>/dev/null; then pass "a symlink to a file with an attribute is not followed (xattr -s reads the link itself)"
  else fail "the extraction layer followed a symlink out of the unpacked tree"; fi
  # Review 7: the same forged shape carrying an ACL (a deny-delete one, so cleanup is tested too) instead of an
  # attribute: refused naming the ACL, and the unpacked copy is still removed.
  mkdir -p "$T/acl/a" "$T/gtmp2"; printf 'k\n' > "$T/acl/a/K"
  if /bin/chmod +a "everyone deny delete" "$T/acl/a/K" 2>/dev/null; then
    /usr/bin/tar --mac-metadata --no-acls -cf "$T/acl.tar" -C "$T/acl" a; /bin/chmod -N "$T/acl/a/K"
    forge "$T/acl.tar" "$T/aclnul.tgz"
    out="$( ( TMPDIR="$T/gtmp2" tar_metadata_gate "$T/aclnul.tgz" ) 2>&1 )"; rc=$?
    if [ "$rc" -ne 0 ] && printf '%s' "$out" | /usr/bin/grep -q 'an ACL' && [ -z "$(ls -A "$T/gtmp2")" ]; then pass "an ACL a forged ._ entry restores on extraction is refused, and the unpacked copy is removed despite deny-delete"
    else fail "a forged ._ entry restoring an ACL must be refused with nothing left behind (rc=$rc): $out $(ls -A "$T/gtmp2" | tr '\n' ' ')"; /bin/chmod -RN "$T/gtmp2" 2>/dev/null; fi
  else
    echo "SKIP  the ACL arm: this machine cannot set an ACL"
  fi
else
  echo "SKIP  the extraction-layer arms: this machine cannot set an extended attribute"
fi
COPYFILE_DISABLE=1 /usr/bin/tar --no-mac-metadata --no-xattrs --no-fflags -czf "$T/cleanx.tgz" -C "$T/n" app
if tar_metadata_extracted "$T/cleanx.tgz" 2>/dev/null; then pass "CONTROL: a clean tarball unpacks with nothing on it"
else fail "CONTROL: a clean tarball was refused by the extraction layer"; fi
# Review 9: signals during the unpack. The gate runs in a child bash (its own process group, so the signal reaches it
# alone) on a tarball of 20000 small files, whose unpack takes a few seconds; TERM and HUP are sent as soon as its unpack folder appears. Each
# must end the child with the signal (143, 129: passed on, not swallowed) and leave nothing behind. And a caller's
# own trap must survive a normal run.
mkdir -p "$T/big/app"; ( cd "$T/big/app" && /usr/bin/perl -e 'for (1..20000) { open my $f, ">", "f$_" or die; print $f "x\n" }' )   # many small files: the unpack takes seconds
COPYFILE_DISABLE=1 /usr/bin/tar --no-mac-metadata --no-xattrs --no-fflags -czf "$T/big.tgz" -C "$T/big" app; rm -rf "$T/big"
for pair in TERM:143 HUP:129; do
  sig=${pair%%:*}; want=${pair#*:}; st="$T/st-$sig"; mkdir -p "$st"
  TMPDIR="$st" /usr/bin/perl -e 'setpgrp(0, 0); exec @ARGV' /bin/bash -c '. "$1"; tar_metadata_gate "$2"' _ "$HERE/lib/tar-metadata-gate.sh" "$T/big.tgz" > /dev/null 2>&1 &
  cpid=$!; i=0
  # Review 10: a TIGHT poll (no sleep), so the signal lands as close to the folder's creation as it can: before the
  # traps went in first, this left the folder behind every time.
  while [ "$i" -lt 200000 ] && [ -z "$(ls -A "$st" 2>/dev/null)" ] && kill -0 "$cpid" 2>/dev/null; do i=$((i + 1)); done
  kill -s "$sig" "$cpid" 2>/dev/null; { wait "$cpid"; } 2>/dev/null; rc=$?
  if [ "$i" -lt 200000 ] && [ "$rc" = "$want" ] && [ -z "$(ls -A "$st")" ]; then pass "$sig during the unpack ends the gate with the signal ($want) and leaves nothing behind"
  else fail "$sig during the unpack: rc=$rc (want $want), left: $(ls -A "$st" | tr '\n' ' ') (waited $i)"; /bin/chmod -RN "$st" 2>/dev/null; fi
done
# Review 10: the traps must be in place before the unpack folder exists. The gap left when they came after it is a few
# microseconds, too short for any poll to hit reliably, so this order is pinned by the source text, not measured.
ord=$(/usr/bin/awk '/for sig in INT TERM HUP QUIT; do trap/ { if (!t) t = NR } /\/bin\/mkdir -m 700 "\$d"/ { if (!m) m = NR } END { print (t && m && t < m) ? "ok" : t" "m }' "$HERE/lib/tar-metadata-gate.sh")
[ "$ord" = ok ] && pass "the signal traps are installed before the unpack folder is made" || fail "the signal traps come after the unpack folder is made (lines $ord)"
# Review 11: a caller's own handler must run when the signal lands during the gate (its traps go back before the
# signal is passed on).
st="$T/st-caller"; mkdir -p "$st"; mk="$T/caller-ran"; rm -f "$mk"
TMPDIR="$st" /usr/bin/perl -e 'setpgrp(0, 0); exec @ARGV' /bin/bash -c 'trap "echo ran > \"$3\"; exit 143" TERM; . "$1"; tar_metadata_gate "$2"' _ "$HERE/lib/tar-metadata-gate.sh" "$T/big.tgz" "$mk" > /dev/null 2>&1 &
cpid=$!; i=0
while [ "$i" -lt 200000 ] && [ -z "$(ls -A "$st" 2>/dev/null)" ] && kill -0 "$cpid" 2>/dev/null; do i=$((i + 1)); done
kill -s TERM "$cpid" 2>/dev/null; { wait "$cpid"; } 2>/dev/null
if [ -s "$mk" ] && [ -z "$(ls -A "$st")" ]; then pass "a caller's own TERM handler runs when TERM lands during the gate, and nothing is left behind"
else fail "a caller's TERM handler did not run during the gate, or something was left: $(ls -A "$st" | tr '\n' ' ')"; fi
# Review 11: a # and a [ in TMPDIR must not blind the extraction layer (they broke a sed program built from the path).
if command -v xattr >/dev/null 2>&1; then
  odd="$T/odd#dir[x"; mkdir -p "$odd"
  if ( TMPDIR="$odd" tar_metadata_extracted "$T/plainx.tgz" ) 2>&1 | /usr/bin/grep -q 'com.example.kosmos6678'; then pass "a # and a [ in TMPDIR do not blind the extraction layer"
  else fail "with a # and a [ in TMPDIR the extraction layer missed the attribute"; fi
fi
kept="$( /bin/bash -c 'trap "echo caller" TERM; . "$1"; tar_metadata_gate "$2" > /dev/null 2>&1; trap -p TERM' _ "$HERE/lib/tar-metadata-gate.sh" "$T/cleanx.tgz" )"
if printf '%s' "$kept" | /usr/bin/grep -q 'echo caller'; then pass "a caller's own TERM trap is restored after the gate runs"
else fail "the gate did not restore the caller's TERM trap: $kept"; fi
# Complete entries but no end-of-archive blocks: only the end rule can refuse it (the body read and gzip are whole).
{ mkhdr app/K 0 2; blk "x"; } | /usr/bin/gzip -c > "$T/noendblk.tgz"
if tar_metadata_gate "$T/noendblk.tgz" 2>&1 | /usr/bin/grep -q 'could not read all'; then pass "whole entries with no end-of-archive blocks are refused"
else fail "a tar with no end-of-archive blocks must be refused"; fi
# Review 3: after the end of the archive, zero padding passes and anything else is refused, whatever pipefail says.
{ mkhdr app/K 0 2; blk "x"; /usr/bin/head -c 1024 /dev/zero; /usr/bin/head -c 9216 /dev/zero; } | /usr/bin/gzip -c > "$T/pad.tgz"
{ mkhdr app/K 0 2; blk "x"; /usr/bin/head -c 1024 /dev/zero; printf 'trailing'; } | /usr/bin/gzip -c > "$T/trail.tgz"
if tar_metadata_gate "$T/pad.tgz" 2>/dev/null; then pass "CONTROL: zero padding after the end of the archive passes"
else fail "CONTROL: zero padding after the end must pass"; fi
if ( set +o pipefail; tar_metadata_gate "$T/trail.tgz" 2>&1 ) | /usr/bin/grep -q 'could not read all'; then pass "data after the end of the archive is refused, with pipefail off"
else fail "trailing data must be refused whatever pipefail says"; fi

# Review 1: a header whose checksum does not match is refused, never read as something else.
{ mkhdr "app/K" 0 2 | /usr/bin/perl -pe 'BEGIN { binmode STDIN; binmode STDOUT } substr($_, 0, 1) = "b" if $. == 1'; printf 'x\n'; /usr/bin/head -c 510 /dev/zero; /usr/bin/head -c 1024 /dev/zero; } | /usr/bin/gzip -c > "$T/badsum.tgz"
if ! tar_metadata_headers "$T/badsum.tgz" 2>/dev/null; then pass "a header whose checksum does not match is refused (the header layer alone)"
else fail "a damaged header must be refused"; fi

for B in "$HERE/build-kosmos-bundle.sh" "$HERE/build-tmux-bundle.sh"; do
  b=$(basename "$B")
  if [ "$(/usr/bin/grep -c '^COPYFILE_DISABLE=1 /usr/bin/tar --no-mac-metadata --no-xattrs --no-fflags -czf ' "$B")" = 1 ] \
    && [ "$(/usr/bin/grep -vE '^[[:space:]]*#' "$B" | /usr/bin/grep -c -E '(^|[^a-z])tar -c')" = 0 ] \
    && /usr/bin/grep -qx 'tar_metadata_gate "$TARBALL\(_OUT\)\{0,1\}" || exit 1' "$B"; then
    pass "$b packs once, without this Mac's metadata, and calls the gate"
  else fail "$b must pack once with COPYFILE_DISABLE=1 /usr/bin/tar --no-mac-metadata --no-xattrs --no-fflags and call tar_metadata_gate"; fi
done

# Review 3: in each builder the order is pack, owner gate, metadata gate, then the .sha256 (which publishes it).
for B in "$HERE/build-kosmos-bundle.sh" "$HERE/build-tmux-bundle.sh"; do
  b=$(basename "$B")
  o=$(/usr/bin/awk '/^COPYFILE_DISABLE=1 \/usr\/bin\/tar /{p=NR} /^tar_owner_gate /{q=NR} /^tar_metadata_gate /{r=NR} /shasum -a 256 .*TARBALL/{if (r && !s) s=NR} END{print (p && q && r && s && p < q && q < r && r < s) ? "ok" : p" "q" "r" "s}' "$B")
  [ "$o" = ok ] && pass "$b: pack, owner gate, metadata gate, then the .sha256" || fail "$b: the order is not pack, owner gate, metadata gate, .sha256 (lines $o)"
done

if [ "$fails" -ne 0 ]; then echo "$fails check(s) failed"; exit 1; fi
echo "all checks passed"
