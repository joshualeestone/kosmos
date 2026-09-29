#!/bin/bash
# kosmos#4641 control: tools/test-install-static.sh goes red on the break that failed the 0.7.11 cut.
# A copy of install/setup.sh whose launchd restart no longer reads the choice first must fail the
# "restart reads the choice again first" check; the untouched file must pass. Both arms, so a runner
# that cannot fail (or cannot pass) is caught.
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
echo "install-static control: clean passes, the 0.7.11 break fails on its check"
