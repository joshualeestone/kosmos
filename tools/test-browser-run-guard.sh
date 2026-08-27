#!/bin/bash
# The concurrent-page-layer guard shown red, green and unable to answer.
#
# ⚠️ WHY THIS EXISTS SEPARATELY FROM tools/test-cut-guard.sh. The fleet rule
# said "do not run browser checks while a CUT is running" and the cut guard
# detects a CUT, so a HAND-RUN page layer was invisible to both. Measured
# 2026-08-27 13:17Z: a peer's `bash tools/browser-checks.sh` had been live for
# 8m29s, `pgrep release.sh` returned nothing CORRECTLY, and the cut guard said
# clear. What cost cut three was never the cut: it was two concurrent
# Playwright runs starving each other, and the loser failed with errors that
# read exactly like missing code.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib/cut-guard.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

printf '#!/bin/sh\nprintf "99999 bash tools/browser-checks.sh\\n"\n' > "$T/probe-live"; chmod +x "$T/probe-live"
printf '#!/bin/sh\nexit 1\n' > "$T/probe-quiet"; chmod +x "$T/probe-quiet"
printf '#!/bin/sh\nexit 3\n' > "$T/probe-dead"; chmod +x "$T/probe-dead"

out="$(KOSMOS_BC_PROBE="$T/probe-live" kosmos_refuse_if_browser_run_live "a page layer" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "refuses while another page layer is live"; else fail "refuses while another page layer is live (rc=$rc)"; fi
if has "$out" "browser-checks.sh"; then pass "and names the run it found"; else fail "and names the run: $out"; fi
if has "$out" "KOSMOS_HARNESS_IGNORE_CUT=1"; then pass "and names the override"; else fail "and names the override: $out"; fi
if has "$out" "read like missing code"; then pass "and says WHY, because the symptom is indistinguishable from a defect"; else fail "and says why: $out"; fi

out="$(KOSMOS_BC_PROBE="$T/probe-quiet" kosmos_refuse_if_browser_run_live "a page layer" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ -z "$out" ]; then pass "passes silently when no other run is live"; else fail "passes when nothing is live (rc=$rc, out=$out)"; fi

out="$(KOSMOS_BC_PROBE="$T/probe-dead" kosmos_refuse_if_browser_run_live "a page layer" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "could not tell"; then pass "a probe that cannot answer is a refusal, not a pass"; else fail "unanswerable probe (rc=$rc, out=$out)"; fi

# ⚠️ SELF-EXCLUSION. browser-checks.sh IS a `bash tools/browser-checks.sh`, so
# without this the gate refuses EVERY page-layer run on a Mac with no other
# run -- a total outage that reads exactly like the guard working.
printf '#!/bin/sh\nprintf "%%s bash tools/browser-checks.sh\\n" "$$SELF"\n' > "$T/probe-self"
sed -i '' "s/\$\$SELF/$$/" "$T/probe-self"; chmod +x "$T/probe-self"
out="$(KOSMOS_BC_PROBE="$T/probe-self" KOSMOS_BC_SELF_PID=$$ kosmos_refuse_if_browser_run_live "a page layer" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ]; then pass "does not refuse itself"; else fail "does not refuse itself (rc=$rc, out=$out)"; fi

# ⚠️ THE REAL pgrep PATH, NOT ONLY THE SEAM. Every check above drives the probe
# seam, so all of them would still pass if the real pgrep expression matched
# nothing at all. A decoy process with the true command line proves the shipped
# expression matches what it claims to. It sleeps; it never starts a browser.
mkdir -p "$T/tools"
printf '#!/bin/bash\nsleep 30\n' > "$T/tools/browser-checks.sh"; chmod +x "$T/tools/browser-checks.sh"
# ⚠️ MEASURED AS A DELTA, NOT AS A VERDICT. A colleague's real page-layer run
# may be live on this shared Mac while this test runs, and then "the guard
# refused" would be true no matter what the shipped expression matched -- the
# control would pass for a reason nobody checked. So count before and after:
# the decoy must add exactly one, whatever else is running.
live_count() {
  local o
  o="$(KOSMOS_BC_SELF_PID=$$ kosmos_refuse_if_browser_run_live "count" 2>&1)"
  case "$o" in *" live; first: "*) echo "$o" | sed -n 's/.*Mac (\([0-9]*\) live;.*/\1/p';; *) echo 0;; esac
}
before="$(live_count)"
( cd "$T" && bash tools/browser-checks.sh ) & decoy=$!
sleep 1
after="$(live_count)"
out="$(KOSMOS_BC_SELF_PID=$$ kosmos_refuse_if_browser_run_live "a page layer" 2>&1)"; rc=$?
# Kill by PID. Never `pkill -f browser-checks.sh` -- that matches every agent's
# real run on this shared Mac, across account dirs.
kill "$decoy" 2>/dev/null; wait "$decoy" 2>/dev/null
if [ "$rc" -eq 1 ] && [ "$after" -eq $((before + 1)) ]; then
  pass "the SHIPPED pgrep expression sees a real browser-checks process (live went $before -> $after)"
else
  fail "real pgrep path: expected $((before + 1)) live, saw $after (rc=$rc)"
fi

echo
if [ "$fails" -eq 0 ]; then echo "all clear"; else echo "$fails FAILURES"; fi
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
