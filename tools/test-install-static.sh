#!/bin/bash
# kosmos#4641: the install checks that need no install, run on every PR (the shell suite).
#
# tools/test-install.sh runs only at cut time (release.sh step 4b), because it installs the built bundle
# into a sandbox. Some of its checks only read files in this repo, and one of them went stale in a merge
# (#4466 changed a line of install/setup.sh a grep looked for) that no PR, local run or CI had run: the
# 0.7.11 cut failed at 4b. Those checks live in tools/lib/install-static-checks.sh; test-install.sh still
# calls them where they sat (three groups before its release-gate exit, so the cut runs them; the open group
# after it, as before, so only a full run does), and this runs them all here, where a merge would see them.
#
#   bash tools/test-install-static.sh
#
# KOSMOS_STATIC_SETUP, KOSMOS_STATIC_LIB and KOSMOS_STATIC_INSTALL_SH point at other copies of setup.sh, the lib
# and test-install.sh; only the control
# (tools/test-install-static-control-4641.sh) uses them.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP="${KOSMOS_STATIC_SETUP:-$HERE/install/setup.sh}"
LIB="${KOSMOS_STATIC_LIB:-$HERE/tools/lib/install-static-checks.sh}"
INSTALL_SH="${KOSMOS_STATIC_INSTALL_SH:-$HERE/tools/test-install.sh}"
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
# test-install.sh calls each group exactly once, where its checks sat; the port, update and board-off groups
# must come before its release-gate exit (the `if` on KOSMOS_INSTALL_GATE), or the cut would quietly stop
# running them while this stayed green. The open group has always sat after it (a full run only).
gate=$(grep -nE '^if \[ "\$\{KOSMOS_INSTALL_GATE:-0\}" = 1 \]; then$' "$INSTALL_SH" | cut -d: -f1 || true)
if [ "$(printf '%s\n' "$gate" | grep -c .)" != 1 ]; then echo "install-static: $INSTALL_SH has no single release-gate exit to measure the calls against" >&2; exit 1; fi
for g in install_static_port_checks install_static_update_checks install_static_board_off_checks install_static_open_checks; do
  n=$(grep -cE "^${g}([[:space:]]|$)" "$INSTALL_SH" || true)
  if [ "$n" != 1 ]; then echo "install-static: $INSTALL_SH calls $g $n times, not once (the cut would not run its checks as before)" >&2; exit 1; fi
  at=$(grep -nE "^${g}([[:space:]]|$)" "$INSTALL_SH" | cut -d: -f1)
  if [ "$g" != install_static_open_checks ] && [ "$at" -gt "$gate" ]; then
    echo "install-static: $INSTALL_SH calls $g at line $at, after the release-gate exit at line $gate (the cut would skip it)" >&2; exit 1
  fi
done
[ "$FAIL" -eq 0 ]
