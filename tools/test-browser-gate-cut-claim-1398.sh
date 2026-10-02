#!/bin/bash
# kosmos#1398: the browser GATE waits (and with KOSMOS_NO_WAIT=1 refuses) while a FOREIGN machine claim
# is live, so a gate started during a release cut can no longer make the cut's own page layer refuse it.
#
# 🛑 THIS TEST NEVER BOOTS A GATE. Every arm runs tools/browser-checks.sh SYNCHRONOUSLY with no
# Playwright findable (KOSMOS_PW_RUNTIME_DIR at an empty dir, KOSMOS_PW_NODE_PATH empty) and
# KOSMOS_SKIP_BROWSER_CHECKS=1, so the gate either stops at the claim guard or reaches the clean
# "BROWSER CHECKS SKIPPED" exit right after it, the seam tools/test-runner-reexec-1818.sh uses. The first
# version of this test started the real gate in the background for 5 s and killed it; the kill reached
# the subshell, not the gate, and a real page layer ran on for minutes (2026-10-02 00:38, blind review
# 1). No `&`, no sleep, no kill here.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME"
export KOSMOS_RUN_MARKER_DIR="$T/markers"; mkdir -p "$T/markers"   # no real cut's claim can leak in
mkdir -p "$T/nopw"
# Nothing inherited may change the outcome: an exported override would turn the refusal arm into a run.
unset KOSMOS_IGNORE_MACHINE_CLAIM KOSMOS_MACHINE_CLAIM_COOKIE KOSMOS_WAIT_MAX_S KOSMOS_WAIT_EVERY_S
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
now()  { date +%s 2>/dev/null || echo 0; }
claim() { printf '%s %s %s %s %s\n' "$1" "$$" "$(( $(now) + 600 ))" "somehost" "release 9.9.9" > "$T/markers/machine-claim"; }
# KOSMOS_HARNESS_IGNORE_CUT=1 skips the SIBLING browser-run guard, so only the claim guard decides.
gate() { ( cd "$REPO" && env KOSMOS_HARNESS_IGNORE_CUT=1 KOSMOS_SKIP_BROWSER_CHECKS=1 KOSMOS_PW_RUNTIME_DIR="$T/nopw" KOSMOS_PW_NODE_PATH= KOSMOS_NO_WAIT=1 "$@" bash tools/browser-checks.sh 2>&1 ); }
SKIPPED='BROWSER CHECKS SKIPPED'

# ARM 1: a live FOREIGN claim stops the gate at the guard, with exit 75 (did not run), before the skip exit.
claim "foreign-cookie-1398"
out="$(gate)"; rc=$?
case "$out" in *"reserved for a release"*) pass "a live FOREIGN claim stops the gate (says the box is reserved)" ;;
  *) fail "the gate did NOT stop under a foreign claim (rc=$rc): $(printf '%s' "$out" | head -2 | tr '\n' ' ')" ;; esac
[ "$rc" = 75 ] && pass "and exits 75 (did not run), not 1 (a check failed)" || fail "exit was $rc, not 75"
case "$out" in *"$SKIPPED"*) fail "it went PAST the guard to the skip exit under a foreign claim" ;;
  *) pass "and stops before anything after the guard" ;; esac

# ARM 2: no claim -> the gate passes the guard: it must REACH the skip exit (a positive marker printed only
# after the guard), not merely fail to print a refusal.
rm -f "$T/markers/machine-claim"
out="$(gate)"; rc=$?
case "$out" in *"$SKIPPED"*) pass "with no claim the gate gets past the guard (reaches the skip exit)" ;;
  *) fail "with no claim the gate did not reach the skip exit (rc=$rc): $(printf '%s' "$out" | tail -2 | tr '\n' ' ')" ;; esac

# ARM 3: the claim is THIS run's (its queue turn holds it and passed the cookie down) -> not stopped.
claim "my-cookie-1398"
out="$(gate KOSMOS_MACHINE_CLAIM_COOKIE=my-cookie-1398)"
case "$out" in *"$SKIPPED"*) pass "a claim carrying this run's own cookie does not stop it" ;;
  *) fail "the gate's own claim stopped it: $(printf '%s' "$out" | head -2 | tr '\n' ' ')" ;; esac

# ARM 4: the cut's page layer carries KOSMOS_IGNORE_MACHINE_CLAIM=1 and is not stopped even by a FOREIGN
# cookie (the claim file can be overwritten by an overlapping queued-heavy renewer mid-cut).
claim "someone-elses-cookie"
out="$(gate KOSMOS_IGNORE_MACHINE_CLAIM=1)"
case "$out" in *"$SKIPPED"*) pass "KOSMOS_IGNORE_MACHINE_CLAIM=1 (what the cut passes) is never stopped" ;;
  *) fail "the override did not get past the guard: $(printf '%s' "$out" | head -2 | tr '\n' ' ')" ;; esac

# STATIC: release.sh's page-layer launches carry the override, and the gate calls the claim check before
# the freeze. Matched on CALLS (line-start / the launch line), never on prose that mentions them.
RS="$REPO/tools/release.sh"; BC="$REPO/tools/browser-checks.sh"
launches="$(grep -c 'bash tools/browser-checks.sh' "$RS")"
carrying="$(grep 'bash tools/browser-checks.sh' "$RS" | grep -c 'KOSMOS_IGNORE_MACHINE_CLAIM=1')"
[ "$launches" -ge 1 ] && [ "$launches" = "$carrying" ] && pass "every release.sh page-layer launch ($launches) passes KOSMOS_IGNORE_MACHINE_CLAIM=1" \
  || fail "release.sh launches the page layer $launches time(s), $carrying with the override"
guard_line="$(grep -nE '^[[:space:]]*kosmos_wait_until_clear "this page layer" _bc_claim_clear' "$BC" | head -1 | cut -d: -f1)"
freeze_line="$(grep -n '^# --- freeze against a concurrent merge' "$BC" | head -1 | cut -d: -f1)"
[ -n "$guard_line" ] && [ -n "$freeze_line" ] && [ "$guard_line" -lt "$freeze_line" ] && pass "the claim wait is called before the freeze" \
  || fail "the claim wait call is missing or after the freeze (call=$guard_line freeze=$freeze_line)"

if [ "$fails" -eq 0 ]; then echo "test-browser-gate-cut-claim-1398: all arms passed"; else echo "test-browser-gate-cut-claim-1398: $fails failed"; exit 1; fi
