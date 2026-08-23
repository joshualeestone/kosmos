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
# Usage: bash tools/restart-local-board.sh            (from the release)
#        bash tools/restart-local-board.sh --check    (report only, no restart)
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.kosmos.board"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

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
BEFORE="$(curl -s -m 3 "http://127.0.0.1:${PORT}/api/status" 2>/dev/null | node -e "let s='';process.stdin.on('data',(c)=>s+=c).on('end',()=>{try{const d=JSON.parse(s);console.log((d.version||'?')+' started '+((d.engine&&d.engine.startedAt)||'?'))}catch{console.log('not answering')}})" 2>/dev/null || echo "not answering")"
if [ "$CHECK" = 1 ]; then
  echo "   ${LABEL} runs from this repo on port ${PORT}: ${BEFORE}"
  exit 0
fi
echo "   ${LABEL} runs from this repo (was ${BEFORE}); restarting it"
launchctl stop "gui/${UID_NOW}/${LABEL}" 2>/dev/null || launchctl stop "${LABEL}"
# KeepAlive brings it back; wait for it to answer with the code on disk.
WANT="$(node -e "console.log(JSON.parse(require('fs').readFileSync('${REPO}/package.json','utf8')).version)")"
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  GOT="$(curl -s -m 3 "http://127.0.0.1:${PORT}/api/status" 2>/dev/null | node -e "let s='';process.stdin.on('data',(c)=>s+=c).on('end',()=>{try{console.log(JSON.parse(s).version||'')}catch{console.log('')}})" 2>/dev/null || true)"
  if [ "$GOT" = "$WANT" ]; then
    echo "   the local board is back on ${GOT}"
    exit 0
  fi
done
echo "   THE LOCAL BOARD DID NOT COME BACK ON ${WANT} WITHIN TEN SECONDS (last answer: '${GOT:-none}'); check ~/Library/Logs/kosmos-board.log"
exit 1
