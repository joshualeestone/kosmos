#!/bin/bash
# needs-you-source.js, arm by arm, against fixture records.
#
# 🛑 THE ARM THAT MATTERS IS ARM 3: the tool must be able to print the
# UNCOMFORTABLE conclusion. A measurement whose instrument can only ever return
# "load-bearing on the scrape" is not evidence for that sentence, it is a
# decoration on it -- and this repo has spent a week finding checks that could
# not return the dangerous answer. If arm 3 ever stops passing, every other
# number this tool prints stops counting.
#
# Fixtures are driven through --dir, so nothing here reads or writes the live
# record.
set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
run() { node tools/needs-you-source.js --dir "$1" 2>&1; }

line() { printf '{"v":1,"state":"%s","because":"%s","at":"2026-08-28T00:00:00.000Z"}\n' "$1" "$2"; }
filler() { local n="$1" i=0; while [ "$i" -lt "$n" ]; do line working "doing a thing"; i=$((i+1)); done; }

# --- ARM 1: every red written by the hook -> "no self-reported source at all"
mkdir -p "$T/hookonly"
{ filler 100; line needs_you "asking permission to use Bash: ls"; } > "$T/hookonly/alice.jsonl"
out="$(run "$T/hookonly")"
case "$out" in
  *"No agent has EVER typed needs_you"*) ok "arm 1: hook-written reds are not counted as agent-typed" ;;
  *) bad "arm 1: a hook-only record did not read as zero agent-typed"; printf '%s\n' "$out" | tail -5 ;;
esac
case "$out" in
  *"      1  written by the permission hook"*) ok "arm 1: the hook line is counted, not merely excluded" ;;
  *) bad "arm 1: the hook count is wrong"; printf '%s\n' "$out" | grep 'permission hook' ;;
esac

# --- ARM 2: a rare agent-typed red -> the load-bearing conclusion
mkdir -p "$T/rare"
{ filler 2000; line needs_you "May I merge the PR?"; } > "$T/rare/bob.jsonl"
out="$(run "$T/rare")"
case "$out" in
  *"load-bearing on the PANE READER"*) ok "arm 2: a rate under the cutoff reads as load-bearing on the scrape" ;;
  *) bad "arm 2: the low-rate conclusion did not print"; printf '%s\n' "$out" | tail -5 ;;
esac

# --- 🔑 ARM 3, THE ONE THAT MAKES THE OTHERS EVIDENCE: agents using the verb
#     must produce the OPPOSITE conclusion. Same shape as arm 2, ten reds in a
#     hundred records instead of one in two thousand.
mkdir -p "$T/used"
{ filler 90; i=0; while [ "$i" -lt 10 ]; do line needs_you "which of these two should I build?"; i=$((i+1)); done; } > "$T/used/carol.jsonl"
out="$(run "$T/used")"
case "$out" in
  *"agents ARE reporting this state themselves"*) ok "arm 3: the tool CAN say the sentence in status.js no longer holds" ;;
  *) bad "arm 3: the tool cannot produce the uncomfortable answer -- its other outputs are worthless"; printf '%s\n' "$out" | tail -6 ;;
esac
case "$out" in
  *"load-bearing on the PANE READER"*) bad "arm 3: it printed BOTH conclusions" ;;
  *) ok "arm 3: it does not also print the conclusion it just contradicted" ;;
esac

# --- ARM 4: the impossible-state control must be able to move.
#     A control that reads 0 because it cannot read anything is not a control.
mkdir -p "$T/planted"
{ filler 10; line zzz_no_such_state "planted"; } > "$T/planted/dave.jsonl"
out="$(run "$T/planted")"
case "$out" in
  *"      1  a state no writer can produce"*) ok "arm 4: the impossible-state control reads non-zero when one is planted" ;;
  *) bad "arm 4: the control cannot detect a planted impossible state, so its 0 on live data means nothing"; printf '%s\n' "$out" | grep 'no writer' ;;
esac
out="$(run "$T/rare")"
case "$out" in
  *"      0  a state no writer can produce"*) ok "arm 4: and reads zero on a clean record" ;;
  *) bad "arm 4: the control is non-zero on a clean fixture"; printf '%s\n' "$out" | grep 'no writer' ;;
esac

# --- ARM 5: a missing record is refused, not reported as an answer.
#     "no reds found" and "no record found" are the same number and opposite
#     facts; only the first is evidence.
out="$(run "$T/does-not-exist")"; rc=$?
case "$out" in
  *"not an answer"*) ok "arm 5: a missing record refuses to be read as a finding" ;;
  *) bad "arm 5: a missing record produced a conclusion"; printf '%s\n' "$out" ;;
esac
[ "$rc" -ne 0 ] && ok "arm 5: and exits non-zero" || bad "arm 5: a missing record exited 0"

# --- ARM 6: unparseable lines are counted, never silently dropped.
mkdir -p "$T/junk"
{ filler 5; echo '{not json'; } > "$T/junk/erin.jsonl"
out="$(run "$T/junk")"
case "$out" in
  *"unparseable      1"*) ok "arm 6: a corrupt line is surfaced rather than skipped into the totals" ;;
  *) bad "arm 6: unparseable count wrong"; printf '%s\n' "$out" | grep unparseable ;;
esac

echo
if [ "$FAILS" -eq 0 ]; then echo "all arms pass"; else echo "$FAILS arm(s) failed"; fi
exit "$FAILS"
