#!/bin/sh
# test-pause-foreign-board-964.sh -- unit test for setup.sh's #964 fix: the update
# pause check must distinguish OUR board (still running, will not pause) from a
# DIFFERENT Kosmos legitimately holding our port (ours already dead). The first
# keeps the #2055 "could not be paused / kosmos stop" die + abort streak; the
# second gets actionable port advice and does NOT inflate the streak.
#
# setup.sh is served as a single curl|sh file and sources nothing, so this extracts
# the exact shipped bytes of the `case "$_pausebody" in ... esac` arm (the technique
# test-update-abort-2055.sh / test-install.sh use) and drives it with `die` stubbed,
# board.pid alive vs dead, so no real board or port is needed.
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SETUP="$HERE/install/setup.sh"
[ -f "$SETUP" ] || { echo "FAIL: cannot find install/setup.sh at $SETUP" >&2; exit 1; }

# Extract the outer `case "$_pausebody" in` ... `  esac` (2-space esac is the outer
# one; the two nested cases inside are single-line `case ... esac`, never `^  esac$`).
BLOCK="$(awk '
  /^  case "\$_pausebody" in$/ { f=1 }
  f { print }
  f && /^  esac$/ { exit }
' "$SETUP")"

case "$BLOCK" in
  *'Another Kosmos is answering on port'*) : ;;
  *) echo "FAIL: could not extract the #964 pause arm (anchor drift?)" >&2; exit 1 ;;
esac
# The extraction must be balanced (both the alive die and the foreign die present),
# or a truncated block would pass some arms vacuously.
case "$BLOCK" in
  *'A Kosmos board is still running on port'*) : ;;
  *) echo "FAIL: extracted block is missing the our-board die (truncated?)" >&2; exit 1 ;;
esac

PASS=0; FAIL=0
TMP="$(mktemp -d "${TMPDIR:-/tmp}/pause964.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# A reaped, definitely-dead pid: spawn a no-op, wait for it, then its pid names
# nothing. Cannot flake on a coincidental live pid the way a hardcoded number can.
( : ) & DEADPID=$!; wait "$DEADPID" 2>/dev/null || true

# Run the extracted arm with die stubbed to print its message and exit 77.
run_arm() { # pausebody kosmoshome port logdir
  (
    set -u
    _pausebody="$1"; KOSMOS_HOME="$2"; PORT="$3"; LOG_DIR="$4"
    die() { printf 'DIE:%s\n' "$*"; exit 77; }
    eval "$BLOCK"
    printf 'NODIE\n'
  )
}

chk() { desc="$1"; shift; if "$@"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "FAIL: $desc" >&2; fi; }
has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }

# ---- OUR board alive, will not pause: the #2055 die + abort streak -----------
L="$TMP/logs-alive"; mkdir -p "$L"; H="$TMP/home-alive"; mkdir -p "$H"
printf '%s' "$$" > "$H/board.pid"   # a live pid (this test process)
OUT_ALIVE="$(run_arm 'this is Kosmos' "$H" 16180 "$L")"
chk "our live board -> 'could not be paused' die" has "$OUT_ALIVE" "A Kosmos board is still running on port 16180 and could not be paused"
chk "our live board -> the #2055 abort streak IS recorded" test -f "$L/update-abort"
if [ -f "$L/update-abort" ]; then
  chk "the recorded reason is board-would-not-pause" grep -q "reason=board-would-not-pause" "$L/update-abort"
fi

# ---- a DIFFERENT Kosmos holds the port, OUR board is dead --------------------
L="$TMP/logs-foreign"; mkdir -p "$L"; H="$TMP/home-foreign"; mkdir -p "$H"
printf '%s' "$DEADPID" > "$H/board.pid"   # our recorded board is dead
OUT_FOREIGN="$(run_arm 'Agent Workforce' "$H" 16180 "$L")"
chk "foreign board (our pid dead) -> the actionable 'Another Kosmos' die" has "$OUT_FOREIGN" "Another Kosmos is answering on port 16180"
chk "foreign board die names the KOSMOS_PORT remedy" has "$OUT_FOREIGN" "KOSMOS_PORT"
# It may MENTION 'kosmos stop' -- but only to DISPEL it (the loop the card names came
# from advising 'kosmos stop', which is a no-op when our own board is already dead).
chk "foreign board die dispels 'kosmos stop' rather than advising it" has "$OUT_FOREIGN" "would do nothing"
chk "foreign board does NOT inflate the board-would-not-pause streak" test '!' -f "$L/update-abort"

# ---- no board.pid at all (a stale install missing the file) -> foreign path --
L="$TMP/logs-nopid"; mkdir -p "$L"; H="$TMP/home-nopid"; mkdir -p "$H"
OUT_NOPID="$(run_arm 'Kosmos' "$H" 16180 "$L")"
chk "no board.pid -> treated as not-ours (actionable 'Another Kosmos' die)" has "$OUT_NOPID" "Another Kosmos is answering on port 16180"

# ---- controls: a non-Kosmos body, and an empty body -------------------------
L="$TMP/logs-other"; mkdir -p "$L"; H="$TMP/home-other"; mkdir -p "$H"; printf '%s' "$$" > "$H/board.pid"
OUT_OTHER="$(run_arm 'some random web server' "$H" 16180 "$L")"
chk "a non-Kosmos body -> the 'Another app' die (arm unchanged)" has "$OUT_OTHER" "Another app on this computer is using port 16180"
OUT_EMPTY="$(run_arm '' "$H" 16180 "$L")"
chk "an empty body (board paused cleanly) -> no die at all" has "$OUT_EMPTY" "NODIE"

echo "test-pause-foreign-board-964: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
