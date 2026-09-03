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
# does, however long that took. A board STILL not on that version after the deadline
# is a genuine failure (stale code, or down) and still exits 1: the fix removes the
# false positive, it does not stop the step failing when the board really is wrong.
#
# 🔬 PROVABLE. tools/test-restart-local-board.sh drives the wait against a stub board
# and asserts the success arm (serves the wanted version -> exit 0), the slow-but-
# healthy arm (flips to it late, still exit 0 -- the exact case the old cap broke),
# and the failure arm (never serves it -> exit 1). A check that has only ever seen a
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
# answering or the response is not the expected JSON).
board_version() {
  curl -s -m 3 "$1" 2>/dev/null \
    | node -e "let s='';process.stdin.on('data',(c)=>s+=c).on('end',()=>{try{console.log(JSON.parse(s).version||'')}catch{console.log('')}})" 2>/dev/null \
    || true
}

# Wait until the board at $1 serves version $2, or WAIT_SECS elapses. Clock-based,
# not an iteration count, so per-request latency cannot silently shorten the real
# wait. This is the #2044 OUTCOME check: return 0 the instant the board serves the
# wanted code; return 1 only if it never does within the deadline -- a genuine
# failure, whatever its cause.
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
  echo "   THE LOCAL BOARD DID NOT COME BACK ON ${want} WITHIN ${WAIT_SECS}s (last answer: '${got:-none}'); check ~/Library/Logs/kosmos-board.log" >&2
  return 1
}

# Test seam: drive the poll/outcome logic directly against a stub, with no launchd
# and no real restart. This exercises exactly the logic #2044 changed, in isolation,
# so both the success and failure arms can be proven.
if [ "${KOSMOS_BOARD_POLL_ONLY:-}" = 1 ]; then
  _url="${KOSMOS_BOARD_STATUS_URL:-http://127.0.0.1:${KOSMOS_PORT:-16180}/api/status}"
  if wait_for_want "$_url" "$(want_version)"; then exit 0; else exit 1; fi
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
# throttle and false-failed healthy cuts.
if wait_for_want "$STATUS_URL" "$(want_version)"; then exit 0; else exit 1; fi
