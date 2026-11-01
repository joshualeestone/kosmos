#!/bin/bash
# kosmos#7725: a test must not hand `touch -t` a computed local time.
#
# `touch -t` reads its stamp as local time and the stamp carries no offset, so in the repeated hour of a fall-back it
# names two instants. Asked for 60 seconds ahead, it landed 3540 seconds behind (measured on this Mac, 2026-11-01), and
# three test files went red on a change that touched none of them. A test passes on every other day of the year, so
# nothing but this file can stop the next one. Fixed dates are fine: they name no instant near now.
#
# The form that is safe, both halves in UTC, so the two cannot disagree:
#   TZ=UTC touch -t "$(TZ=UTC date -v-2H +%Y%m%d%H%M)" "$file"
#
# It reads the tree; it runs no product code.
set -u
cd "$(dirname "$0")/.." || exit 2

SELF=tools/test-touch-t-utc-7725.sh

# Prints each line that hands touch -t a computed stamp outside the safe form.
scan() {
  perl -ne '
    my $bad = 0;
    unless (/^\s*#/) {
      while (/(TZ=UTC )?touch -t "\$(\()?(TZ=UTC date)?/g) {
        $bad = 1 unless defined $1;              # touch itself reads local time
        $bad = 1 if defined $2 && !defined $3;   # the date builds a local stamp
      }
    }
    print "$ARGV:$.: $_" if $bad;
    close ARGV if eof;' "$@"
}

# The control: this must flag every unsafe form and pass the safe ones, or a clean tree below means nothing.
fixture="$(mktemp "${TMPDIR:-/tmp}/kosmos-touch-t.XXXXXX")" || exit 2
trap 'rm -f "$fixture"' EXIT
cat > "$fixture" <<'FIXTURE'
touch -t "$(date -v-2H +%Y%m%d%H%M)" "$a"
touch -t "$stamp" "$a"
TZ=UTC touch -t "$(date -v-2H +%Y%m%d%H%M)" "$a"
: > "$a"; touch -t "$(date -r 5 +%Y%m%d%H%M)" "$a"
TZ=UTC touch -t "$(TZ=UTC date -v-2H +%Y%m%d%H%M)" "$a"
TZ=UTC touch -t "$stamp" "$a"
touch -t 202001010000 "$a"
# touch -t "$(date)" in a comment
FIXTURE
flagged="$(scan "$fixture" | wc -l | tr -d ' ')"
if [ "$flagged" != 4 ]; then
  echo "FAIL: the scan flagged $flagged of the 4 unsafe fixture lines; it cannot be trusted" >&2
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
echo "ok: ${#files[@]} test files read, no computed local touch -t; the control flagged 4 of 4"
