#!/bin/bash
# kosmos#7559: a real iPhone sign-in, typed on a fresh simulator by the KosmosUITests target, so a phone sign-in can be
# measured on a Mac with no Simulator window (Agent1s has none). Prints PASS, or FAIL with the step that failed.
#
#   ios/tools/ui-signin.sh --email <address> --totp <secrets-map target> [--code-cmd <path>] [--keep]
#
# The account is a TEST account, never a person's: its address, and its authenticator's otpauth URL read from the
# secrets map (secrets-map.sh value <target>). The address goes to the test as TEST_RUNNER_ environment; the URL only as
# a 0600 file in the run's own folder (never the environment, the repo, a log or the command line). The emailed code comes from --code-cmd (default ~/.local/bin/kosmos-signin-code, Vivienne's
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
# An authenticator is filed either as its otpauth:// URL or as the bare base32 secret (Kitty's cloudrun1029, 10-29); a
# bare one is the standard Kosmos+ kind (SHA1, 6 digits, 30 s), so it is wrapped as that URL here, never printed.
case "$otpauth" in
  otpauth://*) ;;
  *) if printf '%s' "$otpauth" | grep -qE '^[A-Z2-7]{16,}=*$'; then otpauth="otpauth://totp/Kosmos?secret=$otpauth&algorithm=SHA1&digits=6&period=30"
     else unset otpauth; echo "FAIL  ui-signin: the secrets map has no authenticator (an otpauth URL or a base32 secret) for $totp_target" >&2; exit 1; fi ;;
esac

work="$(mktemp -d)"; chmod 700 "$work"
codefile="$work/code.txt"
udid=""
cleanup() {
  [ -n "$udid" ] && { xcrun simctl shutdown "$udid" >/dev/null 2>&1; xcrun simctl delete "$udid" >/dev/null 2>&1; }
  [ -n "${fetch_pid:-}" ] && kill "$fetch_pid" 2>/dev/null
  # The result bundle can hold the test environment (compressed, so a search cannot show it does not): delete it.
  if [ "$keep" = 1 ]; then echo "kept: $work (it may hold the account's secrets: delete it when done)"; else rm -rf "$work"; fi
}
trap cleanup EXIT
trap 'exit 143' TERM; trap 'exit 130' INT HUP   # review 1: a signal still cleans up

runtime="$(xcrun simctl list runtimes | sed -n 's/.*\(com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9-]*\).*/\1/p' | tail -1)"
[ -n "$runtime" ] || { echo "FAIL  ui-signin: no iOS simulator runtime installed" >&2; exit 1; }
udid="$(xcrun simctl create "kosmos-ui-signin-$$" com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro "$runtime")" || { echo "FAIL  ui-signin: no simulator could be made" >&2; exit 1; }
xcrun simctl boot "$udid" && xcrun simctl bootstatus "$udid" -b >/dev/null || { echo "FAIL  ui-signin: the simulator did not boot" >&2; exit 1; }

log="$work/xcodebuild.log"
# Review 1: built first, so the code's window (about ten minutes) starts with the run, never before a clean build.
( cd "$here/.." && xcodebuild build-for-testing -project Kosmos.xcodeproj -scheme Kosmos -destination "id=$udid" \
    -derivedDataPath "$work/dd" > "$work/build.log" 2>&1 ) || { echo "FAIL  ui-signin: the app and its UI tests did not build ($(grep -m1 ' error:' "$work/build.log" | cut -c1-160))"; exit 1; }

# Review 1: the authenticator URL goes to the test as a 0600 file, never in an environment: an environment value is
# copied into xcodebuild's build settings and every child it starts, where a build phase or a log can print it. (This Mac
# has one user account, so the file mode guards nothing a same-user process could not already read from the secrets map,
# as PigeonPete measured 10-29; and this macOS's ps shows no process's environment at all, measured the same day.)
totpfile="$work/totp"; ( umask 077; printf '%s' "$otpauth" > "$totpfile" ); unset otpauth

# The place in the inbox's history BEFORE the test sends the code, so the fetch sees only what arrives after it.
fetch_pid=""
if [ -x "$code_cmd" ]; then
  place="$("$code_cmd" anchor 2>/dev/null)" || place=""
  if [ -n "$place" ]; then
    # Review 1: the fetcher itself, in the background with its own pid (killed at the end), writing the six digits
    # straight to the file the test reads; the test takes only six digits from it.
    "$code_cmd" code "$email" "$place" 300 > "$codefile" 2>/dev/null &
    fetch_pid=$!
  else echo "ui-signin: the code fetcher gave no place in the inbox; put the emailed code in $codefile by hand" >&2; fi
else
  echo "ui-signin: no code fetcher at $code_cmd; when the code is emailed, put its six digits in $codefile (4 minutes)" >&2
fi

( cd "$here/.." && TEST_RUNNER_KOSMOS_UI_EMAIL="$email" TEST_RUNNER_KOSMOS_UI_TOTP_FILE="$totpfile" TEST_RUNNER_KOSMOS_UI_CODE_FILE="$codefile" \
  xcodebuild test-without-building -project Kosmos.xcodeproj -scheme Kosmos -destination "id=$udid" \
    -only-testing:KosmosUITests/SignInUITests/testSignInReachesTheBoard \
    -derivedDataPath "$work/dd" -resultBundlePath "$work/result.xcresult" > "$log" 2>&1 )
rc=$?
if [ "$rc" -eq 0 ] && grep -q "Test Case .*testSignInReachesTheBoard.* passed" "$log"; then
  echo "PASS  ui-signin: $email signed in on a fresh simulator and the board loaded"
  exit 0
fi
# The first failing step's own words (the test names each step), never the environment.
# The test's own failing assertion, and the last step it reached (each step is named "STEP <name>").
why="$(sed -n 's/.*error: -\[KosmosUITests\.[A-Za-z]* [A-Za-z]*\] : //p' "$log" | head -1)"
reached="$(sed -n 's/.* STEP \([a-z ]*\)$/\1/p' "$log" | tail -1)"
[ -n "$reached" ] && why="at the step \"$reached\": ${why:-it stopped}"
echo "FAIL  ui-signin: ${why:-xcodebuild test exited $rc}"
[ "$keep" = 1 ] || echo "  (run again with --keep to keep the log, screenshots and result)"
exit 1
