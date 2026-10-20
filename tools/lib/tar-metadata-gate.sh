#!/bin/bash
# The release-tarball metadata gate (#6678, from the #1760 shipped-artifact pass). A release tarball must not carry
# this Mac's own file metadata. The 0.7.60 Mac tarball held two kinds, measured on the served bytes:
#   - an AppleDouble entry (app/._Kosmos.app), the file macOS writes beside a file to hold what tar cannot;
#   - an extended attribute (com.apple.macl on app/Kosmos.app), the build Mac's own privacy record for that folder.
# Neither is a code signature (the app's and the binaries' signatures live inside the files), so neither is needed.
# The bundles pack with COPYFILE_DISABLE=1 and bsdtar's --no-mac-metadata --no-xattrs --no-fflags; this gate refuses a
# tarball that still carries this Mac's file metadata, so a later change to the pack line cannot bring it back quietly.
#
# How it looks: it reads the tar headers itself (perl, from the decompressed stream). macOS tar cannot be asked:
# bsdtar folds an AppleDouble entry into the next entry when it reads, so `tar -t` never lists one (measured on the
# 0.7.60 tarball: its listing shows no ._ entry, its headers hold one), and it refuses --no-mac-metadata in list
# mode. An entry is refused when ANY name it could be extracted under (its pax path, its GNU long name, its header
# name) has a last part starting with `._`. A pax record for an extended attribute (`SCHILY.xattr.*` or
# `LIBARCHIVE.xattr.*`, the two forms bsdtar writes), a file flag (`SCHILY.fflags`) or an ACL is refused, as is a pax
# `size` (it would move where the next entry ends) and anything after the end of the archive that is not zero padding. No python: /usr/bin/python3 on a build Mac without the Xcode license exits 69.
#
# Usage: source this file, then `tar_metadata_gate <tarball> || exit 1`.
# Prints what it found and returns 1 when the tarball carries this Mac's file metadata, or when it cannot look.

# The gate: the header layer, then (when it passes) what bsdtar extracts. Review 8: the header layer is its own
# function so its guards are tested apart from the extraction layer, which otherwise refuses their fixtures first.
tar_metadata_gate() { tar_metadata_headers "$1" || return 1; tar_metadata_extracted "$1"; }

tar_metadata_headers() {
  local tarball="$1" out rc
  [ -f "$tarball" ] || { echo "FAIL: the tarball metadata gate has no tarball at $tarball" >&2; return 1; }
  /usr/bin/gzip -t "$tarball" 2>/dev/null || { echo "FAIL: the tarball metadata gate could not read all of $tarball" >&2; return 1; }
  out="$(/usr/bin/gzip -dc "$tarball" 2>/dev/null | /usr/bin/perl -e '
    use strict; binmode STDIN;
    my ($n, $dbl, $xat, @first, $path, $lname, $end) = (0, 0, 0);
    while (1) {
      my $got = read(STDIN, my $h, 512);
      last if !$got;
      if ($got != 512) { print "SHORT\n"; exit 3 }
      if ($h eq ("\0" x 512)) { $end = 1; last }
      # Every header is checked against its own checksum (bytes 148 to 155, summed with that field as spaces), so a
      # damaged or hand-forged header is refused, never read as something else. A base-256 size (top bit set, a
      # file of 8 GiB or more) is refused too: nothing these bundles ship is that big.
      my $sum = unpack("%32C*", substr($h, 0, 148) . (" " x 8) . substr($h, 156));
      my ($want) = substr($h, 148, 8) =~ /([0-7]+)/;
      if (!defined $want || oct($want) != $sum) { print "SHORT\n"; exit 3 }
      if (ord(substr($h, 124, 1)) & 0x80) { print "SHORT\n"; exit 3 }
      my $size = oct("0" . ((substr($h, 124, 12) =~ /^\s*([0-7]+)/)[0] // "0"));
      my $type = substr($h, 156, 1);
      # Review 4: bsdtar reads no body for a link, device, folder or FIFO (types 1 to 6) whatever its size says, so a
      # size there would make this reader skip what bsdtar reads as the next entry; it is refused. So is any type
      # outside the ones bsdtar reads as a file, one of those, or a pax or GNU name record.
      if ($type =~ /^[1-6]\z/ && $size != 0) { print "SHORT\n"; exit 3 }
      if ($type !~ /^[0-7xgLK\0]\z/) { print "SHORT\n"; exit 3 }
      my $body = "";
      my $pad = ($size + 511) & ~511;
      my $keep = ($type eq "x" || $type eq "g" || $type eq "L" || $type eq "K");
      while ($pad > 0) {   # a file body is read in chunks and dropped; only a record body is kept
        my $want = $pad > 65536 ? 65536 : $pad;
        my $g = read(STDIN, my $chunk, $want);
        if (!defined $g || $g != $want) { print "SHORT\n"; exit 3 }
        $body .= $chunk if $keep; $pad -= $want;
      }
      $body = substr($body, 0, $size) if $keep;
      if ($type eq "x" || $type eq "g") {
        # Review 2: every record must be whole and the body read to its end. A record of length 0 looped for ever
        # (pos went back to its own start), and one that did not parse ended the loop quietly, hiding every record
        # after it, an extended attribute included. Either is refused now, as anything not read in full is.
        my $at = 0;
        while ($at < length($body)) {
          my ($len) = substr($body, $at) =~ /^(\d+) /;
          if (!defined $len || $len < length($len) + 3 || $at + $len > length($body)) { print "SHORT\n"; exit 3 }
          my $rec = substr($body, $at, $len); $at += $len;
          my ($k, $v) = $rec =~ /^\d+ ([^=]*)=(.*)\n\z/s;
          if (!defined $k) { print "SHORT\n"; exit 3 }
          $xat++ if $k =~ /^(SCHILY|LIBARCHIVE)\.xattr\./;
          # Review 3: file flags (chflags) and ACLs are this Mac metadata too, counted with the attributes.
          $xat++ if $k eq "SCHILY.fflags" || $k =~ /^(SCHILY\.acl\.|LIBARCHIVE\.acl)/;
          # Review 3: a pax size moves where the next entry ends, and bsdtar follows it while this reader skips by
          # the header size, so the two would read different entries (an attribute hid that way). The bundles never
          # need one (under 8 GiB, bsdtar writes none), so it is refused rather than followed.
          if ($k eq "size") { print "SHORT\n"; exit 3 }
          $path = $v if $k eq "path" && $type eq "x";
        }
        next;
      }
      # A GNU long name (L) is the name of the next entry, as a pax path is (review 1: skipping it let app/<long>/._K
      # through, since the header of that entry holds only the first 100 bytes). A long link target (K) is not a name.
      if ($type eq "L") { ($lname = $body) =~ s/\0+\z//; next }
      next if $type eq "K";
      my ($name) = substr($h, 0, 100) =~ /^([^\0]*)/;
      my ($pre) = substr($h, 345, 155) =~ /^([^\0]*)/;
      # Every name this entry could be extracted under is checked: its pax path, its GNU long name, and its header
      # name (review 2: a pax path then a long name used to lose the pax name).
      my @names = grep { defined } ($path, $lname, (length($pre) ? "$pre/$name" : $name));
      my $full = $names[0];
      undef $path; undef $lname; $n++;
      my $hit = 0;
      for my $c (@names) { (my $t = $c) =~ s{/+\z}{}; my ($base) = $t =~ m{([^/]*)\z}; $hit = 1 if substr($base, 0, 2) eq "._" }
      if ($hit) { $dbl++; push @first, $full if @first < 3 }
    }
    if (!$end) { print "SHORT\n"; exit 3 }
    # Review 3: read to the end of the stream, so the verdict never depends on whether the caller sets pipefail (gzip
    # took SIGPIPE when this stopped early), and refuse anything after the end that is not zero padding.
    while (read(STDIN, my $rest, 65536)) { if ($rest =~ /[^\0]/) { print "SHORT\n"; exit 3 } }
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
  [ "${xat:-0}" = 0 ] || echo "FAIL: $(basename "$tarball") carries $xat metadata records (extended attributes, file flags or ACLs; #6678): pack with --no-xattrs --no-fflags" >&2
  return 1
}

# Review 5: the header reader is a second implementation of libarchive's parser, and every round found another forged
# shape it read differently (a NUL inside a long name or a pax path, GNU.sparse.name, a sized entry named like a
# folder). So the source of truth is what bsdtar itself EXTRACTS: unpack the tarball the way install/setup.sh does
# (/usr/bin/tar -xzf ... --no-same-owner, macOS default: an AppleDouble entry is folded into the file it describes)
# into a temporary folder, and refuse when anything that comes out carries an extended attribute or a file flag, or
# is a ._ file. A ._ entry that changes nothing on extraction is inert bytes; one that changes something is caught
# here whatever shape hid it. Attributes are read with xattr -s, so a symlink in the tarball is never followed.
# _tmg_rm DIR: remove an unpacked copy whatever its modes and ACLs (review 7: a deny-delete ACL also stopped rm).
_tmg_rm() { /bin/chmod -RN "$1" 2>/dev/null; /bin/chmod -R u+rwX "$1" 2>/dev/null; /bin/rm -rf "$1"; }
tar_metadata_extracted() {
  local tarball="$1" d bad scan=0 oldtrap
  d="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/tar-metadata-gate.XXXXXXXXXX")" || { echo "FAIL: the tarball metadata gate could not make a folder to unpack into" >&2; return 1; }
  # Review 6: removed whatever the tarball's modes, and on an interrupt too; a folder that will not go is a refusal.
  # Review 7: the interrupt is passed on after the cleanup (never swallowed), and the caller's own traps come back.
  # Review 9: a hangup too (a cut in tmux can get one when its session closes), and QUIT.
  oldtrap="$(trap -p INT TERM HUP QUIT)"
  local sig; for sig in INT TERM HUP QUIT; do trap '_tmg_rm "$d"; trap - '"$sig"'; kill -s '"$sig"' $$' "$sig"; done
  _tmg_done() { _tmg_rm "$d"; trap - INT TERM HUP QUIT; [ -z "$oldtrap" ] || eval "$oldtrap"; }
  # The attribute reader must be seen to work (a probe file with one attribute) before an empty answer means clean.
  if ! { printf 'p\n' > "$d/.kosmos-probe" && /usr/bin/xattr -w com.kosmos.probe 1 "$d/.kosmos-probe" 2>/dev/null \
         && [ "$(/usr/bin/xattr -s "$d/.kosmos-probe" 2>/dev/null)" = com.kosmos.probe ]; }; then
    _tmg_done; echo "FAIL: the tarball metadata gate could not read an extended attribute on this Mac, so it cannot vouch for one" >&2; return 1
  fi
  /bin/rm -f "$d/.kosmos-probe"
  if ! /usr/bin/tar -xzf "$tarball" --no-same-owner -C "$d" 2>/dev/null; then
    _tmg_done; echo "FAIL: the tarball metadata gate could not unpack $(basename "$tarball") the way an install does" >&2; return 1
  fi
  /bin/chmod -R u+rX "$d" 2>/dev/null   # so every folder can be scanned (modes on disk are not what is judged)
  local a b c e
  a="$(/usr/bin/find "$d" -name '._*' -print)" || scan=1
  b="$(/usr/bin/find "$d" -exec /usr/bin/xattr -s {} +)" || scan=1
  c="$(/usr/bin/find "$d" -exec /usr/bin/stat -f '%f %N' {} +)" || scan=1
  # Review 7: an AppleDouble entry folded on extraction can restore an ACL as well as attributes (measured), so ACLs
  # on what comes out are this Mac metadata too. ls -lde prints a file, then one indented "N: ..." line per entry.
  e="$(/usr/bin/find "$d" -exec /bin/ls -lde {} +)" || scan=1
  bad="$( { [ -z "$a" ] || printf '%s\n' "$a" | /usr/bin/sed 's/$/: an AppleDouble file/'
            [ -z "$b" ] || printf '%s\n' "$b"
            printf '%s\n' "$c" | /usr/bin/awk 'NF && $1 != 0 { $1 = ""; print substr($0, 2) ": a file flag" }'
            printf '%s\n' "$e" | /usr/bin/awk '/^ [0-9]+: / { if (f != "") print f ": an ACL"; f = ""; next } NF >= 9 { f = $NF }' | /usr/bin/sort -u; } \
          | /usr/bin/sed "s#^$d/##" )"
  _tmg_done
  [ -e "$d" ] && { echo "FAIL: the tarball metadata gate could not remove the folder it unpacked into ($d)" >&2; return 1; }
  [ "$scan" = 0 ] || { echo "FAIL: the tarball metadata gate could not scan all of what $(basename "$tarball") unpacks to" >&2; return 1; }
  [ -z "$bad" ] && return 0
  echo "FAIL: unpacked as an install does, $(basename "$tarball") puts this Mac metadata on $(printf '%s\n' "$bad" | /usr/bin/wc -l | /usr/bin/tr -d ' ') things (#6678), first ones:" >&2
  printf '%s\n' "$bad" | /usr/bin/sed -n '1,3p' | /usr/bin/sed 's/^/  /' >&2
  return 1
}
