#!/bin/bash
# kosmos#3036 -- explicit --help on the SEND-guarded message verbs must exit 0
# (it printed usage successfully), not 2 (the missing-required-argument error a
# bare verb returns). A script doing `kosmos msg --help && echo ok` read a
# working help screen as a failure.
#
# The #1674 routing is deliberate and MUST be kept: --help/-h on these verbs is
# re-dispatched to print usage instead of running, so `kosmos reply --help`
# cannot transmit "--help" as a message. This test proves the exit code is now
# 0 while:
#   - a GENUINE bare `kosmos <verb>` (no --help) still exits 2 (the fix did not
#     swallow the real missing-arg error), and
#   - the #1674 no-SEND guarantee still holds (help mid-args prints usage, does
#     not answer/send).
#
# The behavioural arms run the REAL install/kosmos, so a revert of the fix reds
# them (the verb would exit 2 again). adopt|whoami are deliberately EXCLUDED
# from the exit-0 rule (they show read-only output and their status is
# meaningful), which the source guard at the end pins.
set -u
cd "$(dirname "$0")/.." || exit 1
K="install/kosmos"
# Pin a DEAD port on every arm, matching cli.help-flag-1674.test.js. Port 9 (discard) is not
# listening, so healthy() fails and no arm can reach a real board. Under the correct code the
# --help interception prevents any send regardless, but if it ever regresses this stops the
# test itself from transmitting a real message (the #1674 near-miss the sibling test records:
# "--help" sent into a live conversation twice while the card was being investigated).
export KOSMOS_PORT=9
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

MSG_VERBS="msg post reply react report room feedback task"

# --- the fix: each message verb's --help exits 0 AND printed usage -----------
for v in $MSG_VERBS; do
  out="$(bash "$K" "$v" --help 2>&1)"; rc=$?
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -qi 'usage'; then
    ok "kosmos $v --help exits 0 and prints usage"
  else
    bad "kosmos $v --help: expected exit 0 with usage, got exit $rc (out: $(printf '%s' "$out" | head -1))"
  fi
done

# --- control: a GENUINE bare verb (no --help) must STILL exit 2 --------------
# This is the dangerous-answer control: if the fix over-reached and forced exit
# 0 on the bare missing-arg path too, this reds. It proves the fix is scoped to
# the --help request, not the usage branch itself.
for v in $MSG_VERBS; do
  bash "$K" "$v" </dev/null >/dev/null 2>&1; rc=$?
  [ "$rc" -eq 2 ] \
    && ok "control: bare kosmos $v (real missing-arg) still exits 2" \
    || bad "control: bare kosmos $v should exit 2 (real usage error), got $rc"
done

# --- control: top-level kosmos --help unchanged (already exit 0) -------------
bash "$K" --help >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] \
  && ok "control: top-level kosmos --help still exits 0" \
  || bad "top-level kosmos --help should exit 0, got $rc"

# --- #1674 no-SEND guarantee preserved: help mid-args prints usage, no send --
# `kosmos msg <agent> --help` must re-dispatch to usage (bare), never answer.
out="$(bash "$K" msg someagent --help 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -qi 'usage' && ! printf '%s' "$out" | grep -qi 'Answered'; then
  ok "#1674 preserved: kosmos msg <agent> --help prints usage (exit 0) and does not send"
else
  bad "#1674 guard: msg <agent> --help should print usage, exit 0, and not answer (exit $rc; out: $(printf '%s' "$out" | head -1))"
fi

# --- source guard: adopt|whoami are NOT forced to exit 0 ---------------------
# They show read-only output on --help; their own status must stand. Pin that
# they are a SEPARATE case from the message verbs (which get `exit 0`), so a
# future edit cannot fold them into the exit-0 rule unnoticed.
if grep -Eq '^[[:space:]]*msg\|reply\|post\|react\|report\|room\|feedback\|task\)' "$K" \
   && grep -Eq '^[[:space:]]*adopt\|whoami\)' "$K"; then
  ok "source: message verbs and adopt|whoami are separate --help cases"
else
  bad "source: expected a message-verb case AND a distinct adopt|whoami case in $K"
fi

echo "test-kosmos-help-exit0-3036: $FAILS failures"
exit $([ "$FAILS" -eq 0 ] && echo 0 || echo 1)
