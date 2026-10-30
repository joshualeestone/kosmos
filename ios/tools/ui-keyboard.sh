#!/bin/bash
# kosmos#7344: the chat's keyboard checks (KosmosUITests/KeyboardSlideUITests) on a fresh simulator, with taps, so the
# newest message staying above the message box can be measured on a Mac with no Simulator window. No CI job runs the UI
# tests target; this is how they are run. Prints PASS, or FAIL with the failing check's own words.
#
#   ios/tools/ui-keyboard.sh [--keep]
#
# Sample agents only (a Debug build): no account, no network, nothing of a person's. The simulator is new for each run
# and deleted at the end, and so are the build and the results (--keep keeps them, for a failure to be looked at).
# The checks need the on-screen keyboard. A fresh simulator shows it (measured 10-30 with the Simulator preference
# ConnectHardwareKeyboard unset). That preference is shared by everyone on this Mac, so the runner never changes it: when
# it is on, the run stops and says so.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
keep=0
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) keep=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "ui-keyboard: unknown argument $1" >&2; exit 2 ;;
  esac
done

if [ "$(defaults read com.apple.iphonesimulator ConnectHardwareKeyboard 2>/dev/null)" = 1 ]; then
  echo "FAIL  ui-keyboard: the Simulator's hardware keyboard is on (ConnectHardwareKeyboard), which hides the on-screen keyboard; this runner does not change a setting other people on this Mac use" >&2
  exit 1
fi
work="$(mktemp -d)"
udid=""
cleanup() {
  [ -n "$udid" ] && { xcrun simctl shutdown "$udid" >/dev/null 2>&1; xcrun simctl delete "$udid" >/dev/null 2>&1; }
  if [ "$keep" = 1 ]; then echo "kept: $work"; else rm -rf "$work"; fi
}
trap cleanup EXIT
trap 'exit 143' TERM; trap 'exit 130' INT HUP

runtime="$(xcrun simctl list runtimes available | sed -n 's/.*\(com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9-]*\).*/\1/p' | sort -V | tail -1)"
[ -n "$runtime" ] || { echo "FAIL  ui-keyboard: no iOS simulator runtime installed" >&2; exit 1; }
# The smallest current phone: the least room above the keyboard.
udid="$(xcrun simctl create "kosmos-ui-keyboard-$$" com.apple.CoreSimulator.SimDeviceType.iPhone-17e "$runtime")" || { echo "FAIL  ui-keyboard: no simulator could be made" >&2; exit 1; }
xcrun simctl boot "$udid" && xcrun simctl bootstatus "$udid" -b >/dev/null || { echo "FAIL  ui-keyboard: the simulator did not boot" >&2; exit 1; }

log="$work/xcodebuild.log"
( cd "$here/.." && xcodebuild test -project Kosmos.xcodeproj -scheme Kosmos -destination "id=$udid" \
    -only-testing:KosmosUITests/KeyboardSlideUITests \
    -derivedDataPath "$work/dd" -resultBundlePath "$work/result.xcresult" > "$log" 2>&1 )
rc=$?
ran="$(grep -c -i -E "Test Case .*KeyboardSlideUITests.* (passed|failed)" "$log")"
if [ "$rc" -eq 0 ] && [ "$ran" -eq 3 ] && ! grep -q -i -E "Test Case .*KeyboardSlideUITests.* failed" "$log"; then
  echo "PASS  ui-keyboard: 3 of 3 keyboard checks passed on a fresh simulator"
  exit 0
fi
why="$(sed -n 's/.*error: -\[KosmosUITests\.[A-Za-z]* \([A-Za-z]*\)\] : /\1: /p' "$log" | head -1)"
echo "FAIL  ui-keyboard: ${why:-xcodebuild test exited $rc, $ran of 3 checks ran}"
[ "$keep" = 1 ] || echo "  (run again with --keep to keep the log and result)"
exit 1
