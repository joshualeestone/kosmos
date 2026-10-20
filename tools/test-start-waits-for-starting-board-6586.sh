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
[ "$n" = "1 31" ] && ok "a board still silent after the bounded wait (30 looks, as a fresh start's, and one last) is stuck (rc 1)" || bad "a silent board: rc and looks '$n'"
out="$( CALLS=0; ANSWER_AT=1000; STATE=busy; arb "$LIVE_PID" )"
case "$out" in *"busy right now"*"rc=0"*) ok "busy is up for a plain start" ;; *) bad "busy, plain start: $out" ;; esac
n="$( CALLS=0; ANSWER_AT=1000; STATE=busy; KOSMOS_RECLAIM_BUSY=1; _await_recorded_board "$LIVE_PID" >/dev/null; echo "$? $CALLS" )"
[ "$n" = "1 31" ] && ok "busy is NOT a success for a reclaim (KOSMOS_RECLAIM_BUSY=1: the caller judged it stale)" || bad "busy under reclaim: '$n'"
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

# The verdict after the wait is the one the first look gives the same state (iteration 4): cmd_start itself runs, with
# the port, the listener and health stubbed. AT is the look after which the board holds the port: 0 means at the first
# look (the control), 3 means it got there during the wait.
_mark_board_started() { :; }
running_pid() { [ -f "$PIDFILE" ] && cat "$PIDFILE"; }
bound() { [ "$N" -gt "$AT" ]; }
_listener_is_our_board() { bound && [ "$X" != stranger ] && [ "$X" != unreachable ] && printf '%s' "$LIVE_PID"; }
port_has_listener() { bound && [ "$X" != unreachable ]; }
port_taken_by_stranger() { bound && [ "$X" = stranger ]; }
port_listener_owner() { if [ "$X" = stranger ]; then printf '99999 %s 0 0' "$(id -u)"; else printf '%s %s 1 1' "$LIVE_PID" "$(id -u)"; fi; }
_unreachable_is_ours() { :; }
kill() { if [ "$1" = -0 ]; then command kill "$@"; else echo "KILL $*"; return 0; fi; }
healthy() { N=$((N+1)); if bound; then HEALTH_STATE=$X; else HEALTH_STATE=down; fi; return 1; }
start_as() { # X AT -> the outcome without the waiting line and the pid, then rc and whether the stop marker is back
  X=$1; AT=$2; N=0; printf '%s' "$LIVE_PID" > "$PIDFILE"; : > "$STOP_MARKER"
  ( cmd_start ) 2>&1 | grep -v 'not answering yet; waiting' | sed 's/process [0-9]*/process P/g'
  echo "rc=${PIPESTATUS[0]} marker=$([ -e "$STOP_MARKER" ] && echo back || echo gone)"
}
same_as_first_look() { # name, then the env for the run
  local want got; want="$(start_as "$1" 0)"; got="$(start_as "$1" 3)"
  [ -n "$want" ] && [ "$want" = "$got" ] && ok "$2: the same verdict as at the first look ($(printf '%s' "$want" | tail -1))" \
    || bad "$2: first look '$want' vs during the wait '$got'"
}
same_as_first_look stranger "plain start, a stranger takes the port during the wait"
same_as_first_look down "plain start, our board binds and stays silent during the wait"
same_as_first_look unreachable "plain start, the board turns unreachable during the wait"
export KOSMOS_RECLAIM_BUSY=1
same_as_first_look busy "reclaim, the board binds busy during the wait (the #3079 reclaim, not a stuck die)"
same_as_first_look unreachable "reclaim, unreachable during the wait (refused, the stop marker put back)"
unset KOSMOS_RECLAIM_BUSY
case "$(start_as unreachable 3)" in *"rc=1 marker=back"*) bad "plain unreachable refused" ;; *"Nothing was started."*"rc=0"*) ok "plain unreachable during the wait: already running, nothing started" ;; *) bad "plain unreachable: $(start_as unreachable 3)" ;; esac
case "$(KOSMOS_RECLAIM_BUSY=1 start_as unreachable 3)" in *"rc=1 marker=back"*) ok "reclaim unreachable during the wait: refused and the stop marker is back" ;; *) bad "reclaim unreachable: $(KOSMOS_RECLAIM_BUSY=1 start_as unreachable 3)" ;; esac
case "$(KOSMOS_RECLAIM_BUSY=1 start_as busy 3)" in *"Reclaiming it."*) ok "reclaim busy during the wait reaches the reclaim" ;; *) bad "reclaim busy: $(KOSMOS_RECLAIM_BUSY=1 start_as busy 3)" ;; esac
X=down; AT=1000; N=0; printf '%s' "$LIVE_PID" > "$PIDFILE"
case "$( ( cmd_start ) 2>&1; echo "rc=$?" )" in *"is not answering on port"*"rc=1"*) ok "a board that never binds is still called stuck after one wait" ;; *) bad "never-binding board not called stuck" ;; esac
n="$(grep -c '_await_recorded_board "\$_oldpid"' install/kosmos)"; [ "$n" = 1 ] && ok "cmd_start waits in one place" || bad "wait call sites: $n"

echo
[ "$fails" -eq 0 ] && echo "test-start-waits-for-starting-board-6586: all passed" || { echo "test-start-waits-for-starting-board-6586: FAILED"; exit 1; }
