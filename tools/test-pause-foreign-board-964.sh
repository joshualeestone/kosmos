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

# Run the extracted arm with die stubbed to print its message and exit 77. `set -eu`
# so an errexit-unsafe regression in the alive branch is caught (the shipped script
# runs under set -e; the ps-in-case pattern is proven safe there).
run_arm() { # pausebody kosmoshome port logdir
  (
    set -eu
    _pausebody="$1"; KOSMOS_HOME="$2"; PORT="$3"; LOG_DIR="$4"
    die() { printf 'DIE:%s\n' "$*"; exit 77; }
    eval "$BLOCK"
    printf 'NODIE\n'
  )
}

chk() { desc="$1"; shift; if "$@"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "FAIL: $desc" >&2; fi; }
has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }

# Materialize a sleeper AT $h/app/server.js so `ps -o command=` shows that path (=>
# reads as THAT home's own board under the strict ps-command match). Spawned INLINE
# in the main shell (never via $() -- a background child started in a command-
# substitution subshell is killed when that subshell exits, so ps would find nothing
# and the arm would silently take the foreign branch). stdio is redirected so nothing
# holds a pipe open. Sets OURPID_OUT to the pid.
make_server_js() { # kosmoshome
  h="$1"; mkdir -p "$h/app"
  printf '#!/bin/sh\nsleep 30\n' > "$h/app/server.js"; chmod +x "$h/app/server.js"
}
KILL_PIDS=""
# kill THEN wait, so the shell reaps the job synchronously and does not print an
# async "Terminated: 15" job-control line to stderr on a passing run.
reap() { for p in $KILL_PIDS; do kill "$p" 2>/dev/null || true; wait "$p" 2>/dev/null || true; done; }
trap 'reap; rm -rf "$TMP"' EXIT

# ---- OUR board running (pid IS this install's server), will not pause --------
L="$TMP/logs-alive"; mkdir -p "$L"; H="$TMP/home-alive"; mkdir -p "$H"
make_server_js "$H"
/bin/sh "$H/app/server.js" >/dev/null 2>&1 & OURPID=$!; KILL_PIDS="$KILL_PIDS $OURPID"
printf '%s' "$OURPID" > "$H/board.pid"
OUT_ALIVE="$(run_arm 'this is Kosmos' "$H" 16180 "$L")"
chk "our running board (pid matches our server.js) -> 'could not be paused' die" has "$OUT_ALIVE" "A Kosmos board is still running on port 16180 and could not be paused"
chk "our running board -> the #2055 abort streak IS recorded" test -f "$L/update-abort"
if [ -f "$L/update-abort" ]; then
  chk "the recorded reason is board-would-not-pause" grep -q "reason=board-would-not-pause" "$L/update-abort"
fi

# ---- a LIVE but FOREIGN pid (the reused-pid case #964 targets) ---------------
# board.pid names a pid that is ALIVE but is NOT our server.js -- the exact shape a
# rebooted machine produces when the stale pid number was reused. A bare kill -0
# would pass this and wrongly take the "our board" branch; the ps-command match must
# route it to the foreign path.
L="$TMP/logs-reused"; mkdir -p "$L"; H="$TMP/home-reused"; mkdir -p "$H"
sleep 30 & FOREIGNPID=$!; KILL_PIDS="$KILL_PIDS $FOREIGNPID"
printf '%s' "$FOREIGNPID" > "$H/board.pid"
OUT_REUSED="$(run_arm 'Kosmos' "$H" 16180 "$L")"
chk "a LIVE but non-server pid (reused) -> the foreign 'Another Kosmos' die, not our-board" has "$OUT_REUSED" "Another Kosmos is answering on port 16180"
chk "a reused live pid does NOT inflate the board-would-not-pause streak" test '!' -f "$L/update-abort"

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
L="$TMP/logs-other"; mkdir -p "$L"; H="$TMP/home-other"; mkdir -p "$H"
make_server_js "$H"
/bin/sh "$H/app/server.js" >/dev/null 2>&1 & OURPID2=$!; KILL_PIDS="$KILL_PIDS $OURPID2"; printf '%s' "$OURPID2" > "$H/board.pid"
OUT_OTHER="$(run_arm 'some random web server' "$H" 16180 "$L")"
chk "a non-Kosmos body -> the 'Another app' die (arm unchanged)" has "$OUT_OTHER" "Another app on this computer is using port 16180"
OUT_EMPTY="$(run_arm '' "$H" 16180 "$L")"
chk "an empty body (board paused cleanly) -> no die at all" has "$OUT_EMPTY" "NODIE"

echo "test-pause-foreign-board-964: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
