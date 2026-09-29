#!/bin/bash
# kosmos#4641: the install checks that need no install, run on every PR (the shell suite).
#
# tools/test-install.sh runs only at cut time (release.sh step 4b), because it installs the built bundle
# into a sandbox. Some of its checks only read files in this repo, and one of them went stale in a merge
# (#4466 changed a line of install/setup.sh a grep looked for) that no PR, local run or CI had run: the
# 0.7.11 cut failed at 4b. Those checks live in tools/lib/install-static-checks.sh; test-install.sh still
# calls them at the cut, and this runs them all here, where a merge would see them.
#
#   bash tools/test-install-static.sh
#
# KOSMOS_STATIC_SETUP and KOSMOS_STATIC_LIB point at other copies of setup.sh and the lib; only the control
# (tools/test-install-static-control-4641.sh) uses them.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP="${KOSMOS_STATIC_SETUP:-$HERE/install/setup.sh}"
LIB="${KOSMOS_STATIC_LIB:-$HERE/tools/lib/install-static-checks.sh}"
EXPECTED=23   # the static checks in the lib; a group that loses one must not pass quietly

PASS=0; FAIL=0
chk() {
  if eval "$2"; then PASS=$((PASS + 1)); echo "PASS  $1"
  else FAIL=$((FAIL + 1)); echo "FAIL  $1"; fi
}
# shellcheck source=lib/install-static-checks.sh
source "$LIB"
install_static_all

echo "install-static: $PASS passed, $FAIL failed"
if [ "$((PASS + FAIL))" -ne "$EXPECTED" ]; then
  echo "install-static: $((PASS + FAIL)) checks ran, expected $EXPECTED (a check was added or lost: update EXPECTED with it)" >&2
  exit 1
fi
# The cut runs these through tools/test-install.sh, one call per group where its checks sat: each group must be
# called there exactly once, or the cut would quietly run fewer of them than this does.
for g in install_static_port_checks install_static_update_checks install_static_board_off_checks install_static_open_checks; do
  n=$(grep -cE "^${g}([[:space:]]|$)" "$HERE/tools/test-install.sh" || true)
  if [ "$n" != 1 ]; then echo "install-static: tools/test-install.sh calls $g $n times, not once (the cut would not run its checks as before)" >&2; exit 1; fi
done
[ "$FAIL" -eq 0 ]
