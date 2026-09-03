#!/usr/bin/env bash
# Test for tools/lib/cut-load-guard.sh (#2017): the cut's load guard. It waits
# for a quiet box before a gated step and, on a persistent-saturation timeout,
# stops with the LOAD named rather than running a gate into a starved box.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
. "$REPO/tools/lib/cut-load-guard.sh"

fails=0
ok()  { echo "  PASS  $1"; }
bad() { echo "  FAIL  $1"; fails=$((fails + 1)); }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- threshold ---
ncpu="$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"
expect="$(awk -v n="$ncpu" 'BEGIN { printf "%.1f", n * 1.5 }')"
got="$(kosmos_cut_load_threshold)"
[ "$got" = "$expect" ] && ok "default threshold is 1.5x cores ($got)" \
  || bad "default threshold: got [$got], expected [$expect]"
got="$(KOSMOS_CUT_MAX_LOAD=7 kosmos_cut_load_threshold)"
[ "$got" = "7" ] && ok "KOSMOS_CUT_MAX_LOAD overrides the threshold" \
  || bad "threshold override: got [$got], expected [7]"

# --- float compare (bash 3.2 has none; awk does it) ---
kosmos_load_over_threshold 20 15   && ok "20 > 15 is over"          || bad "20 vs 15 should be over"
kosmos_load_over_threshold 10 15   && bad "10 vs 15 should NOT be over" || ok "10 > 15 is not over"
kosmos_load_over_threshold 15.5 15 && ok "15.5 > 15 is over (float)"    || bad "15.5 vs 15 should be over"
kosmos_load_over_threshold "" 15   && bad "empty load should NOT be over (fail open)" || ok "an unreadable load is not over (fail open: never block a cut on a load we cannot read)"

# --- wait: quiet immediately (load below threshold) -> 0 ---
if KOSMOS_FAKE_LOAD=5 KOSMOS_CUT_MAX_LOAD=10 kosmos_wait_for_quiet_box "step Q" 2 1 >/dev/null 2>&1; then rc=0; else rc=$?; fi
[ "$rc" -eq 0 ] && ok "a box already below threshold -> verdict 0 (run immediately, no wait)" \
  || bad "quiet-immediately: rc=$rc, expected 0"

# --- wait: persistent saturation -> timeout 1, with load attribution ---
out="$(KOSMOS_FAKE_LOAD=20 KOSMOS_CUT_MAX_LOAD=10 kosmos_wait_for_quiet_box "step T" 2 1 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && ok "a box that stays saturated -> verdict 1 (timeout)" \
  || bad "timeout case: rc=$rc, expected 1"
printf '%s\n' "$out" | grep -q "did NOT quiet" && ok "the timeout narrates a LOAD-attributed stop, not a test failure" \
  || bad "timeout narration missing 'did NOT quiet'"
printf '%s\n' "$out" | grep -q "1-min load 20" && ok "the timeout names the actual load" \
  || bad "timeout narration missing the load value"

# --- kosmos_gate_or_abort: release.sh's integration point, so the abort DECISION is unit-tested
# (not only bash -n'd inline in release.sh, the load-bearing half of the feature). ---
if KOSMOS_FAKE_LOAD=5 KOSMOS_CUT_MAX_LOAD=10 kosmos_gate_or_abort "step G" 2 1 >/dev/null 2>&1; then rc=0; else rc=$?; fi
[ "$rc" -eq 0 ] && ok "gate_or_abort on a quiet box -> 0 (the cut proceeds)" \
  || bad "gate_or_abort quiet: rc=$rc, expected 0"
out="$(KOSMOS_FAKE_LOAD=20 KOSMOS_CUT_MAX_LOAD=10 kosmos_gate_or_abort "step G" 2 1 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && ok "gate_or_abort on a persistently saturated box -> 1 (the cut aborts)" \
  || bad "gate_or_abort timeout: rc=$rc, expected 1"
printf '%s\n' "$out" | grep -q "aborting the cut" && ok "gate_or_abort narrates the LOAD-attributed abort (not a test-red)" \
  || bad "gate_or_abort narration missing 'aborting the cut'"

# --- LIVE parse (no fake seam), so a wrong-field regression is caught, not only the fake path.
# kosmos_box_load_1min must extract sysctl's 1-min field (2), never the `{` or the 5-min load. ---
live_load="$(kosmos_box_load_1min)"
printf '%s' "$live_load" | grep -qE '^[0-9]+(\.[0-9]+)?$' \
  && ok "kosmos_box_load_1min returns a numeric 1-min load from live sysctl ($live_load)" \
  || bad "kosmos_box_load_1min live parse is non-numeric: [$live_load]"
sys1="$(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}')"
[ -n "$sys1" ] && [ "$live_load" = "$sys1" ] \
  && ok "the live 1-min load matches sysctl's field 2 directly (guards the field index)" \
  || bad "live load [$live_load] != sysctl field 2 [$sys1]"
# kosmos_top_cpu_consumers must skip the ps header row (never emit the PID/COMMAND line).
top="$(kosmos_top_cpu_consumers 2)"
printf '%s\n' "$top" | grep -qE '^[[:space:]]*PID' \
  && bad "kosmos_top_cpu_consumers leaked the ps header row" \
  || ok "kosmos_top_cpu_consumers skips the ps header (no PID row in its output)"

# --- wait: saturated THEN quiets after a poll -> 0 (exercises the re-check loop) ---
# Override the load reader to return 20 on the first read and 5 after, via a counter.
CF="$WORK/loadcount"; echo 0 > "$CF"
kosmos_box_load_1min() {
  local c; c="$(cat "$CF" 2>/dev/null || echo 0)"; echo $((c + 1)) > "$CF"
  if [ "$c" -eq 0 ]; then echo 20; else echo 5; fi
}
out="$(KOSMOS_CUT_MAX_LOAD=10 kosmos_wait_for_quiet_box "step P" 5 1 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "a box that quiets after a poll -> verdict 0 (waited, then ran)" \
  || bad "quiets-after-poll: rc=$rc, expected 0"
printf '%s\n' "$out" | grep -q "the box quieted after" && ok "narrates that it waited then quieted" \
  || bad "quiets-after-poll narration missing"
# restore the real reader for anything after
unset -f kosmos_box_load_1min
. "$REPO/tools/lib/cut-load-guard.sh"

# --- ERREXIT: as a DIRECT caller under set -euo pipefail (release.sh's context),
# the guard must return cleanly, not abort on sysctl/awk/ps/sleep. ---
export REPO
if out="$(bash -c 'set -euo pipefail; . "$REPO/tools/lib/cut-load-guard.sh"; KOSMOS_FAKE_LOAD=5 KOSMOS_CUT_MAX_LOAD=10 kosmos_wait_for_quiet_box "step E" 2 1; echo "returned:$?"' 2>&1)"; then erc=0; else erc=$?; fi
printf '%s\n' "$out" | grep -q "returned:0" && ok "under set -euo pipefail as a direct caller, the guard returns cleanly (errexit-safe)" \
  || bad "errexit-safety: [$out] (erc=$erc)"

echo ""
if [ "$fails" -eq 0 ]; then
  echo "test-cut-load-guard: ALL PASS"
  exit 0
else
  echo "test-cut-load-guard: $fails FAILED"
  exit 1
fi
