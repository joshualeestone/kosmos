#!/bin/bash
# #1073: browser-checks picks all 16 ports up front and binds late ones minutes
# later, so a late port can be taken by another run in the pick-to-bind window.
# When that NARROW race fires, the loser's node server exits with EADDRINUSE and
# the shipped code used to poll the full 30s and then report a generic "server
# never answered" -- a red that reads as a flaky check, exactly the
# unattributable failure that cost a morning in the #1073 sibling incident.
#
# The fix (this file guards it): wait_up reads EADDRINUSE from the server's own
# log and reports it BY NAME, and does so on the first iteration rather than
# after the timeout. It must match BOTH collision shapes: the RAW node
# "listen EADDRINUSE: address already in use" AND the board server's friendly
# "port <N> is already in use" (server.js ~9345, the shape that reaches almost
# every real boot). This test exercises the REAL wait_up function, extracted
# verbatim from tools/browser-checks.sh (not a paraphrase), across four arms:
#
#   1.  collision (raw)   -> returns 1 FAST and names "#1073 pick-to-bind collision"
#   1b. collision (board) -> the friendly "is already in use" wording is detected
#                            too; reds against a too-narrow EADDRINUSE-only pattern
#   2.  no-boot           -> the control: returns 1 with the generic "never
#                            answered" message and does NOT false-fire the collision path
#   3.  success           -> a real server answering /api/status still returns 0
#
# The control arm is the one that can return the dangerous answer: if the
# EADDRINUSE grep were too broad it would misfire here, on a log with no such
# line. KOSMOS_BC_WAIT_TRIES (a test-only seam wait_up honours) keeps the
# control arm's timeout to ~1s instead of the real 30s.
set -u
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

RUNNER="$(cd "$(dirname "$0")/.." && pwd)/tools/browser-checks.sh"
[ -r "$RUNNER" ] || { echo "FAIL  $RUNNER not found"; exit 1; }

# Extract the real wait_up definition (^wait_up() ... first ^} at col 0) and
# eval it, so we test the shipped function, not a copy that can drift from it.
WAIT_UP_SRC="$(awk '/^wait_up\(\) \{/{f=1} f{print} f&&/^\}/{exit}' "$RUNNER")"
case "$WAIT_UP_SRC" in
  *"KOSMOS_BC_WAIT_TRIES"*"EADDRINUSE"*) : ;;
  *) echo "FAIL  could not extract a wait_up carrying the #1073 fix from $RUNNER"; exit 1 ;;
esac
# wait_up calls log(); stub it so its output is capturable and nothing else runs.
log() { printf '%s\n' "$*"; }
eval "$WAIT_UP_SRC"

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

# A port nothing is listening on: pick one with the OS then leave it unbound, so
# curl to it fails exactly as it would for a server that never came up.
DEAD_PORT="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')"

# --- 1. collision arm: EADDRINUSE in the log -> named, and FAST --------------
COLL_LOG="$T/collision.log"
cat > "$COLL_LOG" <<EOF
node:events:497
      throw er; // Unhandled 'error' event
      ^
Error: listen EADDRINUSE: address already in use 127.0.0.1:$DEAD_PORT
EOF
start=$(date +%s)
out="$(wait_up "$DEAD_PORT" "$COLL_LOG")"; rc=$?
elapsed=$(( $(date +%s) - start ))
[ "$rc" -eq 1 ] && ok "collision returns non-zero" || bad "collision should return 1, got $rc"
case "$out" in
  *"#1073 pick-to-bind collision"*) ok "collision is named (#1073), not a generic timeout" ;;
  *) bad "collision message missing #1073 name; got: $out" ;;
esac
[ "$elapsed" -le 5 ] && ok "collision fails fast (${elapsed}s, not the 30s poll)" \
  || bad "collision took ${elapsed}s; should fail on first iteration, not poll"

# --- 1b. board-server collision: the friendly "port <N> is already in use" ---
# This is the arm that MATTERS: nearly every boot runs the board server
# (server.js), which catches EADDRINUSE and writes a friendly
#   Kosmos could not start: port <N> is already in use. Is a board already running?
# (server.js ~9345) - no "EADDRINUSE", no "address". A detection pattern of
# EADDRINUSE|address-already-in-use MISSES exactly the production collision, so
# this arm exists to red against that too-narrow pattern. The raw arm above
# (1) models only thread-server.js / a bare node default.
BOARD_LOG="$T/board.log"
cat > "$BOARD_LOG" <<EOF
Kosmos could not start: port $DEAD_PORT is already in use. Is a board already running?
EOF
out="$(wait_up "$DEAD_PORT" "$BOARD_LOG")"; rc=$?
[ "$rc" -eq 1 ] && ok "board collision returns non-zero" || bad "board collision should return 1, got $rc"
case "$out" in
  *"#1073 pick-to-bind collision"*) ok "board collision is named (#1073) despite no literal EADDRINUSE" ;;
  *) bad "board collision (friendly 'is already in use') not detected; got: $out" ;;
esac

# --- 2. no-boot control: empty log -> generic message, no false collision ----
DEAD_LOG="$T/never.log"
: > "$DEAD_LOG"
out="$(KOSMOS_BC_WAIT_TRIES=2 wait_up "$DEAD_PORT" "$DEAD_LOG")"; rc=$?
[ "$rc" -eq 1 ] && ok "no-boot returns non-zero" || bad "no-boot should return 1, got $rc"
case "$out" in
  *"pick-to-bind collision"*) bad "no-boot FALSE-fired the collision path on a log with no EADDRINUSE" ;;
  *"never answered"*)         ok "no-boot reports the generic 'never answered', collision path not triggered" ;;
  *)                          bad "no-boot produced neither expected message; got: $out" ;;
esac

# --- 3. success arm: a real server answering /api/status -> returns 0 --------
LIVE_PORT="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')"
LIVE_LOG="$T/live.log"
node -e '
  const p = Number(process.argv[1]);
  require("node:http").createServer((q,r)=>{ r.writeHead(q.url==="/api/status"?200:404); r.end("{}"); }).listen(p,"127.0.0.1");
' "$LIVE_PORT" > "$LIVE_LOG" 2>&1 &
LIVE_PID=$!
trap '{ kill "$LIVE_PID" && wait "$LIVE_PID"; } 2>/dev/null; rm -rf "$T"' EXIT
if wait_up "$LIVE_PORT" "$LIVE_LOG"; then ok "success arm: a live server returns 0"
else bad "success arm: wait_up did not see a live server on :$LIVE_PORT"; fi

echo "----"
if [ "$FAILS" -eq 0 ]; then echo "OK    all wait_up #1073 arms passed"; exit 0
else echo "FAIL  $FAILS wait_up #1073 arm(s) failed"; exit 1; fi
