#!/bin/bash
# The release-tarball macOS metadata gate (#6678, from the #1760 shipped-artifact pass on the 0.7.60 bundles). A release
# tarball must not carry the build Mac's file metadata: AppleDouble `._name` entries, extended attributes in pax headers
# (SCHILY.xattr.* / LIBARCHIVE.xattr.*), access control lists, or file flags (SCHILY.fflags, which bsdtar restores on extract: a `uchg` or
# `hidden` on a staged file would reach every install). The bundles pack with COPYFILE_DISABLE=1, --no-mac-metadata,
# --no-xattrs and --no-fflags; each leaves another kind in when used alone. ACLs rely on bsdtar's macOS default of not
# archiving them (no --acls); the gate refuses their keys in case that changes.
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
      my $size = oct(unpack("Z12", substr($h, 124, 12)) =~ s/\s//gr || "0");   # base-256 (over 8 GiB) misparses and the next checksum refuses: closed
      my $type = substr($h, 156, 1);
      my $pad = int(($size + 511) / 512) * 512; my $data = "";
      my $keep = ($type eq "x" || $type eq "g" || $type eq "L" || $type eq "K");   # other payloads are skipped, not held
      while ($pad > 0) {
        my $want = $keep ? $pad : ($pad > 65536 ? 65536 : $pad);
        my $r = read($fh, my $chunk, $want);
        if (!defined $r || $r <= 0) { print "UNREADABLE an entry cut short\n"; exit 2 }
        $data .= $chunk if $keep; $pad -= $r;
      }
      $data = substr($data, 0, $size);
      if ($type eq "x" || $type eq "g") {
        my $at = 0;
        while ($at < length $data) {   # every record must parse, or the header is refused (it cannot be read whole)
          substr($data, $at) =~ /\A(\d+) ([^=\n]*)=/ or do { print "UNREADABLE a malformed pax record\n"; exit 2 };
          my ($len, $key) = ($1, $2);
          if ($len < length("$len k=\n") || $at + $len > length $data || substr($data, $at + $len - 1, 1) ne "\n") { print "UNREADABLE a malformed pax record\n"; exit 2 }
          push @bad, "extended attribute $key" if $key =~ /\.xattr\./;
          push @bad, "file flags $key" if $key =~ /fflags/;
          push @bad, "access control list $key" if $key =~ /\.acl/;
          # only a per-file x header names the next entry; a global g header does not
          if ($key eq "path" && $type eq "x") { my $vs = length($len) + 1 + length($key) + 1; $next = substr($data, $at + $vs, $len - $vs - 1) }
          $at += $len;
        }
        next;
      }
      if ($type eq "L") { ($next = $data) =~ s/\0.*//s; next }
      next if $type eq "K";   # a GNU long LINK target: not a name, and it must not consume the pending long name
      $name = $next if defined $next; $next = undef; $n++;
      (my $base = $name) =~ s{/+$}{}; $base =~ s{.*/}{};
      push @bad, "AppleDouble entry $name" if $base =~ /^\._/;
    }
    1 while read($fh, my $rest, 65536);   # drain past the end marker (record padding), so gzip is not killed by SIGPIPE
    close($fh); if ($? != 0) { print "UNREADABLE gzip exit " . ($? >> 8) . "\n"; exit 2 }
    if (!$ended) { print "UNREADABLE no end-of-archive marker\n"; exit 2 }
    if (!$n) { print "EMPTY\n"; exit 2 }
    print "$_\n" for @bad[0 .. ($#bad < 2 ? $#bad : 2)];
    exit(@bad ? 1 : 0);
  ' "$tarball" 2>&1)"; rc=$?
  case "$rc" in
    0) return 0 ;;
    1) echo "FAIL: ${tarball##*/} carries macOS metadata from the build Mac (#6678), first ones:" >&2
       printf '%s\n' "$out" | /usr/bin/sed 's/^/  /' >&2; return 1 ;;
    *) echo "FAIL: the tarball metadata gate could not read every entry of $tarball (${out:-perl exit $rc})" >&2; return 1 ;;
  esac
}
