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

# --- LIVE parse (no seam), so the live sysctl path is exercised: it must return a
# numeric value. A single read, so nothing moves under it. ---
live_load="$(kosmos_box_load_1min)"
printf '%s' "$live_load" | grep -qE '^[0-9]+(\.[0-9]+)?$' \
  && ok "kosmos_box_load_1min returns a numeric 1-min load from live sysctl ($live_load)" \
  || bad "kosmos_box_load_1min live parse is non-numeric: [$live_load]"

# --- FIELD INDEX, deterministic (#2749). The old arm read the live load a SECOND
# time (a fresh sysctl) and asserted string-equality with the first read; the
# 1-min load moves between reads, so a busy box red it for contention, not for a
# wrong field. Instead hand the function a FIXED raw with three DISTINCT figures
# via KOSMOS_LOADAVG_RAW and assert it returns field 2 (the 1-min). Distinct
# fields mean a swap to the `{`, the 5-min or the 15-min is always caught; the
# fixed input means no moving read; and because the live and seam paths share one
# extraction, this guards the live field index too. ---
got="$(KOSMOS_LOADAVG_RAW='{ 1.11 5.55 9.99 }' kosmos_box_load_1min)"
[ "$got" = "1.11" ] \
  && ok "kosmos_box_load_1min extracts field 2 (1-min) from the raw vm.loadavg, not field 1/3/4 (got $got)" \
  || bad "field-index guard: expected 1.11 (field 2 of '{ 1.11 5.55 9.99 }'), got [$got]"
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

# --- INTEGRATION (#2750). run-tests.sh's seen_before() banner reads the 1-min
# load through kosmos_box_load_1min, not a second inline `sysctl | awk '{print $2}'`.
# That call is `command -v`-guarded and fails OPEN (a missing/renamed function just
# omits the banner line), so deleting the source or the call produces NO runtime
# signal -- the banner silently stops showing load, or a second inline field-2 copy
# creeps back. These grep arms ARE the signal, mirroring the integration arms in
# tools/test-board-origin.sh. Distinctive fragments, not bare names, so the comment
# in run-tests.sh (which mentions the function by name) does not satisfy them. ---
RT="$REPO/tools/run-tests.sh"
grep -qF '. "$REPO/tools/lib/cut-load-guard.sh"' "$RT" \
  && ok "INTEGRATION: run-tests.sh SOURCES cut-load-guard.sh" \
  || bad "INTEGRATION: run-tests.sh no longer sources cut-load-guard.sh -- its load banner falls back to omitting the line, silently"
grep -qF 'load="$(kosmos_box_load_1min)"' "$RT" \
  && ok "INTEGRATION: run-tests.sh reads the 1-min load via kosmos_box_load_1min" \
  || bad "INTEGRATION: run-tests.sh no longer calls kosmos_box_load_1min -- a second inline field-2 copy has likely returned (#2750)"

# --- #2760 P1: the overlap DECISION (kosmos_cut_parallel_ok). The load-bearing
# half, so it is unit-tested here rather than only bash -n'd in release.sh -- the
# same reason kosmos_gate_or_abort is tested above. Every assertion below pins the
# DANGEROUS direction too: the default (flag off) MUST stay serial, and every
# unreadable input MUST fall back to serial, because serial is the safe path. ---

# defaults
got="$(kosmos_cut_parallel_min_cores)"
[ "$got" = "8" ] && ok "parallel min-cores default is 8 ($got)" || bad "min-cores default: got [$got], expected [8]"
got="$(KOSMOS_CUT_PARALLEL_MIN_CORES=12 kosmos_cut_parallel_min_cores)"
[ "$got" = "12" ] && ok "KOSMOS_CUT_PARALLEL_MIN_CORES overrides min-cores" || bad "min-cores override: got [$got], expected [12]"
got="$(KOSMOS_CUT_PARALLEL_MIN_CORES=garbage kosmos_cut_parallel_min_cores)"
[ "$got" = "8" ] && ok "a garbage min-cores override is ignored (falls back to 8, so the decision cannot fault)" || bad "min-cores garbage-override: got [$got], expected [8]"
got="$(KOSMOS_CUT_PARALLEL_MIN_CORES=9999 kosmos_cut_parallel_min_cores)"
[ "$got" = "9999" ] && ok "a 4-digit (in-range) min-cores override is honoured" || bad "min-cores 4-digit: got [$got], expected [9999]"
got="$(KOSMOS_CUT_PARALLEL_MIN_CORES=99999999999999999999 kosmos_cut_parallel_min_cores)"
[ "$got" = "8" ] && ok "an OVERLONG (5+ digit) min-cores override folds to the default 8, so it cannot wrap the 10# arithmetic and mis-decide (fail-safe gap flagged in review)" || bad "min-cores overlong: got [$got], expected [8] (fold, no wrap)"
ncpu="$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"
expect="$(LC_ALL=C awk -v n="$ncpu" 'BEGIN { printf "%.1f", n * 0.5 }')"
got="$(kosmos_cut_parallel_max_load)"
[ "$got" = "$expect" ] && ok "parallel max-load default is 0.5x cores ($got)" || bad "max-load default: got [$got], expected [$expect]"
got="$(KOSMOS_CUT_PARALLEL_MAX_LOAD=3 kosmos_cut_parallel_max_load)"
[ "$got" = "3" ] && ok "KOSMOS_CUT_PARALLEL_MAX_LOAD overrides max-load" || bad "max-load override: got [$got], expected [3]"

# the decision: 0 = parallelize, 1 = serial. Force cores+load via overrides so the
# cases are deterministic on any box (a 2-core CI runner included).
parok() { if eval "$1 kosmos_cut_parallel_ok"; then echo 0; else echo $?; fi; }

# 1. the opt-in default: flag UNSET -> serial (the feature changes NO real cut)
[ "$(parok 'KOSMOS_FAKE_LOAD=0.1 KOSMOS_CUT_PARALLEL_MIN_CORES=1')" = 1 ] \
  && ok "DEFAULT (KOSMOS_CUT_PARALLEL unset) -> serial, even on a quiet many-core box" \
  || bad "default should be serial: a cut with the flag unset must not parallelize"
[ "$(parok 'KOSMOS_CUT_PARALLEL=0 KOSMOS_FAKE_LOAD=0.1 KOSMOS_CUT_PARALLEL_MIN_CORES=1')" = 1 ] \
  && ok "KOSMOS_CUT_PARALLEL=0 -> serial" || bad "flag=0 should be serial"
[ "$(parok 'KOSMOS_CUT_PARALLEL=yes KOSMOS_FAKE_LOAD=0.1 KOSMOS_CUT_PARALLEL_MIN_CORES=1')" = 1 ] \
  && ok "KOSMOS_CUT_PARALLEL=yes (not exactly 1) -> serial" || bad "flag must be exactly 1"

# 2. opt-in + enough cores + low load -> parallel
[ "$(parok 'KOSMOS_CUT_PARALLEL=1 KOSMOS_FAKE_LOAD=0.1 KOSMOS_CUT_PARALLEL_MIN_CORES=1')" = 0 ] \
  && ok "opt-in + enough cores + low load -> parallel" || bad "opt-in + quiet should parallelize"

# 3. opt-in but too few cores -> serial (a 2-/4-core box has no spare cycles). Use 9999 (a
#    4-digit, in-range threshold above any real core count); NOT 5+ digits, which the
#    min-cores validator rejects as overlong and folds back to the default 8.
[ "$(parok 'KOSMOS_CUT_PARALLEL=1 KOSMOS_FAKE_LOAD=0.1 KOSMOS_CUT_PARALLEL_MIN_CORES=9999')" = 1 ] \
  && ok "opt-in but cores below the minimum -> serial" || bad "too few cores should be serial"

# 4. opt-in but load too high -> serial
[ "$(parok 'KOSMOS_CUT_PARALLEL=1 KOSMOS_FAKE_LOAD=999 KOSMOS_CUT_PARALLEL_MIN_CORES=1')" = 1 ] \
  && ok "opt-in but load over max -> serial" || bad "high load should be serial"

# 5. STRICTLY below: load == max -> serial (a box exactly at the threshold has no headroom)
[ "$(parok 'KOSMOS_CUT_PARALLEL=1 KOSMOS_FAKE_LOAD=5 KOSMOS_CUT_PARALLEL_MAX_LOAD=5 KOSMOS_CUT_PARALLEL_MIN_CORES=1')" = 1 ] \
  && ok "load == max-load -> serial (strictly-below required)" || bad "load==max should be serial"
[ "$(parok 'KOSMOS_CUT_PARALLEL=1 KOSMOS_FAKE_LOAD=4.9 KOSMOS_CUT_PARALLEL_MAX_LOAD=5 KOSMOS_CUT_PARALLEL_MIN_CORES=1')" = 0 ] \
  && ok "load just below max-load -> parallel" || bad "load<max should parallelize"

# 6. fail-safe: an unreadable load -> serial (the OPPOSITE fail-direction from
#    kosmos_load_over_threshold, which fails open; here serial is the safe path)
[ "$(parok 'KOSMOS_CUT_PARALLEL=1 KOSMOS_LOADAVG_RAW=single_field_no_load KOSMOS_CUT_PARALLEL_MIN_CORES=1')" = 1 ] \
  && ok "opt-in but unreadable load -> serial (fail-safe)" || bad "unreadable load should fall back to serial"

# --- #2760 P1 INTEGRATION: release.sh must WIRE the decision into the gated-steps
# region and keep both the START and END markers the behavioural test extracts
# between (tools/test-cut-parallel-region.sh). Distinctive fragments so a prose
# mention cannot satisfy them. ---
RELSH="$REPO/tools/release.sh"
grep -qF 'if kosmos_cut_parallel_ok; then _cut_parallel=1; fi' "$RELSH" \
  && ok "INTEGRATION: release.sh gates the overlap on kosmos_cut_parallel_ok" \
  || bad "INTEGRATION: release.sh no longer calls kosmos_cut_parallel_ok -- the overlap is unwired"
grep -qF '#2760-P1 gated-steps region START' "$RELSH" && grep -qF '#2760-P1 gated-steps region END' "$RELSH" \
  && ok "INTEGRATION: release.sh keeps both #2760-P1 region markers (the behavioural test extracts between them)" \
  || bad "INTEGRATION: a #2760-P1 region marker is missing -- tools/test-cut-parallel-region.sh can no longer extract the region"

echo ""
if [ "$fails" -eq 0 ]; then
  echo "test-cut-load-guard: ALL PASS"
  exit 0
else
  echo "test-cut-load-guard: $fails FAILED"
  exit 1
fi
