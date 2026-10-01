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
side() { ( export KOSMOS_QUEUE_CLASS=light KOSMOS_SIDE_CAPABLE=1; kosmos_mark_suite_waiting "$((NOW - 10))"; kosmos_light_side_clear "this light run" ) 2>&1; }

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
{ [ "$rc" -eq 1 ] && has "$out" "its load is not readable yet"; } && pass "a holder whose start cannot be read counts as just started" \
  || fail "an unreadable claim start passed, or refused for another reason (rc=$rc, $out)"

rm -f "$M/machine-claim"
out="$(side)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "ordinary turn"; } && pass "an idle box is the main queue's turn, not a side turn" || fail "a side turn on an idle box (rc=$rc, $out)"
probe ancestor-none 'exit 0'
out="$(KOSMOS_PROCESS_ANCESTOR_PROBE="$T/ancestor-none" KOSMOS_SUITE_PROBE="$T/live-suite" side)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "no queued heavy run holds the box"; } && pass "a bare suite with no claim is not a holder a side turn may join (its age is unreadable)" \
  || fail "a side turn beside an unclaimed suite (rc=$rc, $out)"

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
printf '%s %s\n%s\n%s\n%s\nlight\nside\n' "$((NOW - 100))" "$OTHER" "$(ps -ww -o command= -p "$OTHER")" "$(_kosmos_pid_started_local "$OTHER")" "$(_kosmos_pid_started "$OTHER")" > "$M/suitewait.$OTHER"
out="$(side)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "earlier light run (pid $OTHER)"; } && pass "an earlier light waiter takes the side turn first" || fail "a later light run jumped an earlier one (rc=$rc, $out)"
sed -i '' '6d' "$M/suitewait.$OTHER" 2>/dev/null || sed -i '6d' "$M/suitewait.$OTHER"
out="$(side)"; rc=$?
[ "$rc" -eq 0 ] && pass "an earlier light waiter that never asks for side turns (no line 6) does not hold the side lane" \
  || fail "a waiter that will never take a side turn held the lane (rc=$rc, $out)"
printf 'side\n' >> "$M/suitewait.$OTHER"
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
# The side check runs in a command substitution (its reason is kept), so it counts its calls in a file.
rm -f "$T/sidecalls"
sideok() { echo x >> "$T/sidecalls"; return 0; }
KOSMOS_WAIT_SLEEP=: KOSMOS_WAIT_MAX_S=60 kosmos_wait_until_clear "this light run" --suite-queue --side sideok nope 2> "$T/w1"; rc=$?
{ [ "$rc" -eq 0 ] && [ "$KOSMOS_WAIT_LANE" = side ] && [ "$(grep -c . "$T/sidecalls" 2>/dev/null)" = 1 ] && [ -e "$M/suitewait.$$" ] && has "$(cat "$T/w1")" "a side turn is free"; } \
  && pass "--side gives a queued run its side turn and leaves its marker for the take" \
  || fail "--side did not give the side turn (rc=$rc, lane=$KOSMOS_WAIT_LANE, calls=$(grep -c . "$T/sidecalls" 2>/dev/null), markers=$(ls "$M" | tr '\n' ' '), $(cat "$T/w1"))"
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
KOSMOS_WAIT_SLEEP=: kosmos_wait_until_clear "this light run" --suite-queue --side sideok 2>"$T/w3"; rc=$?
{ [ "$rc" -eq 1 ] && has "$(cat "$T/w3")" "--side needs a side check and then the check"; } && pass "--side with nothing after it is refused, not run as the check" \
  || fail "--side with no check after it was not refused (rc=$rc, $(cat "$T/w3"))"
yes_() { return 0; }
KOSMOS_WAIT_SLEEP=: kosmos_wait_until_clear "this run" --suite-queue --side nope yes_ 2>/dev/null; rc=$?
{ [ "$rc" -eq 0 ] && [ "$KOSMOS_WAIT_LANE" = main ] && [ ! -e "$M/suitewait.$$" ]; } && pass "a clear box is an ordinary main turn even with --side" \
  || fail "a clear box did not give a main turn (rc=$rc, lane=$KOSMOS_WAIT_LANE)"

# Review 3: a queued-heavy.sh from before #4911 waiting (its marker names queued-heavy and has no side/aware line)
# holds every side turn off; one that is side-aware does not.
claim 300 "(not a cut) queued one-off: a full suite"
# A live stand-in whose command names queued-heavy.sh (a marker whose command is not its process's is stale and removed).
printf '#!/bin/bash\ntrap '"'"'kill $c; exit 0'"'"' TERM\nsleep 600 & c=$!\nwait $c\n' > "$T/queued-heavy.sh"; chmod +x "$T/queued-heavy.sh"
"$T/queued-heavy.sh" </dev/null >/dev/null 2>&1 & QH=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do case "$(ps -ww -o command= -p "$QH")" in *queued-heavy*) break ;; esac; sleep 0.1; done
printf '%s %s\n%s\n%s\n%s\nheavy\n' "$((NOW - 50))" "$QH" "$(ps -ww -o command= -p "$QH")" "$(_kosmos_pid_started_local "$QH")" "$(_kosmos_pid_started "$QH")" > "$M/suitewait.$QH"
out="$(side)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "older than #4911"; } && pass "an older queued-heavy.sh waiting holds side turns off" || fail "a side turn while an old queued-heavy waits (rc=$rc, $out)"
printf 'aware\n' >> "$M/suitewait.$QH"
out="$(side)"; rc=$?
[ "$rc" -eq 0 ] && pass "CONTROL: a side-aware heavy waiter does not" || fail "CONTROL: an aware waiter held side turns off (rc=$rc, $out)"
kill "$QH" 2>/dev/null; wait "$QH" 2>/dev/null; rm -f "$M/suitewait.$QH"; kosmos_unmark_suite_waiting

# kosmos_light_side_take: the take a caller makes under its lock. A win claims and drops the queue marker; a loss
# (another side turn is live) keeps both as they were. kosmos_holds_light_side says the winner holds it.
claim 300 "(not a cut) queued one-off: a full suite"
out="$( ( export KOSMOS_QUEUE_CLASS=light KOSMOS_SIDE_CAPABLE=1; kosmos_mark_suite_waiting "$((NOW - 10))"
  kosmos_light_side_take "a light run" 5 || exit 9; [ -e "$M/suitewait.$$" ] && exit 8; kosmos_holds_light_side || exit 7
  kosmos_release_light_side; kosmos_holds_light_side && exit 6; exit 0 ) 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "a won side take claims, drops its marker, holds the turn, and releases it" || fail "the side take misbehaved (step rc=$rc, $out)"
# Review 3: the take claims FIRST and then asks again, so a cut that marked itself in the gap is seen (here the cut
# probe reads live only once the side claim exists). The claim is released and the marker kept.
probe cut-after-claim "[ -e '$M/light-side-claim' ] && printf '$OTHER bash tools/release.sh 0.9.99\\n' || exit 1"
out="$( ( export KOSMOS_QUEUE_CLASS=light KOSMOS_SIDE_CAPABLE=1 KOSMOS_CUT_PROBE="$T/cut-after-claim"; kosmos_mark_suite_waiting "$((NOW - 10))"
  kosmos_light_side_take "a light run" 5 && exit 9; [ -e "$M/light-side-claim" ] && exit 8; [ -e "$M/suitewait.$$" ] || exit 7; exit 0 ) 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "a cut that marks between the side check and the claim is seen, and the side claim is given back" \
  || fail "the take kept a side turn beside a cut that started in the gap (step rc=$rc, $out)"
kosmos_unmark_suite_waiting
# The take asks the side check again under the lock: the box changed after the wait asked (here, the load rose).
out="$( ( export KOSMOS_QUEUE_CLASS=light KOSMOS_SIDE_CAPABLE=1 KOSMOS_LOAD_PROBE="$T/load-half"; kosmos_mark_suite_waiting "$((NOW - 10))"
  kosmos_light_side_take "a light run" 5 && exit 9; [ -e "$M/light-side-claim" ] && exit 8; [ -e "$M/suitewait.$$" ] || exit 7; exit 0 ) 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "the take asks the side check again and takes nothing when the box changed" || fail "the take did not re-check (step rc=$rc, $out)"
bash -c '. "$1"; kosmos_claim_light_side 5 && exec sleep 30' _ "$HERE/lib/cut-guard.sh" </dev/null >/dev/null 2>&1 & sp=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$M/light-side-claim" ] && break; sleep 0.2; done
out="$( ( export KOSMOS_QUEUE_CLASS=light KOSMOS_SIDE_CAPABLE=1; kosmos_mark_suite_waiting "$((NOW - 10))"
  kosmos_light_side_take "a light run" 5 && exit 9; [ -e "$M/suitewait.$$" ] || exit 8; kosmos_holds_light_side && exit 7; exit 0 ) 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "a lost side take keeps its queue marker and holds nothing" || fail "a lost side take misbehaved (step rc=$rc, $out)"
kosmos_unmark_suite_waiting
# run-tests.sh's #4911 block, run as its own text (extracted, so a mutant cannot start a real suite): inside a side turn
# it refuses at once; outside one it passes.
awk '/^# #4911: inside a light run.s SIDE turn/ {on=1} on {print} on && /^fi$/ {exit}' "$HERE/run-tests.sh" > "$T/rt-side.sh"
if ! grep -q 'kosmos_holds_light_side' "$T/rt-side.sh" || ! grep -q '^fi$' "$T/rt-side.sh"; then
  fail "could not find run-tests.sh's side-turn block (did its first line change?)"
else
  own="$(awk '{print $1}' "$M/light-side-claim")"
  out="$(KOSMOS_LIGHT_SIDE_COOKIE="$own" bash -c '. "$1"; . "$2"; echo BLOCK-PASSED' _ "$HERE/lib/cut-guard.sh" "$T/rt-side.sh" 2>&1)"; rc=$?
  { [ "$rc" -eq 2 ] && has "$out" "inside a light run's side turn" && ! has "$out" BLOCK-PASSED; } && pass "run-tests.sh refuses inside a side turn instead of queueing behind the holder" \
    || fail "run-tests.sh did not refuse inside a side turn (rc=$rc, $out)"
  out="$(bash -c 'unset KOSMOS_LIGHT_SIDE_COOKIE; . "$1"; . "$2"; echo BLOCK-PASSED' _ "$HERE/lib/cut-guard.sh" "$T/rt-side.sh" 2>&1)"; rc=$?
  { [ "$rc" -eq 0 ] && has "$out" BLOCK-PASSED; } && pass "CONTROL: outside a side turn run-tests.sh's block passes" || fail "CONTROL: the block refused outside a side turn (rc=$rc, $out)"
fi
kill "$sp" 2>/dev/null; wait "$sp" 2>/dev/null; rm -f "$M/light-side-claim"

# Aging: a light waiter past the starve line is rank 0 like a heavy one, so an OLDER starving light waiter goes ahead of
# a starving heavy one (before #4911 the heavy one went first, and the light lane stood still all afternoon).
printf '%s %s\n%s\n%s\n%s\nlight\n\n' "$((NOW - 3500))" "$OTHER" "$(ps -ww -o command= -p "$OTHER")" "$(_kosmos_pid_started_local "$OTHER")" "$(_kosmos_pid_started "$OTHER")" > "$M/suitewait.$OTHER"
kosmos_mark_suite_waiting "$((NOW - 3000))"
out="$(kosmos_refuse_if_earlier_suite_waiter "a starving heavy run" 2>&1)"; rc=$?
{ [ "$rc" -eq 1 ] && has "$out" "pid $OTHER"; } && pass "an older starving light waiter goes ahead of a starving heavy one" \
  || fail "a starving light waiter stayed behind a younger starving heavy one (rc=$rc, $out)"
kosmos_mark_suite_waiting "$((NOW - 4000))"
out="$(kosmos_refuse_if_earlier_suite_waiter "an older starving heavy run" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "CONTROL: an older starving heavy waiter still goes first (queue time orders rank 0)" \
  || fail "CONTROL: an older starving heavy waiter was held (rc=$rc, $out)"
# Review 3: the same starving light waiter in an OLDER lib's marker (5 lines) is compared by the older rule on both
# sides, so this run reads the order that waiter reads (it puts the starving heavy first), and the two never each wait
# for the other.
sed -i '' '6d' "$M/suitewait.$OTHER" 2>/dev/null || sed -i '6d' "$M/suitewait.$OTHER"
kosmos_mark_suite_waiting "$((NOW - 3000))"
out="$(kosmos_refuse_if_earlier_suite_waiter "a starving heavy run" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "against an older lib's starving light waiter, a starving heavy run goes first, as that lib reads it" \
  || fail "a new-lib heavy waiter waited on an old-lib light one that waits on it (rc=$rc, $out)"
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
    && pass "browser-checks.sh's guard does not run beside a live side turn" \
    || fail "browser-checks.sh's guard ran beside a side turn (rc=$rc, $(printf '%s' "$out" | tail -3))"
  # Review 3: under KOSMOS_NO_WAIT a wait and a refusal look the same, so prove the WAIT: the sleep seam ends the side
  # turn on its first call, and the guard must then go on and pass (a plain refusal exits 1 instead).
  printf '#!/bin/sh\nrm -f "%s/light-side-claim"\n' "$M" > "$T/side-ends"; chmod +x "$T/side-ends"
  bash -c '. "$1"; kosmos_claim_light_side 5 && exec sleep 30' _ "$HERE/lib/cut-guard.sh" </dev/null >/dev/null 2>&1 & sp2=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$M/light-side-claim" ] && break; sleep 0.2; done
  out="$(KOSMOS_WAIT_SLEEP="$T/side-ends" KOSMOS_BC_PROBE="$T/quiet" bcguard)"; rc=$?
  { [ "$rc" -eq 0 ] && has "$out" GUARD-PASSED; } && pass "browser-checks.sh's guard WAITS for the side turn and runs once it ends (it does not refuse)" \
    || fail "browser-checks.sh's guard refused rather than waiting out a side turn (rc=$rc, $(printf '%s' "$out" | tail -3))"
  kill "$sp2" 2>/dev/null; wait "$sp2" 2>/dev/null; rm -f "$M/light-side-claim"
  # Review 4: a page layer that arrives while another browser run is live refuses AT ONCE, side turn or not (it never
  # waits, so it cannot meet the first one when the side turn ends). The seam records whether the guard waited.
  printf '#!/bin/sh\ntouch "%s/waited"\nrm -f "%s/light-side-claim"\n' "$T" "$M" > "$T/side-ends-rec"; chmod +x "$T/side-ends-rec"
  bash -c '. "$1"; kosmos_claim_light_side 5 && exec sleep 30' _ "$HERE/lib/cut-guard.sh" </dev/null >/dev/null 2>&1 & sp2=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$M/light-side-claim" ] && break; sleep 0.2; done
  rm -f "$T/waited"
  out="$(KOSMOS_WAIT_SLEEP="$T/side-ends-rec" KOSMOS_BC_PROBE="$T/live-bc" bcguard)"; rc=$?
  { [ "$rc" -eq 1 ] && [ ! -e "$T/waited" ] && ! has "$out" GUARD-PASSED; } && pass "a page layer that meets another browser run refuses at once, even during a side turn" \
    || fail "a page layer waited out the side turn beside another browser run (rc=$rc, waited=$([ -e "$T/waited" ] && echo yes || echo no))"
  kill "$sp2" 2>/dev/null; wait "$sp2" 2>/dev/null; rm -f "$M/light-side-claim"
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

# Review 4: three starving waiters, two of this lib (A light, C heavy) and one of the OLDER lib (B heavy), queue times
# A, C, B. Comparing per pair, A named B ahead, B named C and C named A: a circle, so all three (and everyone behind)
# waited on an idle box until the bound. Each is a live process using its OWN lib; exactly one must see nobody ahead.
# Each stays the same process (no exec) until all three have read: a waiter whose command changes reads as stale.
git -C "$HERE/.." show 'origin/main:tools/lib/cut-guard.sh' > "$T/old-lib.sh" 2>/dev/null
if ! grep -q '_kosmos_queue_rank' "$T/old-lib.sh" || grep -q '_kosmos_queue_rank_legacy' "$T/old-lib.sh"; then
  echo "SKIP  the three-waiter arm: origin/main's lib is not the pre-#4911 one (merged?), so there is no older lib to pair with"
else
  M3="$T/m3"; mkdir -p "$M3"; rm -f "$T"/go3 "$T"/stop3 "$T"/ahead.*
  waiter() { # <name> <lib> <class> <queue time>
    KOSMOS_RUN_MARKER_DIR="$M3" KOSMOS_QUEUE_CLASS="$3" bash -c '. "$1"; kosmos_mark_suite_waiting "$2"
      until [ -e "$3/go3" ]; do sleep 0.1; done
      _kosmos_suite_waiters_ahead > "$3/ahead.$4"; echo done >> "$3/ahead.$4.ok"
      until [ -e "$3/stop3" ]; do sleep 0.1; done' _ "$2" "$4" "$T" "$1" </dev/null >/dev/null 2>&1 &
    eval "W_$1=\$!"
  }
  waiter A "$HERE/lib/cut-guard.sh" light $((NOW - 4000))
  waiter C "$HERE/lib/cut-guard.sh" heavy $((NOW - 3900))
  waiter B "$T/old-lib.sh" heavy $((NOW - 3800))
  for _ in $(seq 1 50); do [ "$(ls "$M3" | grep -c '^suitewait\.[0-9]*$')" = 3 ] && break; sleep 0.1; done
  touch "$T/go3"
  for _ in $(seq 1 100); do [ -e "$T/ahead.A.ok" ] && [ -e "$T/ahead.B.ok" ] && [ -e "$T/ahead.C.ok" ] && break; sleep 0.1; done
  free=0; for w in A B C; do [ -s "$T/ahead.$w" ] || free=$((free + 1)); done
  { [ -e "$T/ahead.A.ok" ] && [ "$free" -eq 1 ]; } && pass "three starving waiters of mixed libs: exactly one sees nobody ahead (no circle)" \
    || fail "three waiters of mixed libs: $free see nobody ahead (A: $(tr '\n' ' ' < "$T/ahead.A" 2>/dev/null), B: $(tr '\n' ' ' < "$T/ahead.B" 2>/dev/null), C: $(tr '\n' ' ' < "$T/ahead.C" 2>/dev/null); pids A=$W_A B=$W_B C=$W_C)"
  touch "$T/stop3"; wait "$W_A" "$W_B" "$W_C" 2>/dev/null
fi

echo "light side turn: $fails failures"; [ "$fails" -eq 0 ]
