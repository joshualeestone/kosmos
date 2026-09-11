#!/usr/bin/env bash
# #2017: a release cut runs its gated steps (the node suite at step 3, the
# headless browser checks at step 3b) on a box that OTHER work can be loading.
# #1962's machine reservation blocks other agents' SUITES, but NOT an arbitrary
# heavy background job -- and one did exactly this on 2026-09-03: eight leftover
# `while :; mktemp` loops from a CLOSED investigation (#1988) drove fseventsd to
# ~70% CPU and box load to 24, starving the 0.6.25 cut's browser gate. It cost a
# full cut cycle, and an isolation-rerun (#2006) does not help -- as Baron put
# it, "it still runs INSIDE the same starved box."
#
# So before a gated step, WAIT for the box to be quiet enough to gate on. This is
# PREVENTION, not detection: a gate that runs on a saturated box false-reds, and
# a false-red release trains people to dismiss reds. Waiting removes the source.
# It NAMES the top CPU consumer while it waits, so the reason is in the log (and
# a human, or #2018's reap-on-close, can clear the offender). If the box does not
# quiet within the timeout, it stops with a LOAD-attributed message -- never a
# phantom test-red -- so a persistent saturating job is called out by name.
#
# The asymmetry, same as #2006: load manufactures false REDS, never false greens.
# So waiting for a quiet box can only make a red MORE trustworthy, never hide one.
#
# Sourced by release.sh under `set -euo pipefail`; every command here is written
# errexit-safe. bash 3.2 compatible (macOS system bash): no mapfile, no `((...))`
# as a bare command, float compares via awk.

# The 1-minute load average. macOS `sysctl -n vm.loadavg` prints "{ 1m 5m 15m }".
# KOSMOS_FAKE_LOAD overrides the whole value (tests, and a machine with no sysctl).
#
# #2749: the raw vm.loadavg string is read ONCE -- from the KOSMOS_LOADAVG_RAW
# seam if a test set it, otherwise from live sysctl -- and field 2 (the 1-minute
# figure, never the leading `{` or the 5-/15-minute loads) is extracted from that
# single string by ONE shared awk. Reading once matters: the earlier field-index
# guard read the live load twice and asserted the two equal, but the 1-min load
# moves between reads, so a busy box red it for contention rather than for a wrong
# field. Because the live path and the seam path now run the SAME extraction, a
# test that hands a fixed raw via KOSMOS_LOADAVG_RAW guards the live field index
# too, deterministically. (KOSMOS_FAKE_LOAD still bypasses the parse entirely,
# for arms that only need a fixed load value.)
kosmos_box_load_1min() {
  if [ -n "${KOSMOS_FAKE_LOAD:-}" ]; then
    printf '%s\n' "$KOSMOS_FAKE_LOAD"
    return 0
  fi
  local raw
  if [ -n "${KOSMOS_LOADAVG_RAW:-}" ]; then
    raw="$KOSMOS_LOADAVG_RAW"
  else
    raw="$(sysctl -n vm.loadavg 2>/dev/null || true)"
  fi
  printf '%s\n' "$raw" | awk '{print $2}' || true
}

# The load at or below which a gated step may run. Default: 1.5x the core count
# (fully oversubscribed beyond the cores is where a browser gate starves).
# KOSMOS_CUT_MAX_LOAD overrides it.
kosmos_cut_load_threshold() {
  if [ -n "${KOSMOS_CUT_MAX_LOAD:-}" ]; then
    printf '%s\n' "$KOSMOS_CUT_MAX_LOAD"
    return 0
  fi
  local ncpu
  ncpu="$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"
  # LC_ALL=C: sysctl always prints a `.`-decimal load, so the compare and format
  # must not follow a comma-decimal LC_NUMERIC.
  LC_ALL=C awk -v n="$ncpu" 'BEGIN { printf "%.1f", n * 1.5 }'
}

# The top CPU consumers right now, for attribution ("what is loading the box").
kosmos_top_cpu_consumers() {
  local n="${1:-3}"
  # -r sorts by %cpu descending on macOS ps; skip the header and this ps itself.
  ps -Ao pid,pcpu,comm -r 2>/dev/null | awk 'NR>1 && $2+0 > 0' | head -n "$n" || true
}

# 0 if load ($1) is STRICTLY over threshold ($2), 1 otherwise. awk handles the
# float compare (bash 3.2 has no float arithmetic). An unreadable/empty load is
# treated as NOT over (fail open: never block a cut on a load we cannot read).
kosmos_load_over_threshold() {
  local load="$1" thresh="$2"
  [ -n "$load" ] || return 1
  LC_ALL=C awk -v l="$load" -v t="$thresh" 'BEGIN { exit !(l+0 > t+0) }'
}

# Wait until the box's 1-minute load is at or below the threshold, or until
# max_wait_s elapses. Narrates the load and the top consumer while waiting.
# Returns 0 if the box is (or becomes) quiet, 1 on timeout (still saturated).
# Usage: kosmos_wait_for_quiet_box <label> [max_wait_s] [poll_s]
kosmos_wait_for_quiet_box() {
  local label="$1" max_wait="${2:-600}" poll="${3:-15}"
  local thresh load waited
  thresh="$(kosmos_cut_load_threshold)"
  load="$(kosmos_box_load_1min)"

  if ! kosmos_load_over_threshold "$load" "$thresh"; then
    return 0
  fi

  echo "cut-load-guard: before $label the box is saturated (1-min load ${load} > ${thresh}). Waiting up to ${max_wait}s for it to quiet, because a gated step on a loaded box false-reds. Top CPU right now:"
  kosmos_top_cpu_consumers 3 | sed 's/^/    /'

  waited=0
  while [ "$waited" -lt "$max_wait" ]; do
    sleep "$poll"
    waited=$((waited + poll))
    load="$(kosmos_box_load_1min)"
    if ! kosmos_load_over_threshold "$load" "$thresh"; then
      echo "cut-load-guard: the box quieted after ${waited}s (1-min load ${load} <= ${thresh}); running $label."
      return 0
    fi
    echo "cut-load-guard: still saturated after ${waited}s (1-min load ${load} > ${thresh}). Top CPU:"
    kosmos_top_cpu_consumers 2 | sed 's/^/    /'
  done

  echo "cut-load-guard: the box did NOT quiet within ${max_wait}s (1-min load ${load} > ${thresh}). This is LOAD, not a test defect: a heavy background job is saturating the machine. Not running $label into it, as it would red on contention rather than on the change. Reap the offending job (below) and re-cut:"
  kosmos_top_cpu_consumers 4 | sed 's/^/    /'
  return 1
}

# The release.sh integration point, kept in the lib (not inline in release.sh)
# so the abort DECISION is unit-tested rather than only bash -n'd. Waits for a
# quiet box; on a persistent-saturation timeout it narrates a LOAD-attributed
# stop (never a phantom test-red) and returns 1, which release.sh turns into an
# `exit 1`. Returns 0 when the box is (or becomes) quiet.
# Usage: kosmos_gate_or_abort <label> [max_wait_s] [poll_s]
kosmos_gate_or_abort() {
  local label="$1"
  shift
  if kosmos_wait_for_quiet_box "$label" "$@"; then
    return 0
  fi
  echo "aborting the cut: NOT running $label. The box is saturated by background LOAD, not by the change (the offending job is named above). This is not a test failure or a browser flake; reap that job and re-cut."
  return 1
}

# #2760 P1: the decision to OVERLAP the node suite (release.sh step 3) with the
# headless render checks (step 3b) -- running the suite at low priority (nice) so
# the render checks keep scheduling priority and their flake-rate stays
# near-serial. Kept HERE, not inline in release.sh, for the same reason
# kosmos_gate_or_abort is: the DECISION is the load-bearing half, so it is
# unit-tested rather than only bash -n'd. The overlap is the wall-time-vs-flake
# trade the cut's two-axis rule gates against, so it is OPT-IN (default serial)
# and, even when opted in, only fires on a box with genuine spare cycles.
#
# Same contracts as the rest of this file: errexit-safe (sourced under
# `set -euo pipefail`; callers invoke it in an `if` condition, where errexit is
# suspended for the whole body), bash 3.2 compatible (no bare `((...))`, float
# compares via awk), and fail-safe -- every unreadable input returns "serial".

# Minimum core count for the overlap. A 2-/4-core box has no spare cycles for the
# suite while the render checks keep priority, so it stays serial there. Default 8
# (so the real multi-core cut boxes qualify and small boxes do not), overridable by
# KOSMOS_CUT_PARALLEL_MIN_CORES. A non-integer/empty override is ignored (falls
# back to the default) so the decision below can never fault on a garbage value.
kosmos_cut_parallel_min_cores() {
  local v="${KOSMOS_CUT_PARALLEL_MIN_CORES:-}"
  case "$v" in *[!0-9]*|'') echo 8 ;; *) echo "$v" ;; esac
}

# The 1-min load strictly below which the overlap may fire. STRICTER than the entry
# gate's 1.5x cores (kosmos_cut_load_threshold): the overlap ADDS the suite's load
# on top of the render checks, so it needs genuine headroom, not merely "not
# saturated". Default 0.5 * cores, overridable by KOSMOS_CUT_PARALLEL_MAX_LOAD.
kosmos_cut_parallel_max_load() {
  if [ -n "${KOSMOS_CUT_PARALLEL_MAX_LOAD:-}" ]; then
    printf '%s\n' "$KOSMOS_CUT_PARALLEL_MAX_LOAD"
    return 0
  fi
  local ncpu
  ncpu="$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"
  # LC_ALL=C: sysctl prints a `.`-decimal, so the format must not follow a
  # comma-decimal LC_NUMERIC (same reason as kosmos_cut_load_threshold).
  LC_ALL=C awk -v n="$ncpu" 'BEGIN { printf "%.1f", n * 0.5 }'
}

# 0 (parallelize the suite with the render checks) ONLY when ALL hold:
#   1. the opt-in KOSMOS_CUT_PARALLEL=1 is set   (else the cut stays serial, so
#      this feature changes NO real cut until someone turns it on deliberately);
#   2. the core count is at or above the minimum  (spare cycles exist);
#   3. the 1-min load is STRICTLY below the max-load (genuine headroom; a box
#      exactly at the threshold has none).
# 1 (stay serial) otherwise. Fail-safe BY CONSTRUCTION: every unreadable input
# (no/garbage cores, an empty load, a missing awk) -> serial, because serial is
# the current, safe path. This is the OPPOSITE fail-direction from
# kosmos_load_over_threshold, which fails OPEN: there, blocking a cut on an
# unreadable load is the harm; here, falling back to serial is never harmful.
# release.sh calls this right after the entry gate has waited for a quiet box, so
# the load read here is of a known-quiet box.
kosmos_cut_parallel_ok() {
  [ "${KOSMOS_CUT_PARALLEL:-}" = 1 ] || return 1

  local ncpu min_cores
  ncpu="$(sysctl -n hw.ncpu 2>/dev/null || true)"
  case "$ncpu" in *[!0-9]*|'') return 1 ;; esac    # unreadable/garbage cores -> serial
  min_cores="$(kosmos_cut_parallel_min_cores)"
  # 10# forces base-10 so a (hypothetical) leading-zero core count cannot read as
  # octal and fault the arithmetic; both operands are already validated all-digit.
  [ "$((10#$ncpu))" -ge "$((10#$min_cores))" ] || return 1

  local load max_load
  load="$(kosmos_box_load_1min)"
  [ -n "$load" ] || return 1                        # unreadable load -> serial
  max_load="$(kosmos_cut_parallel_max_load)"
  # STRICTLY below: parallelize only if load < max_load. awk does the float compare
  # (bash 3.2 has none); a garbage/empty value -> 0, `0 < t` stays below only when
  # t>0, and a failed/absent awk exits non-zero -> the `|| return 1` -> serial.
  LC_ALL=C awk -v l="$load" -v t="$max_load" 'BEGIN { exit !(l+0 < t+0) }' || return 1
  return 0
}
