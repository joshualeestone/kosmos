#!/usr/bin/env bash
# Test for #5934: tools/release.sh refuses a cut with KOSMOS_TEST_PART (anything but all) or
# KOSMOS_TEST_PART_LOCAL exported, before the bump, because step 3's `yarn test` inherits them and
# would run only part of the suite. Extracts the guard and runs it, as test-cut-rerun-guard.sh does
# for #5932, under release.sh's own shell options. KOSMOS_SHELL_SHARD is refused too. CI sets all three for
# its own matrix, so every arm unsets them first, then sets its own.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
R="$REPO/tools/release.sh"

fails=0
ok()  { echo "  PASS  $1"; }
bad() { echo "  FAIL  $1"; fails=$((fails + 1)); }

# Anchored on the guard's if line, so a mutant that loosens a test inside it is still found and judged below.
g="$(grep -n '^if { \[ -n "\${KOSMOS_TEST_PART[^}]*}" \]' "$R" | head -1 | cut -d: -f1)"
bump="$(grep -n '^step "== 2\. ' "$R" | head -1 | cut -d: -f1)"
suite="$(grep -n 'yarn test >"\$_suite_log"' "$R" | head -1 | cut -d: -f1)"
[ -n "$g" ] && [ -n "$bump" ] && [ -n "$suite" ] && [ "$g" -lt "$bump" ] && [ "$bump" -lt "$suite" ] \
  && ok "release.sh refuses KOSMOS_TEST_PART before the bump and before step 3's suite ($g < $bump < $suite)" \
  || bad "#5934 guard missing or misplaced (guard=$g bump=$bump suite=$suite)"

# Never run release.sh from line 1: with no anchor the arms below are skipped and counted as a failure.
if [ -n "$g" ]; then
  SRC="$(sed -n "${g},\$p" "$R" | sed '/^fi$/q')"
  case "$SRC" in *fi) ok "guard extracted whole, through its fi" ;; *) bad "guard has no fi line to extract through" ;; esac

  # run <expected rc> <label> [VAR=value ...]: all three variables are unset first, then the arm's own are set.
  run() {
    want="$1"; label="$2"; shift 2
    out="$(env -u KOSMOS_TEST_PART -u KOSMOS_TEST_PART_LOCAL -u KOSMOS_SHELL_SHARD -u KOSMOS_SHELL_PLATFORM "$@" bash -c "set -euo pipefail; $SRC" 2>&1)"; rc=$?
    if [ "$rc" = "$want" ]; then
      if [ "$want" = 1 ]; then
        case "$out" in *"A cut always tests the whole suite (#5934)"*) ok "$label" ;; *) bad "$label: refused without the #5934 message: $out" ;; esac
      else
        ok "$label"
      fi
    else
      bad "$label (rc=$rc, wanted $want): $out"
    fi
  }
  run 1 "KOSMOS_TEST_PART=node with KOSMOS_TEST_PART_LOCAL=1 (the card's case) refuses" KOSMOS_TEST_PART=node KOSMOS_TEST_PART_LOCAL=1
  run 1 "KOSMOS_TEST_PART=shell alone refuses" KOSMOS_TEST_PART=shell
  run 1 "KOSMOS_TEST_PART=node alone refuses (a leftover GITHUB_ACTIONS=true would honour it)" KOSMOS_TEST_PART=node
  run 1 "an EMPTY KOSMOS_TEST_PART refuses" KOSMOS_TEST_PART=
  run 1 "KOSMOS_TEST_PART_LOCAL=1 alone refuses" KOSMOS_TEST_PART_LOCAL=1
  run 1 "an EMPTY KOSMOS_TEST_PART_LOCAL refuses" KOSMOS_TEST_PART_LOCAL=
  run 1 "KOSMOS_TEST_PART=all with KOSMOS_TEST_PART_LOCAL=1 still refuses" KOSMOS_TEST_PART=all KOSMOS_TEST_PART_LOCAL=1
  run 1 "KOSMOS_SHELL_SHARD=1/2 alone refuses (run-tests.sh would stop the cut after the bump)" KOSMOS_SHELL_SHARD=1/2
  run 1 "an EMPTY KOSMOS_SHELL_SHARD refuses" KOSMOS_SHELL_SHARD=
  run 1 "#6791: KOSMOS_SHELL_PLATFORM=linux alone refuses (run-tests.sh would stop the cut after the bump)" KOSMOS_SHELL_PLATFORM=linux
  run 1 "#6791: an EMPTY KOSMOS_SHELL_PLATFORM refuses" KOSMOS_SHELL_PLATFORM=
  run 0 "KOSMOS_TEST_PART=all alone is allowed (the whole suite)" KOSMOS_TEST_PART=all
  run 0 "a clean environment passes (control)"
else
  bad "#5934 no guard line to extract; its behaviour arms were skipped"
fi

echo ""
if [ "$fails" -eq 0 ]; then
  echo "test-cut-testpart-guard-5934: ALL PASS"
  exit 0
else
  echo "test-cut-testpart-guard-5934: $fails FAILED"
  exit 1
fi
