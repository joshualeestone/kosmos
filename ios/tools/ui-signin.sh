#!/bin/bash
# kosmos#7559: a real iPhone sign-in, typed on a fresh simulator by the KosmosUITests target, so a phone sign-in can be
# measured on a Mac with no Simulator window (Agent1s has none). Prints PASS, or FAIL with the step that failed.
#
#   ios/tools/ui-signin.sh --email <address> --totp <secrets-map target> [--code-cmd <path>] [--keep]
#
# The account is a TEST account, never a person's: its address, and its authenticator's otpauth URL read from the
# secrets map (secrets-map.sh value <target>). Both go to the test as TEST_RUNNER_ environment only, never into the repo,
# a log or the command line. The emailed code comes from --code-cmd (default ~/.local/bin/kosmos-signin-code, Vivienne's
# Gmail history fetcher): `<cmd> anchor` prints a place in the inbox's history, taken before the code is sent, and
# `<cmd> code <address> <place> <seconds>` prints the six digits once that address's code arrives. Without a fetcher the
# runner says where to put the code by hand, and the test waits for it (four minutes).
# The simulator is new for each run (an empty keychain, as a new phone) and is deleted at the end; so are the build and
# the test results, which can hold the environment (--keep keeps them, for a failure to be looked at).
set -u
here="$(cd "$(dirname "$0")" && pwd)"
email="" totp_target="" code_cmd="${KOSMOS_SIGNIN_CODE_CMD:-$HOME/.local/bin/kosmos-signin-code}" keep=0
while [ $# -gt 0 ]; do
  case "$1" in
    --email) email="${2:-}"; shift 2 ;;
    --totp) totp_target="${2:-}"; shift 2 ;;
    --code-cmd) code_cmd="${2:-}"; shift 2 ;;
    --keep) keep=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "ui-signin: unknown argument $1" >&2; exit 2 ;;
  esac
done
case "$email" in *@*) ;; *) echo "ui-signin: --email needs the test account's address" >&2; exit 2 ;; esac
[ -n "$totp_target" ] || { echo "ui-signin: --totp needs the secrets-map target of the account's authenticator" >&2; exit 2; }
otpauth="$(secrets-map.sh value "$totp_target" 2>/dev/null)" || otpauth=""
case "$otpauth" in otpauth://*) ;; *) echo "FAIL  ui-signin: the secrets map has no authenticator URL for $totp_target" >&2; exit 1 ;; esac

work="$(mktemp -d)"; chmod 700 "$work"
codefile="$work/code.txt"
udid=""
cleanup() {
  [ -n "$udid" ] && { xcrun simctl shutdown "$udid" >/dev/null 2>&1; xcrun simctl delete "$udid" >/dev/null 2>&1; }
  [ -n "${fetch_pid:-}" ] && kill "$fetch_pid" 2>/dev/null
  if [ "$keep" = 1 ]; then echo "kept: $work"; else rm -rf "$work"; fi
}
trap cleanup EXIT

runtime="$(xcrun simctl list runtimes | sed -n 's/.*\(com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9-]*\).*/\1/p' | tail -1)"
[ -n "$runtime" ] || { echo "FAIL  ui-signin: no iOS simulator runtime installed" >&2; exit 1; }
udid="$(xcrun simctl create "kosmos-ui-signin-$$" com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro "$runtime")" || { echo "FAIL  ui-signin: no simulator could be made" >&2; exit 1; }
xcrun simctl boot "$udid" && xcrun simctl bootstatus "$udid" -b >/dev/null || { echo "FAIL  ui-signin: the simulator did not boot" >&2; exit 1; }

# The place in the inbox's history BEFORE the test sends the code, so the fetch sees only what arrives after it.
fetch_pid=""
if [ -x "$code_cmd" ]; then
  place="$("$code_cmd" anchor 2>/dev/null)" || place=""
  if [ -n "$place" ]; then
    ( c="$("$code_cmd" code "$email" "$place" 300 2>/dev/null)" && case "$c" in [0-9][0-9][0-9][0-9][0-9][0-9]) printf '%s\n' "$c" > "$codefile" ;; esac ) &
    fetch_pid=$!
  else echo "ui-signin: the code fetcher gave no place in the inbox; put the emailed code in $codefile by hand" >&2; fi
else
  echo "ui-signin: no code fetcher at $code_cmd; when the code is emailed, put its six digits in $codefile (4 minutes)" >&2
fi

log="$work/xcodebuild.log"
( cd "$here/.." && TEST_RUNNER_KOSMOS_UI_EMAIL="$email" TEST_RUNNER_KOSMOS_UI_TOTP="$otpauth" TEST_RUNNER_KOSMOS_UI_CODE_FILE="$codefile" \
  xcodebuild test -project Kosmos.xcodeproj -scheme Kosmos -destination "id=$udid" \
    -only-testing:KosmosUITests/SignInUITests/testSignInReachesTheBoard \
    -derivedDataPath "$work/dd" -resultBundlePath "$work/result.xcresult" > "$log" 2>&1 )
rc=$?
unset otpauth
if [ "$rc" -eq 0 ] && grep -q "Test Case .*testSignInReachesTheBoard.* passed" "$log"; then
  echo "PASS  ui-signin: $email signed in on a fresh simulator and the board loaded"
  exit 0
fi
# The first failing step's own words (the test names each step), never the environment.
why="$(grep -o 'STEP [a-z ]*: .*' "$log" | head -1)"
[ -n "$why" ] || why="$(grep -E 'error:|failed' "$log" | grep -v -i 'totp\|otpauth' | head -1)"
echo "FAIL  ui-signin: ${why:-xcodebuild test exited $rc}"
[ "$keep" = 1 ] || echo "  (run again with --keep to keep the log, screenshots and result)"
exit 1
