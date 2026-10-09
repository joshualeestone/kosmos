#!/usr/bin/env bash
# Test for tools/lib/test-time-scale.sh (#5727): the one wall-clock time-scale the
# runner computes from the box's load-per-core and the eventually() helper applies.
# Pins the guardrails -- floor 1 (never shortens a budget), cap 4x, the half-subscription
# knee -- and the fail-safe (an unreadable/garbage load scales by 1, never wildly).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
. "$REPO/tools/lib/test-time-scale.sh"

fails=0
ok()  { echo "  ok    $1"; }
bad() { echo "  FAIL  $1"; fails=$((fails + 1)); }

check() { # desc load cores expected
  local desc="$1" load="$2" cores="$3" want="$4" got
  got="$(kosmos_test_time_scale "$load" "$cores")"
  if [ "$got" = "$want" ]; then ok "$desc: ($load, $cores) -> $got"; else bad "$desc: ($load, $cores) -> got '$got', want '$want'"; fi
}

# Floor and fail-safe: nothing ever scales below 1.00.
check "zero load"            0     12 1.00
check "garbage load"        abc    12 1.00
check "Mortals at load 4.48" 4.48  12 1.00   # 2*4.48/12 = 0.75, below the knee
check "knee (half-subscribed)" 6    12 1.00   # 2*6/12 = 1.00 exactly
check "cores < 1 guard"      8      0 1.00

# The ramp above the knee, linear to the cap.
check "12-core, load 9"      9     12 1.50   # 2*9/12
check "12-core, load 12"     12    12 2.00   # 2*12/12
check "4-core knee"          2      4 1.00   # 2*2/4 = 1.00
check "4-core, load 4"       4      4 2.00   # 2*4/4
check "4-core at the cap"    8      4 4.00   # 2*8/4 = 4.00 exactly

# The cap: a saturated small box never scales past 4x (a red there is a hang).
check "4-core over the cap"  12     4 4.00   # 2*12/4 = 6, capped
check "huge load, capped"    999    8 4.00

# The KOSMOS_FAKE_LOAD seam (via kosmos_box_load_1min) on the no-arg path: cores come
# from this box's sysctl, so assert only the floor/cap ends, which hold on any box.
. "$REPO/tools/lib/cut-load-guard.sh"
got="$(KOSMOS_FAKE_LOAD=99999 kosmos_test_time_scale)"
if [ "$got" = "4.00" ]; then ok "seam: a saturating fake load caps at 4.00 ($got)"; else bad "seam: fake load 99999 -> got '$got', want 4.00"; fi
got="$(KOSMOS_FAKE_LOAD=0.01 kosmos_test_time_scale)"
if [ "$got" = "1.00" ]; then ok "seam: a near-idle fake load floors at 1.00 ($got)"; else bad "seam: fake load 0.01 -> got '$got', want 1.00"; fi

# No-arg, live box: whatever it reads, the result is a %.2f in [1.00, 4.00].
got="$(kosmos_test_time_scale)"
case "$got" in
  [1-3].[0-9][0-9]|4.00) ok "no-arg live read is a well-formed scale in [1.00, 4.00] ($got)" ;;
  *) bad "no-arg live read is out of range or malformed: '$got'" ;;
esac

echo ""
if [ "$fails" -eq 0 ]; then
  echo "test-time-scale-5727: ALL PASS"
  exit 0
else
  echo "test-time-scale-5727: $fails FAILED"
  exit 1
fi
