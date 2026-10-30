#!/bin/bash
# kosmos#7609: the sample-board UI tests (no account, a Debug build) a CI runner can run, on one fresh simulator: the +
# panel (AttachMenuUITests), the room title check (RoomTitleUITests), the keyboard (KeyboardSlideUITests) and a long
# room opening on its newest post (RoomOpensAtNewestUITests, #7654). Run by the ios workflow's "ui tests (sample board)"
# job and by hand. Prints PASS, or FAIL with the failing check's own words.
#
#
#   ios/tools/ui-sample.sh [--keep]
#
# The newest iOS runtime the selected Xcode's simulator SDK can run, and the smallest iPhone it offers (the least room above the keyboard). The simulator is
# new for each run and deleted at the end, and so are the build and the results (--keep keeps them). SignInUITests is left
# out: it needs a real account (ios/tools/ui-signin.sh). The keyboard checks need the on-screen keyboard, so a run stops if
# the Simulator's hardware keyboard preference is on (a setting others on a shared Mac use; it is never changed here).
set -u
here="$(cd "$(dirname "$0")" && pwd)"
keep=0
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) keep=1; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "ui-sample: unknown argument $1" >&2; exit 2 ;;
  esac
done
# Each class and how many tests it holds: a filter that matches nothing also exits 0, so the count is what proves a run.
classes="AttachMenuUITests:6 RoomTitleUITests:2 KeyboardSlideUITests:3 RoomOpensAtNewestUITests:3"
# ChatOpensAtNewestUITests is left out of this run: its 260-message chat is too big for a CI runner to query (XCTest
# "Timed out while evaluating UI query" on both CI runs, iOS 26.5, while it passes here). Run it alone on a Mac:
#   TEST_RUNNER_KOSMOS_UI_PLUS=1 xcodebuild test ... -only-testing:KosmosUITests/ChatOpensAtNewestUITests
# KeyboardSlideUITests' third check (read higher up) used to wait on a clock and flake under load; Mona Lisa's #7627
# (kbrested-7609) replaced the wait with a marker, so all three run here again. It records the chat's scroll events
# (KOSMOS_SAMPLE_TRACE=1): when it fails, the last of them are printed below while the simulator still exists.
skip=""
if [ "$(defaults read com.apple.iphonesimulator ConnectHardwareKeyboard 2>/dev/null)" = 1 ]; then
  echo "FAIL  ui-sample: the Simulator's hardware keyboard is on (ConnectHardwareKeyboard), which hides the on-screen keyboard" >&2
  exit 1
fi
work="$(mktemp -d)"
udid=""
cleanup() {
  [ -n "$udid" ] && { xcrun simctl shutdown "$udid" >/dev/null 2>&1; xcrun simctl delete "$udid" >/dev/null 2>&1; }
  if [ "$keep" = 1 ]; then echo "kept: $work"; else rm -rf "${work:?}"; fi
}
trap cleanup EXIT
trap 'exit 143' TERM; trap 'exit 130' INT HUP
# Review 1: the newest runtime the SELECTED Xcode can run (its simulator SDK), not merely the newest installed: a CI image
# carries several Xcodes, and a runtime newer than the selected one's SDK is refused as a destination.
sdk="$(xcrun --sdk iphonesimulator --show-sdk-version 2>/dev/null)"
[ -n "$sdk" ] || echo "ui-sample: no iOS simulator SDK found; the runtime is not capped" >&2
cap="$(printf '%s' "${sdk:-999}" | tr . -)"
runtime="$(xcrun simctl list runtimes available | sed -n 's/.*\(com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9-]*\).*/\1/p' \
  | sort -V | awk -v cap="$cap" '{ v = $0; sub(/.*iOS-/, "", v); if (cmp(v, cap) <= 0) last = $0 }
      function cmp(a, b,   x, y, i, n) { n = split(a, x, "-"); split(b, y, "-"); for (i = 1; i <= 3; i++) { if (x[i] + 0 < y[i] + 0) return -1; if (x[i] + 0 > y[i] + 0) return 1 } return 0 }
      END { print last }')"
[ -n "$runtime" ] || { echo "FAIL  ui-sample: no iOS simulator runtime at or below the iphonesimulator SDK ${sdk:-?}" >&2; exit 1; }
# The smallest current phone this Xcode knows: the "e" model if there is one, else the newest plain iPhone.
types="$(xcrun simctl list devicetypes | sed -n 's/.*(\(com\.apple\.CoreSimulator\.SimDeviceType\.iPhone-[0-9]*e\{0,1\}\))$/\1/p' | sort -V)"
dtype="$(printf '%s\n' "$types" | grep -E 'iPhone-[0-9]+e$' | tail -1)"
[ -n "$dtype" ] || dtype="$(printf '%s\n' "$types" | grep -E 'iPhone-[0-9]+$' | tail -1)"
[ -n "$dtype" ] || { echo "FAIL  ui-sample: no iPhone simulator type found" >&2; exit 1; }
udid="$(xcrun simctl create "kosmos-ui-sample-$$" "$dtype" "$runtime")" || { echo "FAIL  ui-sample: no ${dtype##*.} simulator could be made on $runtime" >&2; exit 1; }
xcrun simctl boot "$udid" && xcrun simctl bootstatus "$udid" -b >/dev/null || { echo "FAIL  ui-sample: the simulator did not boot" >&2; exit 1; }
echo "ui-sample: ${dtype##*.} on ${runtime##*.}"
only=""; want=0
for c in $classes; do only="$only -only-testing:KosmosUITests/${c%%:*}"; want=$((want + ${c##*:})); done
log="$work/xcodebuild.log"
# shellcheck disable=SC2086  # $only and $skip are lists of separate arguments
( cd "$here/.." && TEST_RUNNER_KOSMOS_UI_PLUS=1 xcodebuild test -project Kosmos.xcodeproj -scheme Kosmos -destination "id=$udid" \
    $only $skip -derivedDataPath "$work/dd" -resultBundlePath "$work/result.xcresult" > "$log" 2>&1 )
rc=$?
ran="$(grep -c -E "^Test Case '-\[KosmosUITests\.[A-Za-z0-9_]+ [A-Za-z0-9_]+\]' (passed|failed)" "$log")"
failed="$(grep -c -E "^Test Case '-\[KosmosUITests\.[A-Za-z0-9_]+ [A-Za-z0-9_]+\]' failed" "$log")"
# Review 1: each class must have run exactly its own number, so one class gaining a test cannot hide another skipping one.
short=""
for c in $classes; do
  n="$(grep -c -E "^Test Case '-\[KosmosUITests\.${c%%:*} [A-Za-z0-9_]+\]' (passed|failed)" "$log")"
  [ "$n" -eq "${c##*:}" ] || short="$short ${c%%:*}=$n/${c##*:}"
done
if [ "$rc" -eq 0 ] && [ "$ran" -eq "$want" ] && [ "$failed" -eq 0 ] && [ -z "$short" ]; then
  echo "PASS  ui-sample: $ran of $want UI checks passed on a fresh simulator"
  exit 0
fi
why="$(sed -n 's/.*error: -\[KosmosUITests\.\([A-Za-z0-9_]*\) \([A-Za-z0-9_]*\)\] : /\1.\2: /p' "$log" | head -3)"
echo "FAIL  ui-sample: $ran of $want ran, $failed failed (xcodebuild exited $rc)${short:+; per class:$short}"
[ -n "$why" ] && printf '%s\n' "$why"
# kosmos#7609: as ui-keyboard.sh does, the read-higher-up check's scroll trace, read from the app's own data container
# before cleanup deletes the simulator (--keep keeps the log, not the simulator). The bundle id is the built app's.
if grep -q -E "^Test Case '-\[KosmosUITests\.KeyboardSlideUITests testReadHigherUpStaysWhereItWas\]' failed" "$log"; then
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
