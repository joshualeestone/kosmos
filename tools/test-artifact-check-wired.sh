#!/bin/bash
# The outside-in artifact audit is a cut step, not a memory (ownership note,
# 2026-08-26): release.sh must run tools/kosmos-artifact-check.sh after the
# flip (after 9d, before 10) against the served bytes, and fail the cut on red.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
[ -x tools/kosmos-artifact-check.sh ] && ok "tools/kosmos-artifact-check.sh is present and executable" || bad "tools/kosmos-artifact-check.sh missing or not executable"
bash -n tools/kosmos-artifact-check.sh && ok "the check parses" || bad "the check does not parse"
# ⚠️ MATCHED ON THE HEADER, NOT ON `echo`. These read '^echo "== 9d\.' and went
# red the moment the phase headers started going through a `step` helper that
# records which phase a cut died in -- three assertions failing on a rename of
# the EMITTER, while the steps themselves were untouched and in the right order.
_hdr() { grep -nE '^(echo|step) "== '"$1"'\.' tools/release.sh | cut -d: -f1; }
L9d=$(_hdr 9d); L9e=$(_hdr 9e); L10=$(_hdr 10)
[ -n "$L9e" ] && ok "release.sh has a 9e step" || bad "release.sh has no 9e step"
[ -n "$L9d" ] && [ -n "$L9e" ] && [ -n "$L10" ] && [ "$L9d" -lt "$L9e" ] && [ "$L9e" -lt "$L10" ] && ok "9e sits after 9d (served bytes verified) and before 10 (the local board)" || bad "9e is not between 9d and 10 ($L9d/$L9e/$L10)"
sed -n "${L9e:-0},${L10:-0}p" tools/release.sh | grep -q 'kosmos-artifact-check.sh" --repo "\$MAIN_REPO"' && ok "9e runs the vendored check with --repo \$MAIN_REPO (the shared checkout, which has the site beside it)" || bad "9e must pass --repo \$MAIN_REPO: the frozen build tree has no ../chaoskosmos-site and the /setup check goes UNPROVEN (0.5.65)"
sed -n "${L9e:-0},${L10:-0}p" tools/release.sh | grep -q '^  exit 1' && ok "a red audit exits the cut non-zero" || bad "a red audit does not fail the cut"
# the served-bytes constraint: the check must fetch from the site base, never read the staged tree
grep -q 'KOSMOS_SITE_BASE' tools/kosmos-artifact-check.sh && ! grep -q 'BUILD_ROOT\|STAGE/' tools/kosmos-artifact-check.sh && ok "the check reads the served site, not the staged tree" || bad "the check references the staged tree"
[ "$FAILS" -eq 0 ] && echo "artifact check wired: all hold" || { echo "artifact check wired: $FAILS failed"; exit 1; }
