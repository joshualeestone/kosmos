#!/bin/bash
# The release-tarball macOS metadata gate (#6678, from the #1760 shipped-artifact pass on the 0.7.60 bundles). A release
# tarball must not carry the build Mac's file metadata: AppleDouble `._name` entries, extended attributes in pax headers
# (SCHILY.xattr.* / LIBARCHIVE.xattr.*), or file flags (SCHILY.fflags, which bsdtar restores on extract: a `uchg` or
# `hidden` on a staged file would reach every install). The bundles pack with COPYFILE_DISABLE=1, --no-mac-metadata,
# --no-xattrs and --no-fflags; each leaves another kind in when used alone.
#
# 🛑 It reads the raw entries, NOT `tar -t`: macOS bsdtar folds a `._name` entry back into its file when it lists, so a
# `tar -tzf` of a tarball holding one shows nothing, and -t refuses --no-mac-metadata (measured 2026-10-20). The reader
# is /usr/bin/perl, which every Mac has: python3 is a developer-tools stub that opens an install dialog where those
# tools are absent, and build-tmux-bundle.sh dropped it for that reason.
#
# Usage: source this file, then `tar_macmeta_gate <tarball> || exit 1`.
# Prints the first offending entries and returns 1 when any is found, or when it cannot read every entry.

tar_macmeta_gate() {
  local tarball="$1" out rc
  [ -f "$tarball" ] || { echo "FAIL: the tarball metadata gate has no tarball at $tarball" >&2; return 1; }
  out="$(/usr/bin/perl -e '
    use strict; use warnings;
    open(my $fh, "-|", "/usr/bin/gzip", "-dc", "--", $ARGV[0]) or do { print "UNREADABLE cannot run gzip\n"; exit 2 };
    binmode $fh;
    my @bad; my $n = 0; my $next; my $ended = 0;
    while (1) {
      my $got = read($fh, my $h, 512);
      last if !$got;
      if ($got != 512) { print "UNREADABLE a header cut short\n"; exit 2 }
      if ($h eq "\0" x 512) { $ended = 1; last }
      my $sum = 0; $sum += $_ for unpack("C*", substr($h, 0, 148) . (" " x 8) . substr($h, 156));
      my $want = oct(unpack("Z8", substr($h, 148, 8)) =~ s/\s//gr || "x");
      if ($sum != $want) { print "UNREADABLE a header with a bad checksum\n"; exit 2 }
      my $name = unpack("Z100", $h); my $prefix = unpack("Z155", substr($h, 345, 155));
      $name = "$prefix/$name" if length $prefix;
      my $size = oct(unpack("Z12", substr($h, 124, 12)) =~ s/\s//gr || "0");
      my $type = substr($h, 156, 1);
      my $pad = int(($size + 511) / 512) * 512; my $data = "";
      if ($pad) { my $r = read($fh, $data, $pad); if (!defined $r || $r != $pad) { print "UNREADABLE an entry cut short\n"; exit 2 } }
      $data = substr($data, 0, $size);
      if ($type eq "x" || $type eq "g") {
        while ($data =~ /\G(\d+) ([^=]*)=/gc) {
          my ($len, $key) = ($1, $2); my $start = $-[0];
          push @bad, "extended attribute $key" if $key =~ /\.xattr\./;
          push @bad, "file flags $key" if $key =~ /fflags/;
          if ($key eq "path") { my $v = substr($data, $+[0], $len - ($+[0] - $start) - 1); $next = $v }
          pos($data) = $start + $len;
        }
        next;
      }
      if ($type eq "L") { ($next = $data) =~ s/\0.*//s; next }
      $name = $next if defined $next; $next = undef; $n++;
      (my $base = $name) =~ s{/+$}{}; $base =~ s{.*/}{};
      push @bad, "AppleDouble entry $name" if $base =~ /^\._/;
    }
    close($fh); if ($? != 0) { print "UNREADABLE gzip exit " . ($? >> 8) . "\n"; exit 2 }
    if (!$ended) { print "UNREADABLE no end-of-archive marker\n"; exit 2 }
    if (!$n) { print "EMPTY\n"; exit 2 }
    print "$_\n" for @bad[0 .. ($#bad < 2 ? $#bad : 2)];
    exit(@bad ? 1 : 0);
  ' "$tarball" 2>&1)"; rc=$?
  case "$rc" in
    0) return 0 ;;
    1) echo "FAIL: $(basename "$tarball") carries macOS metadata from the build Mac (#6678), first ones:" >&2
       printf '%s\n' "$out" | /usr/bin/sed 's/^/  /' >&2; return 1 ;;
    *) echo "FAIL: the tarball metadata gate could not read every entry of $tarball (${out:-perl exit $rc})" >&2; return 1 ;;
  esac
}
