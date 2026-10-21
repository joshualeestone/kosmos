#!/bin/bash
# kosmos#6678: tools/lib/tar-macmeta-gate.sh refuses a release tarball that carries the build Mac's extended attributes
# (an AppleDouble `._` entry, or an xattr pax header), passes one packed the way the bundles pack, and refuses rather
# than skips when it cannot read the tarball. The arms show what each partial packing leaves in: --no-xattrs alone, the
# Mac-metadata pair without --no-xattrs, and the first three without --no-fflags.
set -u
unset COPYFILE_DISABLE   # a caller's exported COPYFILE_DISABLE=1 would stop the plain pack writing the ._ entry the arms expect
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib/tar-macmeta-gate.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/tar-macmeta-gate-6678.XXXXXXXXXX")"; trap 'rm -rf "$T"' EXIT
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
mkdir -p "$T/s/app"; printf 'x\n' > "$T/s/app/f"; printf 'y\n' > "$T/s/VERSION"

if [ "$(uname -s)" = Darwin ] && command -v xattr >/dev/null 2>&1 && xattr -w user.kev6678 probe "$T/s/app/f" 2>/dev/null; then
  pack() { env "$@" -czf "$T/p.tgz" --uname kosmos --gname staff -C "$T/s" app VERSION; }
  pack COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs --no-fflags
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
  if ! chflags hidden "$T/s/VERSION" 2>/dev/null; then fail "FIXTURE: chflags hidden did not take (a TMPDIR without file flags?), so the fflags arms below mean nothing"; fi
  pack COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs
  out="$(tar_macmeta_gate "$T/p.tgz" 2>&1)"
  if printf '%s' "$out" | /usr/bin/grep -qF 'file flags SCHILY.fflags'; then pass "file flags (chflags hidden) without --no-fflags are caught; bsdtar would restore them on extract"
  else fail "file flags must be caught: $out"; fi
  pack COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs --no-fflags
  if tar_macmeta_gate "$T/p.tgz" 2>/dev/null; then pass "with --no-fflags too, the flagged file packs clean"
  else fail "the bundles' full packing must pass with a flagged file"; fi
  chflags nohidden "$T/s/VERSION"
  pack COPYFILE_DISABLE=1 tar --no-mac-metadata
  out="$(tar_macmeta_gate "$T/p.tgz" 2>&1)"
  if printf '%s' "$out" | /usr/bin/grep -qF 'extended attribute' && ! printf '%s' "$out" | /usr/bin/grep -qF 'AppleDouble'; then pass "--no-mac-metadata alone still leaves the xattr header, and it is caught"
  else fail "--no-mac-metadata alone: the xattr header must be caught: $out"; fi
else
  echo "  skip the xattr arms: uname=$(uname -s), xattr command $(command -v xattr >/dev/null 2>&1 && echo present || echo absent), xattr -w on TMPDIR $( [ "$(uname -s)" = Darwin ] && echo failed || echo not tried) (the bundles are built on a Mac)"
fi

# Fixtures are written entry by entry with /usr/bin/perl (no python3: see the gate's header). mk <out.tgz> <spec>...
# where each spec is TYPE:NAME:PAYLOAD (payload with \n escapes; TYPE 0 file, 5 folder, x pax, L/K GNU long name/link),
# then the two zero blocks.
mk() { local out="$1"; shift; /usr/bin/perl -e '
  binmode STDOUT;
  for my $s (@ARGV) { my ($t, $n, $p) = split /:/, $s, 3; $p //= ""; $p =~ s/\\n/\n/g;
    my $h = pack("a100 a8 a8 a8 a12 a12 A8 a1 a100 a6 a2 a32 a32 a8 a8 a155 a12", $n, "0000644", "0000000", "0000000",
      sprintf("%011o", length $p), sprintf("%011o", 0), "", $t, "", "ustar", "00", "", "", "", "", "", "");
    my $sum = 0; $sum += $_ for unpack("C*", substr($h, 0, 148) . (" " x 8) . substr($h, 156));
    substr($h, 148, 8) = sprintf("%06o\0 ", $sum);
    print $h, $p, "\0" x ((512 - length($p) % 512) % 512) }
  print "\0" x 1024' "$@" | /usr/bin/gzip -c > "$out"; }
rec() { /usr/bin/perl -e 'my $kv = "$ARGV[0]=$ARGV[1]\n"; my $l = length($kv) + 2; $l++ while length("$l $kv") != $l; (my $o = "$l $kv") =~ s/\n/\\n/g; print $o' "$1" "$2"; }   # newline as a \n escape, which mk decodes
mk "$T/ad.tgz" "0:app/f:x" "0:app/._f:Mac OS X" "x:app/PaxHeader/g:$(rec SCHILY.xattr.com.apple.provenance p)" "0:app/g:y" "5:._app/:"
out="$(tar_macmeta_gate "$T/ad.tgz" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | /usr/bin/grep -qF 'AppleDouble entry app/._f' && printf '%s' "$out" | /usr/bin/grep -qF 'SCHILY.xattr.com.apple.provenance' && printf '%s' "$out" | /usr/bin/grep -qF 'AppleDouble entry ._app'; then pass "a built tarball with both kinds, and a ._ folder, is refused and each named (any OS)"
else fail "a built tarball with both kinds must be refused (rc=$rc): $out"; fi

mk "$T/clean.tgz" "0:VERSION:y"   # written byte by byte: a Mac that tags new files (com.apple.provenance) cannot add metadata to it
if tar_macmeta_gate "$T/clean.tgz" 2>/dev/null; then pass "a tarball of a file with no attributes passes"
else fail "a clean tarball must pass"; fi

if ( PATH=/nonexistent; tar_macmeta_gate "$T/clean.tgz" ) 2>/dev/null; then pass "the gate runs with an empty PATH (no python3, no developer tools: /usr/bin/perl and gzip only)"
else fail "the gate must not depend on PATH"; fi

/usr/bin/perl -e 'print "x" x 512, "\0" x 1024' | /usr/bin/gzip -c > "$T/badsum.tgz"
if ! tar_macmeta_gate "$T/badsum.tgz" 2>/dev/null; then pass "a header with a bad checksum is refused, not read as an entry"
else fail "a corrupt header must be refused"; fi

# bounded CMD...: runs CMD in its own process group and kills the WHOLE group after 20 s (exit 142), so a reader that
# loops forever fails the arm instead of hanging the test. A bare alarm+exec is not enough: it kills the shell and leaves
# the looping reader holding the output pipe open, so the $(...) never returns (measured on the previous gate).
bounded() { /usr/bin/perl -e 'my $pid = fork() // exit 127; if (!$pid) { setpgrp(0, 0); exec @ARGV; exit 127 }
  $SIG{ALRM} = sub { kill "KILL", -$pid; waitpid($pid, 0); exit 142 }; alarm 20; waitpid($pid, 0); exit($? >> 8)' "$@"; }
mk "$T/tail.tgz" "0:app/f:x"; { /usr/bin/gzip -dc "$T/tail.tgz"; /usr/bin/head -c 1048576 /dev/zero; } | /usr/bin/gzip -c > "$T/tail2.tgz"
if tar_macmeta_gate "$T/tail2.tgz" 2>/dev/null; then pass "a clean tarball with 1 MB of padding after its end marker passes (the reader drains, so gzip is not killed by SIGPIPE)"
else fail "a long tail after the end marker must not fail a clean tarball: $(tar_macmeta_gate "$T/tail2.tgz" 2>&1)"; fi

for bad in '0 k=v\n' 'garbage\n' '99 k=v\n'; do
  mk "$T/pax.tgz" "x:app/PaxHeader/f:$bad" "0:app/f:x"
  out="$(bounded bash -c '. "$1"; tar_macmeta_gate "$2"' _ "$HERE/lib/tar-macmeta-gate.sh" "$T/pax.tgz" 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 142 ] && printf '%s' "$out" | /usr/bin/grep -qF 'malformed pax record'; then pass "a malformed pax record ($bad) is refused, not skipped or looped on"
  else fail "a malformed pax record ($bad) must be refused (rc=$rc, 142 = hung): $out"; fi
done

mk "$T/glob.tgz" "g:pax_global_header:$(rec path clean)" "0:._x:x"
out="$(tar_macmeta_gate "$T/glob.tgz" 2>&1)"
if printf '%s' "$out" | /usr/bin/grep -qF 'AppleDouble entry ._x'; then pass "a global (g) header's path does not rename the next entry, so its ._x is still caught"
else fail "a g header's path must not rename the next entry: $out"; fi

deep="app/$(printf 'c%.0s' $(seq 1 120))"
mk "$T/xpath.tgz" "x:PaxHeader/p:$(rec path "$deep/._long")" "0:placeholder:x"
out="$(tar_macmeta_gate "$T/xpath.tgz" 2>&1)"
if printf '%s' "$out" | /usr/bin/grep -qxF "  AppleDouble entry $deep/._long"; then pass "an x header's path renames the next entry exactly (how bsdtar names a ._ path over 100 bytes)"
else fail "an x header's path must rename the next entry, exactly: $out"; fi
mk "$T/xpath2.tgz" "x:PaxHeader/p:$(rec path "$deep/clean")" "0:._placeholder:x"
if tar_macmeta_gate "$T/xpath2.tgz" 2>/dev/null; then pass "and the renamed entry is judged by that path, not its ._ placeholder"
else fail "the x header's path must replace the placeholder name: $(tar_macmeta_gate "$T/xpath2.tgz" 2>&1)"; fi

long="$(printf 'd%.0s' $(seq 1 120))/plain"
mk "$T/gnu.tgz" "L:././@LongLink:$long" "K:././@LongLink:somewhere" "0:._x:x"
if tar_macmeta_gate "$T/gnu.tgz" 2>/dev/null; then pass "a GNU long name survives a long-link (K) entry: the file is judged by its long name, not its ._x placeholder"
else fail "after a K entry the file must keep its long name: $(tar_macmeta_gate "$T/gnu.tgz" 2>&1)"; fi

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
  if [ "$(/usr/bin/grep -cE '^COPYFILE_DISABLE=1 /usr/bin/tar -czf "\$'"$v"'" --uname kosmos --gname staff -C "\$[A-Z]+" --no-mac-metadata --no-xattrs --no-fflags ' "$s")" = 1 ] \
     && /usr/bin/grep -qx 'tar_macmeta_gate "$'"$v"'" || exit 1' "$s"; then pass "${f%%:*} packs with all four metadata flags and calls the gate"
  else fail "${f%%:*} must pack with COPYFILE_DISABLE=1 /usr/bin/tar --no-mac-metadata --no-xattrs --no-fflags and call tar_macmeta_gate"; fi
done

[ "$fails" -eq 0 ] && { echo "tar macmeta gate: all arms passed"; exit 0; }
echo "tar macmeta gate: $fails failed"; exit 1
