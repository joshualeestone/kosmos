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
CALLS=0; ANSWER_AT=3
healthy() { CALLS=$((CALLS + 1)); if [ "$CALLS" -ge "$ANSWER_AT" ]; then HEALTH_STATE=ok; return 0; fi; HEALTH_STATE=down; return 1; }

# A board that answers on the third look: a success, said as running.
CALLS=0; ANSWER_AT=3
out="$(_await_recorded_board 4242; echo "rc=$?")"
case "$out" in
  *"already starting (process 4242)"*"Kosmos is running at"*"rc=0"*) ok "a starting board that answers in time is a success, and is said to be running" ;;
  *) bad "a starting board that answers: $out" ;;
esac

# A board that never answers: not a success after the bounded wait (cmd_start then says it is stuck).
CALLS=0; ANSWER_AT=1000
out="$(_await_recorded_board 4242; echo "rc=$? calls=$CALLS")"
case "$out" in *"rc=1"*) ok "a board still silent after the wait is not a success" ;; *) bad "a silent board: $out" ;; esac
n="$( CALLS=0; ANSWER_AT=1000; _await_recorded_board 4242 >/dev/null; echo "$CALLS" )"
[ "$n" -ge 20 ] && [ "$n" -le 40 ] && ok "the wait is bounded, as a fresh start's is ($n looks)" || bad "the wait made $n looks"

# The wait is the launchd kind (no pid), so a sandboxed shell never stops the board it found.
grep -q '^  _await_board_up$' <(awk '/^_await_recorded_board\(\) \{/ { on = 1 } on { print } on && /^}$/ { exit }' install/kosmos) \
  && ok "the wait passes no pid (a pid would make it stop the board in a sandbox)" || bad "the wait passes a pid"

# cmd_start waits before it calls a recorded board stuck.
awk '/^cmd_start\(\) \{/ { on = 1 } on && /_await_recorded_board "\$_oldpid"/ { w = NR } on && /already running \(process \$_oldpid\) but is not answering/ { if (w && w < NR) f = 1; exit }
     END { exit !f }' install/kosmos \
  && ok "cmd_start waits for a starting board before calling it stuck" || bad "cmd_start calls a starting board stuck without waiting"

echo
[ "$fails" -eq 0 ] && echo "test-start-waits-for-starting-board-6586: all passed" || { echo "test-start-waits-for-starting-board-6586: FAILED"; exit 1; }
