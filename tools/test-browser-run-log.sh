#!/usr/bin/env bash
# The page-layer run log records every run, and never fails a run (#1079).
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$REPO/tools/lib/browser-run-log.sh"
fails=0
passes=0
ok()  { printf 'PASS: %s\n' "$1"; passes=$((passes+1)); }
bad() { printf 'FAIL: %s\n' "$1"; fails=$((fails+1)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- it records a run, with the variable #1079 is about -----------------------
export KOSMOS_BROWSER_RUN_LOG="$TMP/runs.log"
browser_run_log_append "abc1234" 46 1 0 2 "regress-a-night"
line="$(cat "$TMP/runs.log" 2>/dev/null)"

case "$line" in
  *"sha=abc1234"*) ok "the sha is recorded" ;;
  *) bad "no sha in: $line" ;;
esac
case "$line" in
  *"rich=2"*) ok "the rich-board count is recorded (the variable this card is about)" ;;
  *) bad "no rich count in: $line" ;;
esac
case "$line" in
  *"retried=1"*"names=regress-a-night"*) ok "the retry count AND the name are recorded" ;;
  *) bad "retry detail missing from: $line" ;;
esac

# 🛑 THE ARM THAT MAKES THE LOG USEFUL RATHER THAN JUST PRESENT. A log that only
# gets a line when something retried is a numerator with no denominator, and the
# question ("does the rich board raise the retry rate?") cannot be answered from
# it at any sample size.
browser_run_log_append "def5678" 46 0 0 0
n="$(wc -l < "$TMP/runs.log" | tr -d ' ')"
if [ "$n" = "2" ]; then
  ok "a CLEAN run is recorded too, so the log has a denominator"
else
  bad "expected 2 lines (one retried, one clean), got $n"
fi
grep -q 'retried=0 failed=0 rich=0 names=none' "$TMP/runs.log" \
  && ok "a clean run records zeros and names=none rather than being omitted" \
  || bad "the clean run's line is not shaped as expected"

# --- it must never fail a run -------------------------------------------------
# An unwritable path is the realistic failure (a read-only home, a full disk).
export KOSMOS_BROWSER_RUN_LOG="/dev/null/impossible/runs.log"
browser_run_log_append "ghi9012" 1 0 0 0 2>/dev/null
rc=$?
if [ "$rc" = "0" ]; then
  ok "an unwritable log path returns 0: a broken log can never red a release gate"
else
  bad "an unwritable log path returned $rc, which would fail the gate"
fi

# --- CONTROL: prove the assertions above can fail ----------------------------
# Without this, every 'ok' above is equally consistent with a matcher that
# matches anything.
export KOSMOS_BROWSER_RUN_LOG="$TMP/ctl.log"
browser_run_log_append "zzz0000" 5 0 0 0
if grep -q 'sha=abc1234' "$TMP/ctl.log" 2>/dev/null; then
  bad "CONTROL: a sha that was never written was found, so these matchers prove nothing"
else
  ok "CONTROL: a sha that was not written is absent, so the matches above mean something"
fi

# --- THE CALL SHAPE browser-checks.sh actually uses -------------------------
# 🛑 THE ARM MOST LIKELY TO BREAK A RELEASE, AND IT IS NOT THE LOGGING. The
# runner has `set -u` and passes bash arrays: `"${#RETRIED[@]}"` and
# `${RETRIED[@]+"${RETRIED[@]}"}`. On a CLEAN run every one of those arrays is
# EMPTY, and a naive `"${RETRIED[@]}"` under `set -u` is an unbound-variable
# error. That would red every clean page-layer run, which is the opposite of what
# this change is for. Asserted with the real shapes rather than trusted.
export KOSMOS_BROWSER_RUN_LOG="$TMP/shape.log"
(
  set -uo pipefail
  FAILED=(); RAN=(); RETRIED=(); RICH_BOOTED=0
  browser_run_log_append "abc1234" \
    "${#RAN[@]}" "${#RETRIED[@]}" "${#FAILED[@]}" "$RICH_BOOTED" ${RETRIED[@]+"${RETRIED[@]}"}
) 2>/dev/null
if [ "$?" = "0" ] && grep -q 'ran=0 retried=0 failed=0 rich=0 names=none' "$TMP/shape.log" 2>/dev/null; then
  ok "a CLEAN run's empty arrays expand safely under set -u"
else
  bad "the clean-run call shape failed under set -u: this would red every clean page run"
fi

(
  set -uo pipefail
  RAN=(a b c); RETRIED=(regress-a-night); FAILED=(); RICH_BOOTED=2
  browser_run_log_append "abc1234" \
    "${#RAN[@]}" "${#RETRIED[@]}" "${#FAILED[@]}" "$RICH_BOOTED" ${RETRIED[@]+"${RETRIED[@]}"}
) 2>/dev/null
if grep -q 'ran=3 retried=1 failed=0 rich=2 names=regress-a-night' "$TMP/shape.log" 2>/dev/null; then
  ok "a run WITH retries and rich boards records both, in the runner's own call shape"
else
  bad "the populated call shape did not record correctly"
fi

echo "─────────────────────────────"
# Counted, not asserted. A hardcoded total is a claim the script makes about its
# own output, and it was wrong (6 stated, 7 emitted) the first time it ran.
echo "Results: $passes passed, $fails failed"
[ "$fails" -eq 0 ]
