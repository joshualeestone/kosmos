#!/bin/bash
# kosmos#1398: the browser GATE must refuse to start while a cut holds the machine.
#
# The cut guard was one-directional -- a CUT refuses to start into a running gate,
# but a GATE started mid-cut had nothing to stop it, and killing that gate killed
# the cut with it (three cuts, ~90 min). The fix mirrors run-tests.sh's
# kosmos_refuse_if_machine_claimed consult into tools/browser-checks.sh. That
# mechanism is the self-exclusion-SAFE one: the cut's OWN 3b inherits the exported
# claim cookie (kosmos_claim_machine) and runs; only a live, FOREIGN claim refuses.
# (kosmos_refuse_if_cut_live would have been WRONG here -- it keys on the cut's
# run-marker, which the gate does not carry, so it would make the cut refuse its own
# page layer. The function's own directions are covered by test-machine-claim-1962.sh;
# this test covers the WIRING into the gate.)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
# #2271-style isolation: point the marker dir at an empty temp dir so a real cut's
# claim on the shared box can never leak in and red this test.
export KOSMOS_RUN_MARKER_DIR="$T/markers"; mkdir -p "$T/markers"
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
now()  { date +%s 2>/dev/null || echo 0; }

# ---- ARM 1 (behavioral, the #1398 direction): a live FOREIGN claim makes the GATE
# refuse, and refuse EARLY, before it boots a board or Playwright. --------------
# KOSMOS_HARNESS_IGNORE_CUT=1 skips the SIBLING browser-run guard so only the
# machine-claim guard under test decides the outcome -- deterministic on a busy box,
# with no dependence on some other browser run's pid. Red-capable: without the wiring
# in browser-checks.sh the gate never calls the guard, never refuses, and this fails.
printf '%s %s %s %s %s\n' "foreign-cookie-1398" "$$" "$(( $(now) + 600 ))" "somehost" "release 9.9.9" > "$T/markers/machine-claim"
out="$(cd "$REPO" && KOSMOS_HARNESS_IGNORE_CUT=1 bash tools/browser-checks.sh 2>&1)"; rc=$?
case "$out" in
  *"reserved for a release"*)
    if [ "$rc" -ne 0 ]; then pass "a live FOREIGN claim makes the gate REFUSE (the #1398 unguarded direction)"
    else fail "the gate printed the claim message but exited 0 (rc=$rc)"; fi ;;
  *) fail "the gate did NOT refuse under a foreign claim (rc=$rc): $(printf '%s' "$out" | head -1)" ;;
esac
case "$out" in
  *boot_board*|*Playwright*|*"=== render-"*) fail "the gate BOOTED before refusing -- the claim guard is too late in the file" ;;
  *) pass "and it refuses BEFORE booting a board (the guard is early)" ;;
esac

# ---- ARM 2 (behavioral): with the claim GONE, the gate must NOT refuse -- a guard
# that has only ever seen a claimed box has not been tested (#1398). --------------
# We only need to prove it passed the claim guard, not run the whole (heavy) gate,
# so bound it: start it, give it a moment to clear the early guards, and assert no
# refuse message appeared. A quiet browser probe keeps the sibling guard quiet too.
rm -f "$T/markers/machine-claim"
printf '#!/bin/sh\nexit 1\n' > "$T/probe-quiet"; chmod +x "$T/probe-quiet"
( cd "$REPO" && KOSMOS_BC_PROBE="$T/probe-quiet" bash tools/browser-checks.sh > "$T/out2.log" 2>&1 ) &
bpid=$!; sleep 5; kill "$bpid" 2>/dev/null; pkill -P "$bpid" 2>/dev/null; wait "$bpid" 2>/dev/null
if grep -qi "reserved for a release" "$T/out2.log" 2>/dev/null; then
  fail "the gate FALSELY refused with no claim present"
else
  pass "with no claim, the gate does NOT refuse (proceeds past the claim guard)"
fi

# ---- ARM 3 (static, self-exclusion safety): the guard is wired via the cookie-safe
# function and sits BEFORE the board boot. The cut's OWN 3b self-excludes via the
# exported cookie (proven at the function level by test-machine-claim-1962.sh); this
# asserts the gate uses THAT function, not the run-marker one that would self-refuse.
BC="$REPO/tools/browser-checks.sh"
if grep -q 'kosmos_refuse_if_machine_claimed "this page layer"' "$BC"; then
  pass "browser-checks.sh consults the machine claim (cookie-safe, mirrors run-tests.sh)"
else
  fail "browser-checks.sh does not call kosmos_refuse_if_machine_claimed"
fi
# Match a CALL (line-start invocation), not a mention: the file's own comment
# explains why it does NOT use this function, and a bare substring grep would match
# that prose (the use-vs-mention trap, bulletin a-string-search-cannot-tell-use-from-mention).
if grep -qE '^[[:space:]]*kosmos_refuse_if_cut_live' "$BC"; then
  fail "browser-checks.sh CALLS kosmos_refuse_if_cut_live -- that self-refuses the cut's own 3b; use the claim guard"
else
  pass "and does NOT call the run-marker guard that would self-refuse the cut's own page layer"
fi
guard_line="$(grep -n 'kosmos_refuse_if_machine_claimed' "$BC" | head -1 | cut -d: -f1)"
boot_line="$(grep -n 'freeze against a concurrent merge' "$BC" | head -1 | cut -d: -f1)"
if [ -n "$guard_line" ] && [ -n "$boot_line" ] && [ "$guard_line" -lt "$boot_line" ]; then
  pass "the claim guard is positioned before the freeze/boot region"
else
  fail "the claim guard is not clearly before the boot region (guard=$guard_line boot=$boot_line)"
fi

if [ "$fails" -eq 0 ]; then echo "test-browser-gate-cut-claim-1398: all arms passed"; else echo "test-browser-gate-cut-claim-1398: $fails failed"; exit 1; fi
