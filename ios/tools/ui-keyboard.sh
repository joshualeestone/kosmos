#!/bin/bash
# kosmos#7344: the chat's keyboard checks (KosmosUITests/KeyboardSlideUITests) on a fresh simulator, with taps, so the
# newest message staying above the message box can be measured on a Mac with no Simulator window. CI runs them with the
# other sample-board UI tests (ios/tools/ui-sample.sh, kosmos#7609); this runs these three alone. Prints PASS, or FAIL with
# the failing check's own words.
#
#   ios/tools/ui-keyboard.sh [--keep]
#
# Sample agents only (a Debug build): no account, no network, nothing of a person's. The simulator is new for each run
# and deleted at the end, and so are the build and the results (--keep keeps them, for a failure to be looked at).
# When the read-higher-up check fails, the chat's last scroll events are printed (they live in the simulator, not in --keep).
# The checks need the on-screen keyboard. A fresh simulator shows it (measured 10-30 with the Simulator preference
# ConnectHardwareKeyboard unset). That preference is shared by everyone on this Mac, so the runner never changes it: when
# it is on, the run stops and says so.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
keep=0
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) keep=1; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
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
udid="$(xcrun simctl create "kosmos-ui-keyboard-$$" com.apple.CoreSimulator.SimDeviceType.iPhone-17e "$runtime")" || { echo "FAIL  ui-keyboard: no iPhone-17e simulator could be made on $runtime" >&2; exit 1; }
xcrun simctl boot "$udid" && xcrun simctl bootstatus "$udid" -b >/dev/null || { echo "FAIL  ui-keyboard: the simulator did not boot" >&2; exit 1; }

log="$work/xcodebuild.log"
( cd "$here/.." && xcodebuild test -project Kosmos.xcodeproj -scheme Kosmos -destination "id=$udid" \
    -only-testing:KosmosUITests/KeyboardSlideUITests \
    -derivedDataPath "$work/dd" -resultBundlePath "$work/result.xcresult" > "$log" 2>&1 )
rc=$?
ran="$(grep -c -i -E "Test Case .-\[KosmosUITests\.KeyboardSlideUITests .* (passed|failed)" "$log")"
if [ "$rc" -eq 0 ] && [ "$ran" -eq 3 ] && ! grep -q -i -E "Test Case .-\[KosmosUITests\.KeyboardSlideUITests .* failed" "$log"; then
  echo "PASS  ui-keyboard: 3 of 3 keyboard checks passed on a fresh simulator"
  exit 0
fi
why="$(sed -n 's/.*error: -\[KosmosUITests\.[A-Za-z]* \([A-Za-z]*\)\] : /\1: /p' "$log" | head -1)"
echo "FAIL  ui-keyboard: ${why:-xcodebuild test exited $rc, $ran of 3 checks ran}"
# kosmos#7609: the read-higher-up check records the chat's scroll events; when that check failed, show the last of them
# while the simulator still exists (it is deleted on exit, so --keep does not keep them).
if grep -q -E "Test Case .-\[KosmosUITests\.KeyboardSlideUITests testReadHigherUpStaysWhereItWas\]. failed" "$log"; then
  app="$(find "$work/dd/Build/Products" -maxdepth 2 -name Kosmos.app -type d 2>/dev/null | head -1)"
  bid="$([ -n "$app" ] && /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist" 2>/dev/null)"
  data="$([ -n "$bid" ] && xcrun simctl get_app_container "$udid" "$bid" data 2>/dev/null)"
  if [ -n "$data" ] && [ -s "$data/Documents/trace.txt" ]; then
    echo "  the chat's last scroll events (read-higher-up check):"
    tail -60 "$data/Documents/trace.txt" | sed 's/^/    /'
  else
    echo "  (no scroll trace from the app)"
  fi
fi
[ "$keep" = 1 ] || echo "  (run again with --keep to keep the log and result)"
exit 1
