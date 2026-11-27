#!/usr/bin/env bash
# kosmos#9213: fails when an iOS logic-test compile turns the optimizer back on. The suites compile with -Onone; a
# branch that started before that change can land a run*.sh with -O after it (run-updates.sh did). Usage, from the
# repo root or with the root as $1: ios/tools/check-logic-onone.sh [root]
# Exit 0: every swiftc line found is -Onone. Exit 1: a line turns an optimizer on (-O, -Osize, -Ounchecked, ...).
# Exit 2: nothing could be checked (a folder missing, grep failed, or no swiftc line found at all).
set -u
root="${1:-.}"
dirs=("$root/ios/LogicTests" "$root/ios/tools")
for d in "${dirs[@]}"; do
  [ -d "$d" ] || { echo "check-logic-onone: $d is missing, so nothing was checked"; exit 2; }
done
lines="$(grep -rnE --include='*.sh' --exclude='check-logic-onone.sh' 'swiftc' "${dirs[@]}")"; rc=$?
[ "$rc" -eq 0 ] || { echo "check-logic-onone: no swiftc line found (grep rc $rc), so nothing was checked"; exit 2; }
# Skip comment lines; on a compile line, any -O not followed by n (so not -Onone), after any whitespace, is an optimizer.
bad="$(printf '%s\n' "$lines" | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#' | grep -E '[[:space:]]-O([^n]|$)')"
if [ -n "$bad" ]; then
  printf '%s\n' "$bad"
  echo "check-logic-onone: compile iOS logic tests with -Onone, not an optimizer (kosmos#9213)"
  exit 1
fi
echo "check-logic-onone: $(printf '%s\n' "$lines" | grep -vcE '^[^:]+:[0-9]+:[[:space:]]*#') swiftc lines, all -Onone"
