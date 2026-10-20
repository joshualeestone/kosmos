#!/bin/bash
# kosmos#6586: `kosmos start` that finds a recorded board alive but not answering YET (launchd bringing it back after
# an update's pause) waits the same bounded time a fresh start gets, and calls it stuck only if it stays silent.
#
# The real install/kosmos is sourced (functions only, as tools/test-kosmos-addr-reclaim-3079.sh does), with healthy()
# and sleep stubbed: no board, no network, no waiting.
set -u
cd "$(dirname "$0")/.." || exit 1
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-6586.XXXXXX")"
trap 'rm -rf "${SANDBOX:?}"' EXIT
export KOSMOS_HOME="$SANDBOX/home"; mkdir -p "$KOSMOS_HOME"
export KOSMOS_PORT=17686
fails=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fails=1; }

source install/kosmos
set +e +u   # the CLI sets -euo pipefail; relax so an assertion failure does not abort

sleep() { :; }
LIVE_PID="$$"   # a pid that is alive throughout (this test's own shell)
CALLS=0; ANSWER_AT=3; STATE=down
healthy() { CALLS=$((CALLS + 1)); if [ "$CALLS" -ge "$ANSWER_AT" ]; then HEALTH_STATE=ok; return 0; fi; HEALTH_STATE="$STATE"; return 1; }
arb() { _await_recorded_board "$1"; echo "rc=$?"; }

CALLS=0; ANSWER_AT=3; STATE=down
out="$(arb "$LIVE_PID")"
case "$out" in
  *"not answering yet; waiting for it"*"Kosmos is running at"*"rc=0"*) ok "a starting board that answers in time is a success, and is said to be running" ;;
  *) bad "a starting board that answers: $out" ;;
esac
n="$( CALLS=0; ANSWER_AT=1000; STATE=down; _await_recorded_board "$LIVE_PID" >/dev/null; echo "$? $CALLS" )"
[ "$n" = "1 30" ] && ok "a board still silent after the bounded wait (30 looks, as a fresh start's) is stuck (rc 1)" || bad "a silent board: rc and looks '$n'"
out="$( CALLS=0; ANSWER_AT=1000; STATE=busy; arb "$LIVE_PID" )"
case "$out" in *"busy right now"*"rc=0"*) ok "busy is up for a plain start" ;; *) bad "busy, plain start: $out" ;; esac
n="$( CALLS=0; ANSWER_AT=1000; STATE=busy; KOSMOS_RECLAIM_BUSY=1; _await_recorded_board "$LIVE_PID" >/dev/null; echo "$? $CALLS" )"
[ "$n" = "1 30" ] && ok "busy is NOT a success for a reclaim (KOSMOS_RECLAIM_BUSY=1: the caller judged it stale)" || bad "busy under reclaim: '$n'"
n="$( CALLS=0; ANSWER_AT=1000; STATE=unreachable; _await_recorded_board "$LIVE_PID" >/dev/null; echo "$? $CALLS" )"
[ "$n" = "1 1" ] && ok "unreachable from this shell: stuck at once (waiting cannot change it)" || bad "unreachable: '$n'"
( exit 0 ) & DEAD=$!; wait "$DEAD" 2>/dev/null
n="$( CALLS=0; ANSWER_AT=1000; STATE=down; _await_recorded_board "$DEAD" >/dev/null; echo "$? $CALLS" )"
[ "$n" = "2 1" ] && ok "a board that exits while starting: rc 2 at once" || bad "an exited board: '$n'"

# The wait never signals the board it did not launch: kill -0 (a probe) is its only kill.
fnb="$(awk '/^_await_recorded_board\(\) \{/ { on = 1 } on { print } on && /^}$/ { exit }' install/kosmos)"
kills="$(printf '%s\n' "$fnb" | grep -oE 'kill +-?[A-Za-z0-9]+' | sort -u | tr '\n' ' ')"
[ "$kills" = "kill -0 " ] && ok "the wait only probes the board (kill -0), never signals it" || bad "the wait signals the board: '$kills'"
printf '%s\n' "$fnb" | grep -q '_await_board_up' && bad "the wait reuses _await_board_up (its launch words)" || ok "the wait does not reuse _await_board_up's launch wording"

# cmd_start waits before it calls a recorded board stuck.
awk '/^cmd_start\(\) \{/ { on = 1 } on && /_await_recorded_board "\$_oldpid" \|\| _arb=\$\?/ { w = NR } on && /already running \(process \$_oldpid\) but is not answering/ { if (w && w < NR) f = 1; exit }
     END { exit !f }' install/kosmos \
  && ok "cmd_start waits for a starting board before calling it stuck" || bad "cmd_start calls a starting board stuck without waiting"
awk '/^cmd_start\(\) \{/ { on = 1 } on && /if \[ "\$_arb" -eq 2 \]; then/ { a = 1 } on && a && /rm -f "\$PIDFILE"/ { b = 1 } on && a && /exited while starting; starting Kosmos/ { c = 1; exit } END { exit !(b && c) }' install/kosmos \
  && ok "a board that exited while starting: its pidfile goes and the start goes ahead" || bad "an exited board does not lead to a normal start"

echo
[ "$fails" -eq 0 ] && echo "test-start-waits-for-starting-board-6586: all passed" || { echo "test-start-waits-for-starting-board-6586: FAILED"; exit 1; }
