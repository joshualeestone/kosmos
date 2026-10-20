#!/bin/bash
# The release-tarball metadata gate (#6678, from the #1760 shipped-artifact pass). A release tarball must not carry
# this Mac's own file metadata. The 0.7.60 Mac tarball held two kinds, measured on the served bytes:
#   - an AppleDouble entry (app/._Kosmos.app), the file macOS writes beside a file to hold what tar cannot;
#   - an extended attribute (com.apple.macl on app/Kosmos.app), the build Mac's own privacy record for that folder.
# Neither is a code signature (the app's and the binaries' signatures live inside the files), so neither is needed.
# The bundles pack with COPYFILE_DISABLE=1 and bsdtar's --no-mac-metadata --no-xattrs; this gate refuses a tarball
# that still carries either kind, so a later change to the pack line cannot bring them back quietly.
#
# How it looks: it reads the tar headers itself (perl, from the decompressed stream). macOS tar cannot be asked:
# bsdtar folds an AppleDouble entry into the next entry when it reads, so `tar -t` never lists one (measured on the
# 0.7.60 tarball: its listing shows no ._ entry, its headers hold one), and it refuses --no-mac-metadata in list
# mode. An entry's name is its pax `path` when it has one (else prefix/name); it is refused when its last part starts
# with `._`. A pax record whose key is `SCHILY.xattr.*` or `LIBARCHIVE.xattr.*` (the two forms bsdtar writes) is an
# extended attribute and is refused. No python: /usr/bin/python3 on a build Mac without the Xcode license exits 69.
#
# Usage: source this file, then `tar_metadata_gate <tarball> || exit 1`.
# Prints what it found and returns 1 when the tarball carries either kind, or when it cannot read all of it.

tar_metadata_gate() {
  local tarball="$1" out rc
  [ -f "$tarball" ] || { echo "FAIL: the tarball metadata gate has no tarball at $tarball" >&2; return 1; }
  /usr/bin/gzip -t "$tarball" 2>/dev/null || { echo "FAIL: the tarball metadata gate could not read all of $tarball" >&2; return 1; }
  out="$(/usr/bin/gzip -dc "$tarball" 2>/dev/null | /usr/bin/perl -e '
    use strict; binmode STDIN;
    my ($n, $dbl, $xat, @first, $path, $end) = (0, 0, 0);
    while (1) {
      my $got = read(STDIN, my $h, 512);
      last if !$got;
      if ($got != 512) { print "SHORT\n"; exit 3 }
      if ($h eq ("\0" x 512)) { $end = 1; last }
      my $size = oct("0" . ((substr($h, 124, 12) =~ /([0-7]+)/)[0] // "0"));
      my $type = substr($h, 156, 1);
      my $body = "";
      my $pad = ($size + 511) & ~511;
      if ($pad) { my $g = read(STDIN, $body, $pad); if (!defined $g || $g != $pad) { print "SHORT\n"; exit 3 } }
      $body = substr($body, 0, $size);
      if ($type eq "x" || $type eq "g") {
        while ($body =~ /\G(\d+) /gc) {
          my $len = $1; my $start = pos($body) - length($len) - 1;
          my $rec = substr($body, $start, $len); pos($body) = $start + $len;
          my ($k, $v) = $rec =~ /^\d+ ([^=]*)=(.*)\n\z/s or next;
          $xat++ if $k =~ /^(SCHILY|LIBARCHIVE)\.xattr\./;
          $path = $v if $k eq "path" && $type eq "x";
        }
        next;
      }
      next if $type eq "L" || $type eq "K";
      my ($name) = substr($h, 0, 100) =~ /^([^\0]*)/;
      my ($pre) = substr($h, 345, 155) =~ /^([^\0]*)/;
      my $full = defined $path ? $path : (length($pre) ? "$pre/$name" : $name);
      undef $path; $n++;
      (my $t = $full) =~ s{/+\z}{};
      my ($base) = $t =~ m{([^/]*)\z};
      if (substr($base, 0, 2) eq "._") { $dbl++; push @first, $full if @first < 3 }
    }
    if (!$end) { print "SHORT\n"; exit 3 }
    print "N $n\nDBL $dbl\nXAT $xat\n"; print "FIRST $_\n" for @first;
  ')"; rc=$?
  [ "$rc" = 0 ] || { echo "FAIL: the tarball metadata gate could not read all of $tarball" >&2; return 1; }
  local n dbl xat
  n="$(printf '%s\n' "$out" | /usr/bin/sed -n 's/^N //p')"; dbl="$(printf '%s\n' "$out" | /usr/bin/sed -n 's/^DBL //p')"; xat="$(printf '%s\n' "$out" | /usr/bin/sed -n 's/^XAT //p')"
  [ "${n:-0}" -gt 0 ] || { echo "FAIL: the tarball metadata gate found no entries in $tarball" >&2; return 1; }
  [ "${dbl:-1}" = 0 ] && [ "${xat:-1}" = 0 ] && return 0
  [ "${dbl:-0}" = 0 ] || {
    echo "FAIL: $dbl AppleDouble entries in $(basename "$tarball") (#6678), first ones:" >&2
    printf '%s\n' "$out" | /usr/bin/sed -n 's/^FIRST /  /p' >&2
  }
  [ "${xat:-0}" = 0 ] || echo "FAIL: $(basename "$tarball") carries $xat extended-attribute records (#6678): pack with --no-xattrs" >&2
  return 1
}
