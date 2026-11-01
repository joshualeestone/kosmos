#!/bin/bash
# kosmos#7725: a test must not hand `touch -t` a computed local time.
#
# `touch -t` reads its stamp as local time and the stamp carries no offset, so in the repeated hour of a fall-back it
# names two instants. A test that does this passes on every other day of the year, so an ordinary run cannot catch it.
#
# The rule, on any line where touch takes -t: the stamp is a fixed date, or touch and every date in it run in UTC.
#   TZ=UTC touch -t "$(TZ=UTC date -v-2H +%Y%m%d%H%M)" "$file"
# A stamp in a variable counts only if every assignment to it in the same file obeys the same rule.
#
# It reads the tree; it runs no product code. It reads touch and nothing else.
set -u
cd "$(dirname "$0")/.." || exit 2

SELF=tools/test-touch-t-utc-7725.sh

scan() {
  perl -0777 -ne '
    sub utc_dates {   # every date command in this text carries TZ=UTC, and there is at least one
      my ($t) = @_; my $seen = 0;
      while ($t =~ /(?<![\w\$.\/-])(?:[\w.\/-]*\/)?g?date\b(?!\s+\+%s\b)/g) {   # date +%s is an epoch, which has no zone
        $seen = 1;
        return 0 unless substr($t, 0, $-[0]) =~ /TZ=UTC\s+(?:[A-Z_]+=\S+\s+)*$/;
      }
      return $seen;
    }
    my $text = $_;
    $text =~ s/\\\n[ \t]*/ /g;
    for my $line (split /\n/, $text) {
      next if $line =~ /^\s*#/;
      my $bad = 0;
      while ($line =~ /(TZ=UTC\s+(?:[A-Z_]+=\S+\s+)*)?\btouch\b[^;|&]*?\s-[a-zA-Z]*t(?=[\s"\$`\d])/g) {
        my $utc = defined $1;
        my $stamp = substr($line, $+[0]);
        next if $stamp =~ /^\s*"?\d{8,}(?:\.\d+)?"?(?:\s|$)/;
        next if $stamp =~ /^\s*"\d{10,}\$(?:[a-z]"|\(printf\b)/;   # a fixed date with a loop counter on the end
        my $good = $utc;
        if ($stamp =~ /^\s*"?\$\{?(\w+)\}?"?(?:\s|$)/) {
          my $var = $1;
          my @set = $text =~ /(?:^|[\s;(])\Q$var\E=([^\n]*)/mg;
          $good = 0 unless @set;
          for (@set) { $good = 0 unless utc_dates($_); }
        } else {
          $good = 0 unless utc_dates($stamp);
        }
        $bad = 1 unless $good;
      }
      print "$ARGV: $line\n" if $bad;
    }' "$@"
}

# The control: the scan must flag exactly the lines marked UNSAFE, or a clean tree below means nothing.
fixture="$(mktemp "${TMPDIR:-/tmp}/kosmos-touch-t.XXXXXX")" || exit 2
trap 'rm -f "$fixture"' EXIT
cat > "$fixture" <<'FIXTURE'
touch -t "$(date -v-2H +%Y%m%d%H%M)" "$a"                                  # UNSAFE
touch -t "$unset_stamp" "$a"                                               # UNSAFE
TZ=UTC touch -t "$(date -v-2H +%Y%m%d%H%M)" "$a"                           # UNSAFE
: > "$a"; touch -t "$(date -r 5 +%Y%m%d%H%M)" "$a"                         # UNSAFE
TZ=UTC touch -t "$local_stamp" "$a"                                        # UNSAFE
TZ=UTC touch -t "$mixed_stamp" "$a"                                        # UNSAFE
touch -m -t "$(TZ=UTC date +%Y%m%d%H%M)" "$a"                              # UNSAFE
touch -mt "$(date +%Y%m%d%H%M)" "$a"                                       # UNSAFE
touch -t"$(date +%Y%m%d%H%M)" "$a"                                         # UNSAFE
touch -t $(date +%Y%m%d%H%M) "$a"                                          # UNSAFE
TZ=UTC touch -t "`date +%Y%m%d%H%M`" "$a"                                  # UNSAFE
touch -r "$b" -t "$(date +%Y%m%d%H%M)" "$a"                                # UNSAFE
touch "$a" -t "$(date +%Y%m%d%H%M)"                                        # UNSAFE
touch -t 20"$(date +%y%m%d%H%M)" "$a"                                      # UNSAFE
TZ=UTC touch -t "$(TZ=UTC date -r 5 +%Y%m%d%H%M || date -d @5 +%Y%m%d%H%M)" "$a"   # UNSAFE
TZ=UTC touch -t "$fallback_stamp" "$a"                                     # UNSAFE
touch -t \
  "$(date +%Y%m%d%H%M)" "$a"                                               # UNSAFE
touch -t 202001010000 "$a"; touch -t "$(date +%Y%m%d%H%M)" "$b"            # UNSAFE
TZ=UTC touch -t "$(TZ=UTC date -r 5 +%Y%m%d%H%M || gdate -d @5 +%Y%m%d%H%M)" "$a"       # UNSAFE
TZ=UTC touch -t "$(TZ=UTC date -r 5 +%Y%m%d%H%M || /bin/date -d @5 +%Y%m%d%H%M)" "$a"   # UNSAFE
touch -t "20261101$h" "$a"                                                 # UNSAFE
local_stamp="$(date +%Y%m%d%H%M)"
mixed_stamp="$(TZ=UTC date +%Y%m%d%H%M)"
mixed_stamp="$(date +%Y%m%d%H%M)"
fallback_stamp="$(TZ=UTC date -r 5 +%Y%m%d%H%M || date -d @5 +%Y%m%d%H%M)"
utc_stamp="$(TZ=UTC date +%Y%m%d%H%M)"
TZ=UTC touch -t "$(TZ=UTC date -v-2H +%Y%m%d%H%M)" "$a"
TZ=UTC touch -t "$(TZ=UTC date -r 5 +%Y%m%d%H%M || TZ=UTC date -d @5 +%Y%m%d%H%M)" "$a"
TZ=UTC touch -t "$utc_stamp" "$a"
TZ=UTC touch -mt "$(TZ=UTC LC_ALL=C date +%Y%m%d%H%M)" "$a"
TZ=UTC touch -t "`TZ=UTC date +%Y%m%d%H%M`" "$a"
touch -t 202001010000 "$a"
touch -t 202001010000.30 "$a"
touch -t "20260101010$i" "$a"
touch -t "2001010101$(printf %02d $i)" "$a"
TZ=UTC touch -t "$(TZ=UTC date -r $(( $(date +%s) - 60 )) +%Y%m%d%H%M)" "$a"
touch -A -0130 "$a"
touch "$a"
# touch -t "$(date)" in a comment
FIXTURE
flagged="$(scan "$fixture")"
want="$(grep -c 'UNSAFE' "$fixture")"
got="$(printf '%s\n' "$flagged" | grep -c 'UNSAFE')"
wrong="$(printf '%s\n' "$flagged" | grep -v 'UNSAFE' | grep -c .)"
if [ "$got" != "$want" ] || [ "$wrong" != 0 ]; then
  echo "FAIL: the scan flagged $got of $want unsafe fixture lines and $wrong safe ones; it cannot be trusted" >&2
  printf '%s\n' "$flagged" >&2
  exit 1
fi

files=()
while IFS= read -r f; do
  [ "$f" = "$SELF" ] || files+=("$f")
done < <(git ls-files -- 'tools/test-*.sh' 'tools/*.test.sh')
if [ "${#files[@]}" -lt 100 ]; then
  echo "FAIL: only ${#files[@]} test files read; the list is wrong, so a clean answer means nothing" >&2
  exit 1
fi

found="$(scan "${files[@]}")"
if [ -n "$found" ]; then
  echo "FAIL: touch -t with a computed local time (kosmos#7725). Use: TZ=UTC touch -t \"\$(TZ=UTC date ...)\" file" >&2
  printf '%s\n' "$found" >&2
  exit 1
fi
echo "ok: ${#files[@]} test files read, no computed local touch -t; the control flagged $got of $want"
