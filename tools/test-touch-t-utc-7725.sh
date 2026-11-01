#!/bin/bash
# kosmos#7725: a test must not hand `touch -t` a computed local time.
#
# `touch -t` reads its stamp as local time and the stamp carries no offset, so in the repeated hour of a fall-back it
# names two instants. Asked for 60 seconds ahead, it landed 3540 seconds behind (measured on this Mac, 2026-11-01), and
# three test files went red on a change that touched none of them. A test passes on every other day of the year, so a
# run cannot stop the next one. Fixed dates are fine: they name no instant near now. This reads touch alone: a test
# that gets local time into an instant any other way passes it.
#
# The form that is safe, both halves in UTC, so the two cannot disagree:
#   TZ=UTC touch -t "$(TZ=UTC date -v-2H +%Y%m%d%H%M)" "$file"
#
# It reads the tree; it runs no product code.
set -u
cd "$(dirname "$0")/.." || exit 2

SELF=tools/test-touch-t-utc-7725.sh

# Prints each line that hands touch a computed -t stamp outside the safe form: any flag spelling (-t, -mt, -m -t), quoted
# or not, from $(...), backticks or a variable. A variable is safe only if every assignment to it in the same file is
# from TZ=UTC date, so one set only in a sourced file reads as unsafe.
scan() {
  perl -0777 -ne '
    my $text = $_; my $n = 0;
    $text =~ s/\\\n[ \t]*/ /g;   # a continued line reads as one; the line number printed is of the joined text
    for my $line (split /\n/, $text) {
      $n++;
      next if $line =~ /^\s*#/;
      my $bad = 0;
      while ($line =~ /(TZ=UTC\s+)?\btouch(?:\s+-[a-zA-Z]+)*?\s+-[a-zA-Z]*t\s*"?(\$\(|`|\$\{?(\w+)\}?)/g) {
        my ($utc, $stamp, $var) = ($1, $2, $3);
        my $rest = substr($line, pos($line));
        $bad = 1 unless defined $utc;
        if (defined $var) {
          my @set = $text =~ /(?:^|[\s;(])\Q$var\E=([^\n]*)/mg;
          my $utc_only = @set > 0;
          for (@set) { $utc_only = 0 unless /^"?\$\((?:[A-Z_]+=\S+\s+)*TZ=UTC\s+date/; }
          $bad = 1 unless $utc_only;
        } else {
          $bad = 1 unless $rest =~ /^(?:[A-Z_]+=\S+\s+)*TZ=UTC\s+date/;
        }
      }
      print "$ARGV:$n: $line\n" if $bad;
    }' "$@"
}

# The control: this must flag every unsafe form and pass the safe ones, or a clean tree below means nothing.
fixture="$(mktemp "${TMPDIR:-/tmp}/kosmos-touch-t.XXXXXX")" || exit 2
trap 'rm -f "$fixture"' EXIT
cat > "$fixture" <<'FIXTURE'
touch -t "$(date -v-2H +%Y%m%d%H%M)" "$a"
touch -t "$stamp" "$a"
TZ=UTC touch -t "$(date -v-2H +%Y%m%d%H%M)" "$a"
: > "$a"; touch -t "$(date -r 5 +%Y%m%d%H%M)" "$a"
TZ=UTC touch -t "$local_stamp" "$a"
touch -m -t "$(TZ=UTC date +%Y%m%d%H%M)" "$a"
touch -mt "$(date +%Y%m%d%H%M)" "$a"
touch -t"$(date +%Y%m%d%H%M)" "$a"
touch -t $(date +%Y%m%d%H%M) "$a"
TZ=UTC touch -t "`date +%Y%m%d%H%M`" "$a"
TZ=UTC touch -t "$mixed_stamp" "$a"
touch -t \
  "$(date +%Y%m%d%H%M)" "$a"
mixed_stamp="$(TZ=UTC date +%Y%m%d%H%M)"
mixed_stamp="$(date +%Y%m%d%H%M)"
local_stamp="$(date +%Y%m%d%H%M)"
utc_stamp="$(TZ=UTC date +%Y%m%d%H%M)"
TZ=UTC touch -t "$(TZ=UTC date -v-2H +%Y%m%d%H%M)" "$a"
TZ=UTC touch -t "$utc_stamp" "$a"
TZ=UTC touch -mt "$(LC_ALL=C TZ=UTC date +%Y%m%d%H%M)" "$a"
TZ=UTC touch -t "`TZ=UTC date +%Y%m%d%H%M`" "$a"
touch -t 202001010000 "$a"
touch -A -0130 "$a"
# touch -t "$(date)" in a comment
FIXTURE
flagged="$(scan "$fixture" | wc -l | tr -d ' ')"
if [ "$flagged" != 12 ]; then
  echo "FAIL: the scan flagged $flagged of the 12 unsafe fixture lines; it cannot be trusted" >&2
  scan "$fixture" >&2
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
echo "ok: ${#files[@]} test files read, no computed local touch -t; the control flagged 12 of 12"
