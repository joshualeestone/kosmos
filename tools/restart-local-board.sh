#!/bin/bash
# Restart the board that runs from THIS repo on THIS Mac, if there is one, and
# say so either way (#360).
#
# 🛑 WHY THIS EXISTS. `tools/release.sh` publishes to installs; it never touched
# the board on the developer's own Mac, which runs the repo under a hand-written
# launchd plist (com.kosmos.board, KeepAlive) and is what Josh reviews in. So
# every merge that touched engine/ or server.js left that board serving the
# previous code until somebody noticed: three stale-board incidents and four
# hand restarts on 2026-08-23 alone. The release is the moment the code on disk
# is the code that should be running, so the release restarts it.
#
# 🔑 GATED ON REALITY, NOT ASSUMED. It restarts only when a launchd job named
# com.kosmos.board exists AND its working directory is this repo; an installed
# Kosmos (which updates itself) or a Mac with no board is left alone, and the
# script says which case it found. `launchctl stop` on a KeepAlive job is the
# restart: launchd brings it back on the code now on disk.
#
# 🕐 #2044: VERIFY THE OUTCOME, NOT A FIXED WINDOW. The plist sets KeepAlive with
# no ThrottleInterval, so `launchctl stop` respawns the job under launchd's DEFAULT
# 10-second throttle; the board then boots node and only THEN answers on the new
# version, commonly at ~10-13s. The old check capped at ~10 wall-seconds (10x
# `sleep 1`) and exited 1 on that perfectly healthy board -- failing a served,
# verified cut on TIMING rather than on any real fault (release.sh runs this under
# `set -e`, so that exit 1 aborted the whole cut AFTER the pointer was already live).
# This waits a generous deadline (KOSMOS_BOARD_WAIT_SECS, default 45s) for the
# OUTCOME -- the board serving the code on disk -- and returns success the moment it
# does, however long that took.
#
# 🕐 #2109: WHAT A DEADLINE MISS MEANS DEPENDS ON WHY. Even 120s (#2090) was measured
# too short under full fleet load: both 0.6.27 and 0.6.28 had the board flip at ~121s
# and false-failed a cut whose bytes had ALREADY served and verified at steps 8-9.
# But simply widening the deadline again just moves the cliff. The real distinction is
# the CAUSE of the miss, and this board runs FROM THIS REPO (checked below), so a
# restart always comes back on the code ON DISK, never the old:
#   - Still SERVING A DIFFERENT version after the deadline  -> launchd never restarted
#     it, it is serving STALE code (#360). Genuine failure, still exits 1.
#   - NOT ANSWERING after the deadline                      -> down or mid-restart, NOT
#     serving stale code; it will come back on the new code. A WARNING, not a cut
#     failure -- the release is already served and verified.
# The fix removes the false positive on a slow/restarting board while keeping the
# #360 catch (a board genuinely stuck on old code) red.
#
# 🔬 PROVABLE. tools/test-restart-local-board.sh drives the wait against a stub board
# and asserts the success arm (serves the wanted version -> exit 0), the slow-but-
# healthy arm (flips to it late, still exit 0 -- the exact case the old cap broke),
# the STALE arm (keeps serving a DIFFERENT version -> exit 1, the #360 catch), and,
# per #2109, the not-answering arm (down/restarting -> exit 0 with a WARNING) plus the
# slow-stale and transient-failure-stale arms that prove the patient poll + retries
# still catch a stale board the short poll missed. A check that has only ever seen a
# good machine has not been tested.
#
# Overrides (for the test; unset in normal use):
#   KOSMOS_BOARD_WAIT_SECS   seconds to wait for the outcome (default 45; also a real knob)
#   KOSMOS_BOARD_STATUS_URL  the status endpoint to poll (default http://127.0.0.1:$PORT/api/status)
#   KOSMOS_BOARD_WANT        the version to wait for (default: this repo's package.json)
#   KOSMOS_BOARD_POLL_ONLY   1 => skip launchd discovery and the restart; just run the poll
#
# Usage: bash tools/restart-local-board.sh            (from the release)
#        bash tools/restart-local-board.sh --check    (report only, no restart)
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.kosmos.board"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

WAIT_SECS="${KOSMOS_BOARD_WAIT_SECS:-45}"
# Validate the knob: a non-numeric value would make the arithmetic below error and,
# being a plain assignment, abort the whole cut under set -e with a cryptic message.
# A clear refusal is better than that.
case "$WAIT_SECS" in
  ''|*[!0-9]*) echo "   KOSMOS_BOARD_WAIT_SECS must be a non-negative integer (got '$WAIT_SECS')" >&2; exit 1 ;;
esac
# Normalise to base 10 ONCE, here, so downstream arithmetic never re-interprets a
# zero-padded value as octal. Without this, an all-digit but zero-padded knob like
# '08' or '09' passes the digit check above and then aborts at `$(( ))` with "value
# too great for base" (8 and 9 are not octal), and '010' silently becomes 8 -- both
# are exactly the cryptic-abort / wrong-value class the guard exists to close.
WAIT_SECS=$(( 10#$WAIT_SECS ))

# The version the board must serve for the restart to count as done: the code now on
# disk (this repo's package.json). Overridable so the test can name a version its
# stub controls.
want_version() {
  # Honoured when SET even to empty (the test's empty case), so the empty-target
  # guard in wait_for_want can be exercised; a `:-` default would treat an explicit
  # empty as unset and fall through to package.json. Same idiom as refresh-local-cli.
  if [ "${KOSMOS_BOARD_WANT+set}" = set ]; then
    printf '%s' "$KOSMOS_BOARD_WANT"
  else
    node -e "console.log(JSON.parse(require('fs').readFileSync('${REPO}/package.json','utf8')).version)"
  fi
}

# Ask the board at $1 which version it is serving (empty string if it is not
# answering or the response is not the expected JSON). $2 is the curl timeout in
# seconds (default 3). The post-deadline classification uses a LONGER timeout so a
# board that is UP but slow under load -- including a slow STALE one -- is not
# mistaken for "not answering" (#2109 review).
board_version() {
  curl -s -m "${2:-3}" "$1" 2>/dev/null \
    | node -e "let s='';process.stdin.on('data',(c)=>s+=c).on('end',()=>{try{console.log(JSON.parse(s).version||'')}catch{console.log('')}})" 2>/dev/null \
    || true
}

# Wait until the board at $1 serves version $2, or WAIT_SECS elapses. Clock-based,
# not an iteration count, so per-request latency cannot silently shorten the real
# wait. This is the #2044 OUTCOME check, extended by #2109 to distinguish two very
# different timeout causes. Returns:
#   0  the board serves the wanted version (success).
#   1  a GENUINE failure that must fail the cut: the wanted version is unknowable,
#      OR after the deadline the board is still SERVING A DIFFERENT (non-empty)
#      version. The latter is #360: launchd did not pick up the new code and the
#      developer's board is serving OLD bytes. That must red.
#   2  the board is NOT ANSWERING after the deadline (down or mid-restart). This is
#      NOT stale code -- launchd runs this board FROM THIS REPO, so when it comes
#      back it comes back on the code on disk (the new version), never the old. So a
#      silent board is a SLOW/restarting board, not a wrong one. The caller
#      downgrades it to a warning rather than failing a cut whose bytes already
#      served and verified at steps 8-9 (#2109: both 0.6.27 and 0.6.28 had the board
#      flip at ~121s under fleet load, just past a 120s deadline, and false-failed).
wait_for_want() {
  local url="$1" want="$2" got="" now deadline
  # An empty target would make "$got" = "$want" true the instant a DOWN board answers
  # with nothing, reporting a false "back on " success. If we cannot name the version
  # the board must serve, we cannot verify it -- that is a failure, not a pass.
  if [ -z "$want" ]; then
    echo "   cannot verify the local board: the wanted version is empty (could not read it from package.json?)" >&2
    return 1
  fi
  now="$(date +%s)"; deadline=$(( now + WAIT_SECS ))
  while :; do
    got="$(board_version "$url")"
    if [ "$got" = "$want" ]; then
      echo "   the local board is back on ${got}"
      return 0
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      break
    fi
    sleep 1
  done
  # The in-loop polls used a short (3s) timeout. Under the heavy load this check runs
  # in, that can time out even against a board that is UP -- and a slow-but-UP board
  # might be a STALE one. So before deciding "not answering", take a few PATIENT polls
  # (10s each) to let a slow board reveal its version. Without this, a stale board
  # whose short poll timed out at the deadline would be mis-downgraded to a warning
  # and ship stale code to the developer's review board silently (#2109 review).
  #
  # THREE tries, not one, so the security-critical stale->fail decision does not hinge
  # on a SINGLE sample: a transient failure on one poll would bias toward the unsafe
  # (warn/exit 0) direction for a genuinely stale board. A stale board (up, serving
  # old code) answers at least one of these; only a board that fails ALL three is
  # treated as down. 10s is the deliberate per-poll ceiling -- a lightweight status
  # endpoint answers well within it, and a longer one only delays a doomed cut. A
  # truly-down board is refused instantly (connection refused), so the retries cost
  # real time only against a board that is listening but pathologically slow.
  got=""
  for _try in 1 2 3; do
    got="$(board_version "$url" 10)"
    [ -n "$got" ] && break
  done
  if [ "$got" = "$want" ]; then
    echo "   the local board is back on ${got} (answered on a patient final poll)"
    return 0
  fi
  if [ -n "$got" ]; then
    # Serving a different, non-empty version after the deadline: launchd did not pick
    # up the new code. Genuinely stale (#360), the exact fault this step exists for.
    echo "   THE LOCAL BOARD IS STILL SERVING ${got}, NOT ${want}, AFTER ${WAIT_SECS}s -- launchd did not pick up the new code (#360); check ~/Library/Logs/kosmos-board.log" >&2
    return 1
  fi
  # Not answering at all, even to the patient poll: down or mid-restart, NOT serving
  # stale code.
  echo "   the local board did not answer within ${WAIT_SECS}s, even on a patient final poll (last answer: 'none')" >&2
  return 2
}

# Map a wait_for_want outcome to an exit code + the cut-level message, so both call
# sites (the poll-only test seam and the real restart) decide identically. A silent
# board (rc 2) is a WARNING, not a cut failure -- see wait_for_want's rc 2 note. The
# `|| rc=$?` keeps set -e from aborting on the non-zero return.
board_outcome_exit() {
  local rc=0
  wait_for_want "$1" "$2" || rc=$?
  case "$rc" in
    0) exit 0 ;;
    2)
      echo "   WARNING: the local board did not come back within ${WAIT_SECS}s and is NOT answering. It is not serving stale code (a board that runs from this repo comes back on the code on disk), and this release is already served and verified, so the cut is NOT failed on this. If the board stays down the new code may be failing to start on this machine -- check ~/Library/Logs/kosmos-board.log." >&2
      exit 0
      ;;
    *) exit 1 ;;
  esac
}

# Test seam: drive the poll/outcome logic directly against a stub, with no launchd
# and no real restart. This exercises exactly the logic #2044 and #2109 changed, in
# isolation, so the success, stale (exit 1) and not-answering (exit 0) arms can all
# be proven.
if [ "${KOSMOS_BOARD_POLL_ONLY:-}" = 1 ]; then
  _url="${KOSMOS_BOARD_STATUS_URL:-http://127.0.0.1:${KOSMOS_PORT:-16180}/api/status}"
  board_outcome_exit "$_url" "$(want_version)"
fi

if ! command -v launchctl >/dev/null 2>&1; then
  echo "   no launchctl on this machine, so no local board to restart"
  exit 0
fi
UID_NOW="$(id -u)"
INFO="$(launchctl print "gui/${UID_NOW}/${LABEL}" 2>/dev/null || true)"
if [ -z "$INFO" ]; then
  echo "   no ${LABEL} job on this Mac, so nothing to restart (an installed Kosmos updates itself)"
  exit 0
fi
WD="$(printf '%s\n' "$INFO" | sed -n 's/^[[:space:]]*working directory = //p' | head -1)"
if [ "$WD" != "$REPO" ]; then
  echo "   ${LABEL} runs from ${WD:-<unknown>}, not from this repo (${REPO}); leaving it alone"
  exit 0
fi
PORT="$(printf '%s\n' "$INFO" | sed -n 's/.*PORT => \([0-9]*\).*/\1/p' | head -1)"
[ -n "$PORT" ] || PORT=16180
STATUS_URL="${KOSMOS_BOARD_STATUS_URL:-http://127.0.0.1:${PORT}/api/status}"
BEFORE="$(curl -s -m 3 "$STATUS_URL" 2>/dev/null | node -e "let s='';process.stdin.on('data',(c)=>s+=c).on('end',()=>{try{const d=JSON.parse(s);console.log((d.version||'?')+' started '+((d.engine&&d.engine.startedAt)||'?'))}catch{console.log('not answering')}})" 2>/dev/null || echo "not answering")"
if [ "$CHECK" = 1 ]; then
  echo "   ${LABEL} runs from this repo on port ${PORT}: ${BEFORE}"
  exit 0
fi
echo "   ${LABEL} runs from this repo (was ${BEFORE}); restarting it"
launchctl stop "gui/${UID_NOW}/${LABEL}" 2>/dev/null || launchctl stop "${LABEL}"
# KeepAlive brings it back; wait a generous deadline for it to answer with the code
# on disk. See the #2044 note above: a fixed 10s cap raced launchd's 10s respawn
# throttle and false-failed healthy cuts. #2109: a board still SILENT after the
# deadline is a warning (it comes back on the code on disk), only a board SERVING
# STALE code fails the cut.
board_outcome_exit "$STATUS_URL" "$(want_version)"
