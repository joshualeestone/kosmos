#!/bin/bash
# #4911: a light run's SIDE turn beside a heavy one, and light waiters aging like heavy ones. Every arm runs against a
# private marker dir and probe seams, so nothing here reads or writes the real queue.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib/cut-guard.sh"
unset $KOSMOS_WAIT_CONTROL_VARS KOSMOS_SIDE_LANE KOSMOS_SIDE_MAX_LOAD KOSMOS_SIDE_MIN_HOLD_S KOSMOS_LIGHT_SIDE_COOKIE \
  KOSMOS_MACHINE_CLAIM_COOKIE KOSMOS_QUEUE_CLASS KOSMOS_QUEUE_STARVE_S
T="$(mktemp -d)"
sleep 600 </dev/null >/dev/null 2>&1 & HOLDER=$!
sleep 600 </dev/null >/dev/null 2>&1 & OTHER=$!
# A stand-in suite that is NOT this shell's descendant (this shell holds a queue marker in the side arms, and a
# waiter's descendants are not suites): orphaned at once, so its parent is launchd, as a real agent's suite's is not ours.
ORPHAN="$(sh -c 'sleep 600 </dev/null >/dev/null 2>&1 & echo $!')"
trap 'kill "$HOLDER" "$OTHER" "$ORPHAN" 2>/dev/null; rm -rf "$T"' EXIT
export KOSMOS_RUN_MARKER_DIR="$T/markers"; mkdir -p "$KOSMOS_RUN_MARKER_DIR"
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }
probe() { printf '#!/bin/sh\n%s\n' "$2" > "$T/$1"; chmod +x "$T/$1"; }
probe quiet 'exit 1'
probe live-cut "printf '$OTHER bash tools/release.sh 0.9.99\\n'"
probe live-bc "printf '$OTHER bash tools/browser-checks.sh\\n'"
probe live-suite "printf '$ORPHAN bash tools/run-tests.sh\\n'"
probe live-pw "printf '$OTHER /Users/x/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell\\n'"
probe broken 'exit 3'
probe load-low "echo '2.50 10'"
probe load-half "echo '5.00 10'"
probe load-bad "echo '? 10'"
export KOSMOS_CUT_PROBE="$T/quiet" KOSMOS_HARNESS_PROBE="$T/quiet" KOSMOS_BC_PROBE="$T/quiet" KOSMOS_SUITE_PROBE="$T/quiet" \
  KOSMOS_PW_PROBE="$T/quiet" KOSMOS_LOAD_PROBE="$T/load-low"
M="$KOSMOS_RUN_MARKER_DIR"
NOW="$(date +%s)"
# claim <age s> <label>: a heavy holder ($HOLDER, live) holding the machine claim for <age> seconds.
claim() { printf '%s-%s-1 %s %s host release %s\n' "$HOLDER" "$((NOW - $1))" "$HOLDER" "$((NOW + 1800))" "$2" > "$M/machine-claim"; }
# side: run the side check as a light run that holds a queue place; prints stderr, returns its rc.
side() { ( export KOSMOS_QUEUE_CLASS=light; kosmos_mark_suite_waiting "$((NOW - 10))"; kosmos_light_side_clear "this light run" ) 2>&1; }

claim 300 "(not a cut) queued one-off: a full suite"
out="$(side)"; rc=$?
[ "$rc" -eq 0 ] && pass "a light run takes a side turn beside a heavy holder on a half-idle box" \
  || fail "the side turn was refused on the clear case (rc=$rc, $out)"
out="$(KOSMOS_LOAD_PROBE="$T/load-half" side)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "the load is 5.00 on 10 cores"; } && pass "refused at half the cores (the line is strict)" \
  || fail "a side turn started at load 5 on 10 cores (rc=$rc, $out)"
out="$(KOSMOS_LOAD_PROBE="$T/load-bad" side)"; rc=$?
[ "$rc" -eq 1 ] && pass "refused when the load cannot be read" || fail "an unreadable load passed (rc=$rc, $out)"
out="$(KOSMOS_LOAD_PROBE="$T/load-half" KOSMOS_SIDE_MAX_LOAD=6 side)"; rc=$?
[ "$rc" -eq 0 ] && pass "KOSMOS_SIDE_MAX_LOAD moves the line" || fail "KOSMOS_SIDE_MAX_LOAD did not move the line (rc=$rc, $out)"
out="$(KOSMOS_SIDE_LANE=0 side)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "KOSMOS_SIDE_LANE=0"; } && pass "KOSMOS_SIDE_LANE=0 turns it off" || fail "KOSMOS_SIDE_LANE=0 did not turn it off (rc=$rc, $out)"
out="$( ( kosmos_mark_suite_waiting "$((NOW - 10))"; kosmos_light_side_clear "a heavy run" ) 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "not a light run"; } && pass "a heavy run never takes a side turn" || fail "a heavy run took a side turn (rc=$rc, $out)"
out="$( ( export KOSMOS_QUEUE_CLASS=light; kosmos_unmark_suite_waiting; kosmos_light_side_clear "an unqueued run" ) 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "no queue place"; } && pass "a run with no queue place takes no side turn" || fail "an unqueued run took a side turn (rc=$rc, $out)"

claim 300 "0.9.99"
out="$(side)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "held by a cut"; } && pass "never beside a cut's claim" || fail "a side turn beside a cut (rc=$rc, $out)"
claim 300 "(not a cut) queued one-off [light]: one check"
out="$(side)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "never two light runs"; } && pass "never beside a light main turn" || fail "two light runs at once (rc=$rc, $out)"
claim 30 "(not a cut) queued one-off: a build"
out="$(side)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "its load is not readable yet"; } && pass "not until the heavy run has held the box long enough for the load to show it" \
  || fail "a side turn beside a heavy run 30 s old (rc=$rc, $out)"
printf 'nonsense %s %s host release (not a cut) queued one-off: x\n' "$HOLDER" "$((NOW + 1800))" > "$M/machine-claim"
out="$(side)"; rc=$?
[ "$rc" -eq 1 ] && pass "a holder whose start cannot be read counts as just started" || fail "an unreadable claim start passed (rc=$rc, $out)"

rm -f "$M/machine-claim"
out="$(side)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "ordinary turn"; } && pass "an idle box is the main queue's turn, not a side turn" || fail "a side turn on an idle box (rc=$rc, $out)"
probe ancestor-none 'exit 0'
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_SUITE_PROBE="$T/live-suite" side)"; rc=$?
[ "$rc" -eq 0 ] && pass "a running suite with no claim is a heavy holder" || fail "refused beside a bare suite (rc=$rc, $out)"

claim 300 "(not a cut) queued one-off: a full suite"
# Each arm asserts its OWN reason: a refusal for another reason (this shell's own light marker reading as an earlier
# light waiter did, in the first draft) would pass every arm with the check under test deleted.
kosmos_unmark_suite_waiting
for arm in "KOSMOS_CUT_PROBE|live-cut|a cut is running|a cut" "KOSMOS_BC_PROBE|live-bc|tools/browser-checks.sh|another browser run" \
    "KOSMOS_PW_PROBE|live-pw|a Playwright browser is running|a Playwright browser" "KOSMOS_PW_PROBE|broken|could not tell whether a Playwright|an unreadable Playwright probe"; do
  IFS='|' read -r var p why name <<< "$arm"
  out="$(env "$var=$T/$p" bash -c '. "$1"; export KOSMOS_QUEUE_CLASS=light; kosmos_mark_suite_waiting "$2"; kosmos_light_side_clear "this light run"' _ "$HERE/lib/cut-guard.sh" "$((NOW - 10))" 2>&1)"; rc=$?
  { [ "$rc" -eq 1 ] && has "$out" "$why"; } && pass "refused beside $name" || fail "a side turn beside $name, or refused for another reason (rc=$rc, $out)"
done
out="$(bash -c '. "$1"; export KOSMOS_QUEUE_CLASS=light; kosmos_mark_suite_waiting "$2"; kosmos_light_side_clear "this light run"' _ "$HERE/lib/cut-guard.sh" "$((NOW - 10))" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "CONTROL: the same run with every probe quiet takes the side turn" || fail "CONTROL: the loop's run is refused with every probe quiet (rc=$rc, $out)"

# Order among light runs: an earlier light waiter goes first; an earlier HEAVY waiter does not stop a side turn.
printf '%s %s\n%s\n%s\n%s\nlight\n' "$((NOW - 100))" "$OTHER" "$(ps -ww -o command= -p "$OTHER")" "$(_kosmos_pid_started_local "$OTHER")" "$(_kosmos_pid_started "$OTHER")" > "$M/suitewait.$OTHER"
out="$(side)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "earlier light run (pid $OTHER)"; } && pass "an earlier light waiter takes the side turn first" || fail "a later light run jumped an earlier one (rc=$rc, $out)"
sed -i '' '5s/light/heavy/' "$M/suitewait.$OTHER" 2>/dev/null || sed -i '5s/light/heavy/' "$M/suitewait.$OTHER"
out="$(side)"; rc=$?
[ "$rc" -eq 0 ] && pass "CONTROL: the same waiter as heavy does not hold the side turn" || fail "a heavy waiter held the side turn (rc=$rc, $out)"
rm -f "$M/suitewait.$OTHER"

# The side claim: one holder; a foreign one refuses; release never removes a foreign claim; a dead holder is cleaned.
bash -c '. "$1"; kosmos_claim_light_side 5 && exec sleep 30' _ "$HERE/lib/cut-guard.sh" </dev/null >/dev/null 2>&1 & sp=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$M/light-side-claim" ] && break; sleep 0.2; done
out="$(side)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "side turn beside the heavy one"; } && pass "a live side claim refuses a second side turn" || fail "two side turns at once (rc=$rc, $out)"
out="$(kosmos_refuse_if_light_side_live "a page layer" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && pass "a foreign side claim is seen by kosmos_refuse_if_light_side_live" || fail "the side guard missed a live side claim (rc=$rc)"
( unset KOSMOS_LIGHT_SIDE_COOKIE; kosmos_claim_light_side 5 ); rc=$?
[ "$rc" -eq 1 ] && pass "a second claim does not overwrite a live one" || fail "a second side claim overwrote the first (rc=$rc)"
( export KOSMOS_LIGHT_SIDE_COOKIE=not-the-holder; kosmos_release_light_side ); [ -s "$M/light-side-claim" ] \
  && pass "release never removes a foreign side claim" || fail "a foreign release removed the side claim"
own="$(awk '{print $1}' "$M/light-side-claim")"
out="$(KOSMOS_LIGHT_SIDE_COOKIE="$own" kosmos_refuse_if_light_side_live "the side run's own page layer" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "the side run's own children are not foreign to it" || fail "a side run refused itself (rc=$rc, $out)"
kill "$sp" 2>/dev/null; for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$sp" 2>/dev/null || break; sleep 0.2; done
out="$(kosmos_refuse_if_light_side_live "a page layer" 2>&1)"; rc=$?
{ [ "$rc" -eq 0 ] && [ ! -e "$M/light-side-claim" ]; } && pass "a dead holder's side claim is cleaned" || fail "a dead holder's side claim still refuses (rc=$rc)"
( kosmos_claim_light_side 5 && kosmos_release_light_side ); [ ! -e "$M/light-side-claim" ] \
  && pass "the holder's release removes its own claim" || fail "the holder's own release left its claim"

# kosmos_wait_until_clear --side: a light run whose main check never clears takes the side turn once it is queued, and
# leaves its marker for the caller. CONTROL: without --side the same run waits out its bound.
kosmos_unmark_suite_waiting   # the side() arms above left this shell's marker; start the waits from none
nope() { echo "the box is held" >&2; return 1; }
sidecalls=0
sideok() { sidecalls=$((sidecalls + 1)); return 0; }
KOSMOS_WAIT_SLEEP=: KOSMOS_WAIT_MAX_S=60 kosmos_wait_until_clear "this light run" --suite-queue --side sideok nope 2> "$T/w1"; rc=$?
{ [ "$rc" -eq 0 ] && [ "$KOSMOS_WAIT_LANE" = side ] && [ "$sidecalls" -eq 1 ] && [ -e "$M/suitewait.$$" ] && has "$(cat "$T/w1")" "a side turn is free"; } \
  && pass "--side gives a queued run its side turn and leaves its marker for the take" \
  || fail "--side did not give the side turn (rc=$rc, lane=$KOSMOS_WAIT_LANE, calls=$sidecalls, marker=$(ls "$M"), $(cat "$T/w1"))"
kosmos_unmark_suite_waiting
KOSMOS_WAIT_SLEEP=: KOSMOS_WAIT_MAX_S=60 kosmos_wait_until_clear "this light run" --suite-queue nope 2> "$T/w2"; rc=$?
{ [ "$rc" -eq 1 ] && [ "$KOSMOS_WAIT_LANE" = main ] && [ ! -e "$M/suitewait.$$" ]; } && pass "CONTROL: without --side the run waits out its bound" \
  || fail "CONTROL: the run went without a side check (rc=$rc, lane=$KOSMOS_WAIT_LANE)"
# A run that still holds a live marker (a side take that lost) resumes that place on its next wait.
kosmos_mark_suite_waiting "$((NOW - 777))"
KOSMOS_WAIT_SLEEP=: KOSMOS_WAIT_MAX_S=60 kosmos_wait_until_clear "this light run" --suite-queue --side sideok nope 2>/dev/null; rc=$?
got="$(cut -d' ' -f1 "$M/suitewait.$$" 2>/dev/null | head -1)"
{ [ "$rc" -eq 0 ] && [ "$KOSMOS_WAIT_LANE" = side ] && [ "$got" = "$((NOW - 777))" ]; } && pass "a run whose side take lost keeps its old queue place" \
  || fail "a run that kept its marker joined at the back (rc=$rc, place=$got, wanted $((NOW - 777)))"
kosmos_unmark_suite_waiting
yes_() { return 0; }
KOSMOS_WAIT_SLEEP=: kosmos_wait_until_clear "this run" --suite-queue --side nope yes_ 2>/dev/null; rc=$?
{ [ "$rc" -eq 0 ] && [ "$KOSMOS_WAIT_LANE" = main ] && [ ! -e "$M/suitewait.$$" ]; } && pass "a clear box is an ordinary main turn even with --side" \
  || fail "a clear box did not give a main turn (rc=$rc, lane=$KOSMOS_WAIT_LANE)"

# Aging: a light waiter past the starve line is rank 0 like a heavy one, so an OLDER starving light waiter goes ahead of
# a starving heavy one (before #4911 the heavy one went first, and the light lane stood still all afternoon).
printf '%s %s\n%s\n%s\n%s\nlight\n' "$((NOW - 3500))" "$OTHER" "$(ps -ww -o command= -p "$OTHER")" "$(_kosmos_pid_started_local "$OTHER")" "$(_kosmos_pid_started "$OTHER")" > "$M/suitewait.$OTHER"
kosmos_mark_suite_waiting "$((NOW - 3000))"
out="$(kosmos_refuse_if_earlier_suite_waiter "a starving heavy run" 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "pid $OTHER"; } && pass "an older starving light waiter goes ahead of a starving heavy one" \
  || fail "a starving light waiter stayed behind a younger starving heavy one (rc=$rc, $out)"
kosmos_mark_suite_waiting "$((NOW - 4000))"
out="$(kosmos_refuse_if_earlier_suite_waiter "an older starving heavy run" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "CONTROL: an older starving heavy waiter still goes first (queue time orders rank 0)" \
  || fail "CONTROL: an older starving heavy waiter was held (rc=$rc, $out)"
kosmos_unmark_suite_waiting; rm -f "$M/suitewait.$OTHER"

# browser-checks.sh's guard block, run as the script's own text (extracted from it, so an edit to the script is what
# runs here) but WITHOUT the rest of the script: a first draft ran the whole script, and a perturbation that removed
# the side wait let a real page layer start. The block runs in a bash with the lib loaded and KOSMOS_NO_WAIT=1.
# A live FOREIGN side turn makes it wait (here: refuse naming the side turn), not refuse as a second browser run.
# CONTROL: with no side turn and another browser run live it refuses at once, as before #4911.
awk '/^if \[ "\$\{KOSMOS_HARNESS_IGNORE_CUT:-0\}" != 1 \] && \[ -z "\$\{KOSMOS_BC_FROZEN_RUNNER/ {on=1} on {print} on && /^fi$/ {exit}' \
  "$HERE/browser-checks.sh" > "$T/bc-guard.sh"
if ! grep -q 'kosmos_refuse_if_browser_run_live' "$T/bc-guard.sh" || ! grep -q '^fi$' "$T/bc-guard.sh"; then
  fail "could not find browser-checks.sh's guard block (did its first line change?)"
else
  bcguard() { bash -c '. "$1"; unset KOSMOS_LIGHT_SIDE_COOKIE KOSMOS_BC_FROZEN_RUNNER KOSMOS_HARNESS_IGNORE_CUT; . "$2"; echo GUARD-PASSED' _ "$HERE/lib/cut-guard.sh" "$T/bc-guard.sh" 2>&1; }
  bash -c '. "$1"; kosmos_claim_light_side 5 && exec sleep 30' _ "$HERE/lib/cut-guard.sh" </dev/null >/dev/null 2>&1 & sp=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$M/light-side-claim" ] && break; sleep 0.2; done
  out="$(KOSMOS_NO_WAIT=1 KOSMOS_BC_PROBE="$T/quiet" bcguard)"; rc=$?
  { [ "$rc" -eq 1 ] && has "$out" "has a side turn beside the heavy one" && has "$out" "this page layer" && ! has "$out" GUARD-PASSED; } \
    && pass "browser-checks.sh's guard waits on a live side turn instead of running beside it" \
    || fail "browser-checks.sh's guard did not wait on a side turn (rc=$rc, $(printf '%s' "$out" | tail -3))"
  kill "$sp" 2>/dev/null; for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$sp" 2>/dev/null || break; sleep 0.2; done
  rm -f "$M/light-side-claim"
  out="$(KOSMOS_NO_WAIT=1 KOSMOS_BC_PROBE="$T/live-bc" bcguard)"; rc=$?
  { [ "$rc" -eq 1 ] && ! has "$out" "side turn" && ! has "$out" "waiting for it" && ! has "$out" GUARD-PASSED; } \
    && pass "CONTROL: with no side turn, the guard refuses beside another browser run at once, as before" \
    || fail "CONTROL: the guard changed its refusal with no side turn (rc=$rc, $(printf '%s' "$out" | tail -3))"
  out="$(KOSMOS_NO_WAIT=1 KOSMOS_BC_PROBE="$T/quiet" bcguard)"; rc=$?
  { [ "$rc" -eq 0 ] && has "$out" GUARD-PASSED; } && pass "CONTROL: with nothing live the guard block passes" \
    || fail "CONTROL: the extracted guard refused on a clear box (rc=$rc, $out)"
fi

echo "light side turn: $fails failures"; [ "$fails" -eq 0 ]
