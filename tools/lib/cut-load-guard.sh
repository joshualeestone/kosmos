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
# KOSMOS_FAKE_LOAD overrides it (tests, and a machine with no sysctl).
kosmos_box_load_1min() {
  if [ -n "${KOSMOS_FAKE_LOAD:-}" ]; then
    printf '%s\n' "$KOSMOS_FAKE_LOAD"
    return 0
  fi
  sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}' || true
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
