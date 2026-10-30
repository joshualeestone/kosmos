#!/bin/bash
# kosmos#7344: the chat's keyboard checks (KosmosUITests/KeyboardSlideUITests) on a fresh simulator, with taps, so the
# newest message staying above the message box can be measured on a Mac with no Simulator window. No CI job runs the UI
# tests target; this is how they are run. Prints PASS, or FAIL with the failing check's own words.
#
#   ios/tools/ui-keyboard.sh [--keep]
#
# Sample agents only (a Debug build): no account, no network, nothing of a person's. The simulator is new for each run
# and deleted at the end, and so are the build and the results (--keep keeps them, for a failure to be looked at).
# The checks need the on-screen keyboard, which a simulator can hide while it takes a Mac's own keyboard. The run sets
# the Simulator preference ConnectHardwareKeyboard off (it is shared by everyone on this Mac) and puts it back as it was
# at the end; with it off, the keyboard showed in every measured run (10-30). One run at a time: a second run waits for
# the lock rather than reading the first run's value as the one to put back.
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

# Puts the shared preference back to a value `defaults read` gave (1 or 0), or removes it when that was empty (unset).
# `-bool` takes only true or false.
restore_kbd() {
  if [ -n "$1" ]; then defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool "$([ "$1" = 1 ] && echo true || echo false)"
  else defaults delete com.apple.iphonesimulator ConnectHardwareKeyboard >/dev/null 2>&1; fi
}

# One run at a time. The lock directory holds the run's pid and the preference's value from before the run ("was"), so a
# run that died without its cleanup (SIGKILL, a crash) is found by its dead pid, and the next run puts its "was" back
# before taking the lock over. A lock with no pid yet is a run that is just starting, unless it is over two minutes old.
lock="$HOME/.cache/kosmos-ui-keyboard.lock"
mkdir -p "$HOME/.cache"
acquired=0
for _ in $(seq 1 120); do
  if mkdir "$lock" 2>/dev/null; then acquired=1; break; fi
  holder="$(cat "$lock/pid" 2>/dev/null)"
  if { [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; } || { [ -z "$holder" ] && [ -n "$(find "$lock" -maxdepth 0 -mmin +2 2>/dev/null)" ]; }; then
    [ -f "$lock/was" ] && restore_kbd "$(cat "$lock/was")"
    echo "ui-keyboard: took over a lock left by a run that is gone (pid ${holder:-none})" >&2
    rm -rf "$lock"; continue
  fi
  sleep 5
done
[ "$acquired" = 1 ] || { echo "FAIL  ui-keyboard: another run holds $lock (10 min waited)" >&2; exit 1; }
echo $$ > "$lock/pid"
was_kbd="$(defaults read com.apple.iphonesimulator ConnectHardwareKeyboard 2>/dev/null)" || was_kbd=""
printf '%s' "$was_kbd" > "$lock/was"
work="$(mktemp -d)"
udid=""
cleanup() {
  [ -n "$udid" ] && { xcrun simctl shutdown "$udid" >/dev/null 2>&1; xcrun simctl delete "$udid" >/dev/null 2>&1; }
  restore_kbd "$was_kbd"
  if [ "$keep" = 1 ]; then echo "kept: $work"; else rm -rf "$work"; fi
  rm -rf "$lock"
}
trap cleanup EXIT
trap 'exit 143' TERM; trap 'exit 130' INT HUP

defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool false
runtime="$(xcrun simctl list runtimes | sed -n 's/.*\(com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9-]*\).*/\1/p' | tail -1)"
[ -n "$runtime" ] || { echo "FAIL  ui-keyboard: no iOS simulator runtime installed" >&2; exit 1; }
# The smallest current phone: the least room above the keyboard.
udid="$(xcrun simctl create "kosmos-ui-keyboard-$$" com.apple.CoreSimulator.SimDeviceType.iPhone-17e "$runtime")" || { echo "FAIL  ui-keyboard: no simulator could be made" >&2; exit 1; }
xcrun simctl boot "$udid" && xcrun simctl bootstatus "$udid" -b >/dev/null || { echo "FAIL  ui-keyboard: the simulator did not boot" >&2; exit 1; }

log="$work/xcodebuild.log"
( cd "$here/.." && xcodebuild test -project Kosmos.xcodeproj -scheme Kosmos -destination "id=$udid" \
    -only-testing:KosmosUITests/KeyboardSlideUITests \
    -derivedDataPath "$work/dd" -resultBundlePath "$work/result.xcresult" > "$log" 2>&1 )
rc=$?
ran="$(grep -c -E "Test Case .*KeyboardSlideUITests.* (passed|failed)" "$log")"
if [ "$rc" -eq 0 ] && [ "$ran" -eq 3 ] && ! grep -q -E "Test Case .*KeyboardSlideUITests.* failed" "$log"; then
  echo "PASS  ui-keyboard: 3 of 3 keyboard checks passed on a fresh simulator"
  exit 0
fi
why="$(sed -n 's/.*error: -\[KosmosUITests\.[A-Za-z]* \([A-Za-z]*\)\] : /\1: /p' "$log" | head -1)"
echo "FAIL  ui-keyboard: ${why:-xcodebuild test exited $rc, $ran of 3 checks ran}"
[ "$keep" = 1 ] || echo "  (run again with --keep to keep the log and result)"
exit 1
