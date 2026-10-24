#!/bin/bash
# kosmos#6586: `kosmos start` that finds a recorded board alive but not answering YET (launchd bringing it back after
# an update's pause) waits the same bounded time a fresh start gets, and calls it stuck only if it stays silent.
#
# The real install/kosmos is sourced (functions only, as tools/test-kosmos-addr-reclaim-3079.sh does), with healthy()
# and sleep stubbed: no board, no network, no waiting.
set -u
cd "$(dirname "$0")/.." || exit 1
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-6586.XXXXXX")"
VICTIMS=""   # stand-in boards this test starts (orphaned, so launchd reaps them), ended on any exit
trap 'for _v in $VICTIMS; do command kill "$_v" 2>/dev/null; done; rm -rf "${SANDBOX:?}"' EXIT
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
awk '/^cmd_start\(\) \{/ { on = 1 } on && /if \[ "\$_arb" -eq 2 \]; then/ { a = 1 } on && a && /rm -f "\$PIDFILE"/ { b = 1 } on && a && /exited while starting\./ { c = 1; exit } END { exit !(b && c) }' install/kosmos \
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
same_as_first_look() { # state, name, the verdict text expected in both
  local want got; want="$(start_as "$1" 0)"; got="$(start_as "$1" 3)"
  [ -n "$want" ] && [ "$want" = "$got" ] && case "$want" in *"$3"*) true ;; *) false ;; esac && ok "$2: the same verdict as at the first look ($(printf '%s' "$want" | tail -1))" \
    || bad "$2: first look '$want' vs during the wait '$got'"
}
same_as_first_look stranger "plain start, a stranger takes the port during the wait" "Another app on this computer is already using port"
same_as_first_look down "plain start, our board binds and stays silent during the wait" "but it did not answer this command."
same_as_first_look unreachable "plain start, the board turns unreachable during the wait" "Nothing was started."
export KOSMOS_RECLAIM_BUSY=1
same_as_first_look busy "reclaim, the board binds busy during the wait (the #3079 reclaim, not a stuck die)" "Reclaiming it."
same_as_first_look unreachable "reclaim, unreachable during the wait (refused, the stop marker put back)" "Nothing was started or stopped"
unset KOSMOS_RECLAIM_BUSY
case "$(start_as unreachable 3)" in *"rc=1 marker=back"*) bad "plain unreachable refused" ;; *"Nothing was started."*"rc=0"*) ok "plain unreachable during the wait: already running, nothing started" ;; *) bad "plain unreachable: $(start_as unreachable 3)" ;; esac
case "$(KOSMOS_RECLAIM_BUSY=1 start_as unreachable 3)" in *"rc=1 marker=back"*) ok "reclaim unreachable during the wait: refused and the stop marker is back" ;; *) bad "reclaim unreachable: $(KOSMOS_RECLAIM_BUSY=1 start_as unreachable 3)" ;; esac
case "$(KOSMOS_RECLAIM_BUSY=1 start_as busy 3)" in *"Reclaiming it."*) ok "reclaim busy during the wait reaches the reclaim" ;; *) bad "reclaim busy: $(KOSMOS_RECLAIM_BUSY=1 start_as busy 3)" ;; esac
X=down; AT=1000; N=0; printf '%s' "$LIVE_PID" > "$PIDFILE"
case "$( ( cmd_start ) 2>&1; echo "rc=$?" )" in *"is not answering on port"*"rc=1"*) ok "a board that never binds is still called stuck after one wait" ;; *) bad "never-binding board not called stuck" ;; esac
# A stand-in board: a 60 s wait orphaned at once, so launchd reaps it when it ends. (A child of this shell would stay a
# zombie inside a command substitution, and a zombie still answers kill -0, so its exit would go unseen.) Not a
# `sleep`: on a shared machine a `pkill -f "sleep 6"` aimed at something else would end it mid-test (#6671).
victim() { local v; v="$( ( command perl -e 'select(undef, undef, undef, 60)' >/dev/null 2>&1 & echo $! ) )"; VICTIMS="$VICTIMS $v"; printf '%s' "$v"; }
# End one and return only once it is gone (bounded: about 5 s).
end_board() { local i=0; command kill "$1" 2>/dev/null
  while command kill -0 "$1" 2>/dev/null && [ "$i" -lt 100 ]; do command sleep 0.05; i=$((i + 1)); done; }

# Iteration 5: a board that exits during the wait while launchd already recorded its replacement: the replacement gets
# its own wait (the control: the same board recorded at the first look, answering at the same look).
healthy() { N=$((N+1))
  if [ "$N" = 2 ] && [ -n "$OLD" ]; then end_board "$OLD"; printf '%s' "$LIVE_PID" > "$PIDFILE"; fi
  if [ "$N" -ge "$ANS" ]; then HEALTH_STATE=ok; return 0; fi; HEALTH_STATE=down; return 1; }
X=down; AT=1000; ANS=6
OLD=""; N=0; printf '%s' "$LIVE_PID" > "$PIDFILE"; ctl="$( ( cmd_start ) 2>&1; echo "rc=$?" )"
OLD="$(victim)"; N=0; printf '%s' "$OLD" > "$PIDFILE"; race="$( ( cmd_start ) 2>&1; echo "rc=$?" )"
end_board "$OLD"; OLD=""
case "$ctl|$race" in *"Kosmos is running at"*"rc=0|"*"exited while starting."*"Kosmos is running at"*"rc=0") ok "a replacement recorded after an exit gets its own wait, as at the first look" ;;
  *) bad "relaunch race: control '$ctl' race '$race'" ;; esac
# The looks are counted in a file: cmd_start dies in a subshell, so the parent's N never moves, and a count that rests
# on how that subshell ends (an EXIT trap) once came back empty in the full suite on Mortals, never alone. One wait
# for the one board: the first look, its 31, and the second pass's. On a mismatch, the start's own words are shown.
LOOKS="$SANDBOX/looks"; : > "$LOOKS"
healthy() { echo look >> "$LOOKS"; HEALTH_STATE=down; return 1; }
printf '%s' "$LIVE_PID" > "$PIDFILE"; said="$( ( cmd_start ) 2>&1; echo "rc=$?" )"
looks="$(wc -l < "$LOOKS" | tr -d ' ')"
case "$looks|$said" in "33|"*"is not answering on port"*"rc=1") ok "a board that never answers gets one wait, then the stuck refusal ($looks looks)" ;;
  *) bad "a silent board: $looks looks, and the start said: $said" ;; esac

# The cap: a board replaced again and again gets two waits, then the stuck refusal (not a wait per replacement).
SLEEPERS=""; for _i in 1 2 3 4; do SLEEPERS="$SLEEPERS $(victim)"; done
# Looks 2, 3 and 4 each end the recorded board and record the next one; the fourth then stays, silent.
healthy() { N=$((N+1)); local cur
  if [ "$N" -ge 2 ] && [ "$REPL" -lt 4 ]; then cur="$(cat "$PIDFILE")"; end_board "$cur"
    set -- $SLEEPERS; shift "$REPL"; REPL=$((REPL + 1)); printf '%s' "$1" > "$PIDFILE"; fi
  HEALTH_STATE=down; return 1; }
set -- $SLEEPERS; REPL=1; printf '%s' "$1" > "$PIDFILE"
out="$( ( N=0; cmd_start ) 2>&1 )"
for _p in $SLEEPERS; do end_board "$_p"; done
waits="$(printf '%s\n' "$out" | grep -c 'not answering yet; waiting for it')"
case "$out" in *"is not answering on port"*) ex="$(printf '%s\n' "$out" | grep -c 'exited while starting\.')"
    [ "$waits" = 2 ] && [ "$ex" = 2 ] && ok "a board replaced again and again: two waits, each ended by the board's exit, then the stuck refusal" || bad "waits $waits, exits seen $ex" ;;
  *) bad "the cap: $out" ;; esac
# Iteration 7: a stop during the wait (the marker written, the board ended) wins: nothing reaches the launch, whose
# first check is the runtime ("Kosmos looks incomplete"), and the marker stays.
healthy() { N=$((N+1)); if [ "$N" = 3 ]; then : > "$STOP_MARKER"; end_board "$OLD"; fi; HEALTH_STATE=down; return 1; }
stop_during_wait() { OLD="$(victim)"; N=0; printf '%s' "$OLD" > "$PIDFILE"
  ( cmd_start ) 2>&1; echo "rc=$? marker=$([ -e "$STOP_MARKER" ] && echo there || echo gone)"; end_board "$OLD"; OLD=""; }
out="$(stop_during_wait)"
case "$out" in *"looks incomplete"*) bad "a stop during the wait still reached the launch: $out" ;;
  *"stopped while this start waited for it. Nothing was started."*"rc=0 marker=there") ok "a stop during the wait wins: nothing launched, the marker stays, a plain start returns 0" ;;
  *) bad "stop during the wait: $out" ;; esac
out="$(KOSMOS_RECLAIM_BUSY=1 stop_during_wait)"
case "$out" in *"looks incomplete"*) bad "a stop during a reclaim's wait reached the launch: $out" ;;
  *"stopped while this start waited for it."*"rc=1 marker=there") ok "under reclaim a stop during the wait is a failure (the caller asked for a board), nothing launched" ;;
  *) bad "stop during a reclaim's wait: $out" ;; esac
n="$(grep -c '_await_recorded_board "\$_oldpid"' install/kosmos)"; [ "$n" = 1 ] && ok "cmd_start waits in one place" || bad "wait call sites: $n"

echo
[ "$fails" -eq 0 ] && echo "test-start-waits-for-starting-board-6586: all passed" || { echo "test-start-waits-for-starting-board-6586: FAILED"; exit 1; }
