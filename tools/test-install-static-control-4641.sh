#!/bin/bash
# kosmos#4641 control: a change to install/setup.sh now reaches tools/test-install-static.sh on a PR.
# The untouched file must pass; a copy whose launchd restart no longer reads the choice first must fail on
# the "restart reads the choice again first" check (the check the 0.7.11 cut failed on, there because a
# correct change made it stale); a lib that has lost a check must fail the count; and a test-install.sh that
# no longer calls a group must fail, because the cut would then skip that group's checks.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "${T:?}"' EXIT

bash "$HERE/tools/test-install-static.sh" > "$T/clean.log" 2>&1 || { cat "$T/clean.log"; echo "control: the untouched setup.sh did not pass" >&2; exit 1; }

sed 's/_kosmos_board_decide/_kosmos_board_chosen/g' "$HERE/install/setup.sh" > "$T/setup.sh"
cmp -s "$HERE/install/setup.sh" "$T/setup.sh" && { echo "control: the break changed nothing, so it tests nothing" >&2; exit 1; }
if KOSMOS_STATIC_SETUP="$T/setup.sh" bash "$HERE/tools/test-install-static.sh" > "$T/broken.log" 2>&1; then
  cat "$T/broken.log"; echo "control: a setup.sh whose restart skips the choice still passed" >&2; exit 1
fi
grep -q "^FAIL  the launchd bootstrap's restart reads the choice again first" "$T/broken.log" \
  || { cat "$T/broken.log"; echo "control: it failed, but not on the check the break targets" >&2; exit 1; }
sed '/^  chk "the boundary value 65535 is accepted"/d' "$HERE/tools/lib/install-static-checks.sh" > "$T/lib.sh"
cmp -s "$HERE/tools/lib/install-static-checks.sh" "$T/lib.sh" && { echo "control: removing a check changed nothing, so it tests nothing" >&2; exit 1; }
if KOSMOS_STATIC_LIB="$T/lib.sh" bash "$HERE/tools/test-install-static.sh" > "$T/lost.log" 2>&1; then
  cat "$T/lost.log"; echo "control: a lib that lost a check still passed" >&2; exit 1
fi
grep -q "checks ran, expected" "$T/lost.log" || { cat "$T/lost.log"; echo "control: it failed, but not on the count" >&2; exit 1; }
sed '/^install_static_board_off_checks /d' "$HERE/tools/test-install.sh" > "$T/test-install.sh"
cmp -s "$HERE/tools/test-install.sh" "$T/test-install.sh" && { echo "control: removing a group call changed nothing, so it tests nothing" >&2; exit 1; }
if KOSMOS_STATIC_INSTALL_SH="$T/test-install.sh" bash "$HERE/tools/test-install-static.sh" > "$T/nocall.log" 2>&1; then
  cat "$T/nocall.log"; echo "control: a test-install.sh that dropped a group call still passed" >&2; exit 1
fi
grep -q "calls install_static_board_off_checks 0 times" "$T/nocall.log" || { cat "$T/nocall.log"; echo "control: it failed, but not on the group call" >&2; exit 1; }
echo "install-static control: clean passes, a restart that skips the choice fails on its check, a lost check fails the count, a dropped group call fails"
