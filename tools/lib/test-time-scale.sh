#!/usr/bin/env bash
# #5727: ONE wall-clock time-scale for the whole test suite, computed ONCE at run
# start by tools/run-tests.sh and exported as KOSMOS_TEST_TIME_SCALE. The eventually()
# test helper (test-support/eventually.js) multiplies each poll budget by it, so a
# correct test does not false-red when the box is contended.
#
# WHY per-core, not raw load: a wall-clock budget false-reds when the test's work is
# descheduled, which happens under OVERSUBSCRIPTION (more runnable work than cores),
# not at some absolute load. A 1-minute load of 6 is half-busy on a 12-core box and
# 50% oversubscribed on a 4-core box. Measured (#5727): the class reds about one test
# per full run on a smaller Agent1s at load 4-9, while a 12-core Mortals at the SAME
# load is steady. So the scale keys on load/cores -- ~1 where there are spare cores,
# growing only as the box is oversubscribed -- which is correct on heterogeneous
# fleet hardware where one absolute-load threshold would be wrong on half the boxes.
#
# GUARDRAILS (#5727): floor 1 -- a budget is a liveness ceiling, never a performance
# floor, so the scale must NEVER shorten a timeout. Cap 4x -- past 4x a red is a real
# hang, not contention, and an unbounded scale would wait out a genuine deadlock. The
# knee is at HALF-subscription (load == 0.5 * cores): at or below it the scale is 1
# (identical to today); above it, linear to the 4x cap.
#
# bash 3.2 compatible (macOS system bash): no mapfile, float math via awk. Written
# errexit-safe so a caller under `set -e` is never aborted by a read that fails soft.

# kosmos_test_time_scale [load] [cores]
#   No args: load from kosmos_box_load_1min (cut-load-guard.sh, if sourced) else from
#   `sysctl -n vm.loadavg`, and cores from `sysctl -n hw.ncpu`. With args: use them --
#   the two seams the test drives directly. Prints a %.2f scale in [1.00, 4.00]. An
#   empty, zero, or non-numeric load yields 1.00 (fail-safe: if the box cannot be read,
#   do not scale), as does a core count below 1.
kosmos_test_time_scale() {
  local load="${1:-}" cores="${2:-}"
  if [ -z "$load" ]; then
    if command -v kosmos_box_load_1min >/dev/null 2>&1; then
      load="$(kosmos_box_load_1min)"
    else
      load="$(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}')"
    fi
  fi
  [ -z "$cores" ] && cores="$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"
  # LC_ALL=C: sysctl always prints a `.`-decimal load, so the compare and format must
  # not follow a comma-decimal LC_NUMERIC. `+0` coerces: a non-numeric load reads as 0
  # and collapses to the floor, never to a garbage scale.
  LC_ALL=C awk -v l="$load" -v n="$cores" 'BEGIN{
    if (l+0 <= 0 || n+0 < 1) { print "1.00"; exit }
    s = l / (n * 0.5);
    if (s < 1) s = 1;
    if (s > 4) s = 4;
    printf "%.2f\n", s;
  }'
}
