#!/bin/bash
# kosmos#4641 control: a change to install/setup.sh now reaches tools/test-install-static.sh on a PR.
# The untouched file must pass; a copy whose launchd restart no longer reads the choice first must fail on
# the "restart reads the choice again first" check (the check the 0.7.11 cut failed on, there because a
# correct change made it stale); a lib that has lost a check must fail the count; and a test-install.sh that
# no longer calls a group must fail, and so must one that calls a cut group after the release-gate exit,
# because the cut would then skip that group's checks. A check moved between groups fails its group's count, and a
# test-install.sh that loads the lib late or not at all fails.
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
{ sed '/^install_static_port_checks /d' "$HERE/tools/test-install.sh"; echo 'install_static_port_checks'; } > "$T/test-install-late.sh"
if KOSMOS_STATIC_INSTALL_SH="$T/test-install-late.sh" bash "$HERE/tools/test-install-static.sh" > "$T/late.log" 2>&1; then
  cat "$T/late.log"; echo "control: a cut group called after the release-gate exit still passed" >&2; exit 1
fi
grep -q "after the release-gate exit" "$T/late.log" || { cat "$T/late.log"; echo "control: it failed, but not on the gate position" >&2; exit 1; }
# A check moved from a cut group into the open group keeps the total, so only a per-group count sees it.
awk '/^  chk "the boundary value 65535 is accepted"/ { moved = $0; next } { print } /^install_static_open_checks\(\) \{/ { print moved }' "$HERE/tools/lib/install-static-checks.sh" > "$T/lib-moved.sh"
grep -q '^  chk "the boundary value 65535 is accepted"' "$T/lib-moved.sh" || { echo "control: the moved check is not in the copy, so the move tests nothing" >&2; exit 1; }
cmp -s "$HERE/tools/lib/install-static-checks.sh" "$T/lib-moved.sh" && { echo "control: moving a check changed nothing, so it tests nothing" >&2; exit 1; }
if KOSMOS_STATIC_LIB="$T/lib-moved.sh" bash "$HERE/tools/test-install-static.sh" > "$T/moved.log" 2>&1; then
  cat "$T/moved.log"; echo "control: a check moved out of a cut group still passed" >&2; exit 1
fi
grep -q "group port: 13 checks ran, expected 14" "$T/moved.log" || { cat "$T/moved.log"; echo "control: it failed, but not on the port group's count" >&2; exit 1; }
# A group the lib defines but the runner does not list would run nowhere on a PR.
{ cat "$HERE/tools/lib/install-static-checks.sh"; printf '%s\n' 'install_static_extra_checks() {' '  chk "a new group" "true"' '}'; } > "$T/lib-extra.sh"
if KOSMOS_STATIC_LIB="$T/lib-extra.sh" bash "$HERE/tools/test-install-static.sh" > "$T/extra.log" 2>&1; then
  cat "$T/extra.log"; echo "control: a lib with an unlisted group still passed" >&2; exit 1
fi
grep -q "the lib defines groups" "$T/extra.log" || { cat "$T/extra.log"; echo "control: it failed, but not on the unlisted group" >&2; exit 1; }
# test-install.sh loading the lib after its first group call, or not at all, would break the cut while this runner
# (which loads the lib itself) stayed green.
LOADLINE='source "$HERE/tools/lib/install-static-checks.sh"'
grep -qxF "$LOADLINE" "$HERE/tools/test-install.sh" || { echo "control: test-install.sh has no load line to move, so this tests nothing" >&2; exit 1; }
awk -v l="$LOADLINE" '$0 == l { next } { print } /^install_static_port_checks / { print l }' "$HERE/tools/test-install.sh" > "$T/test-install-lateload.sh"
if KOSMOS_STATIC_INSTALL_SH="$T/test-install-lateload.sh" bash "$HERE/tools/test-install-static.sh" > "$T/lateload.log" 2>&1; then
  cat "$T/lateload.log"; echo "control: a test-install.sh that loads the lib after a group call still passed" >&2; exit 1
fi
grep -q "loads the checks library at line" "$T/lateload.log" || { cat "$T/lateload.log"; echo "control: it failed, but not on the load position" >&2; exit 1; }
awk -v l="$LOADLINE" '$0 != l' "$HERE/tools/test-install.sh" > "$T/test-install-noload.sh"
if KOSMOS_STATIC_INSTALL_SH="$T/test-install-noload.sh" bash "$HERE/tools/test-install-static.sh" > "$T/noload.log" 2>&1; then
  cat "$T/noload.log"; echo "control: a test-install.sh that never loads the lib still passed" >&2; exit 1
fi
grep -q "does not load the checks library exactly once" "$T/noload.log" || { cat "$T/noload.log"; echo "control: it failed, but not on the missing load" >&2; exit 1; }
echo "install-static control: clean passes, a restart that skips the choice fails on its check, a lost check fails the count, a check moved between groups fails its group's count, a dropped group call fails, a cut group after the gate exit fails, a late or missing lib load fails, an unlisted group fails"
