#!/bin/bash
# Takes the iOS App Store screenshots from the REAL iPhone app in the iOS simulator (#6262), not from the board in a
# desktop WebKit (shoot.sh). The app is built with KOSMOS_STORE_SHOTS, which only this script sets: it opens the
# address in KOSMOS_SHOTS_URL instead of Kosmos+ and skips the notification prompt (ContentView.swift,
# AppDelegate.swift). That address is ios/store/shots-proxy.js in front of a throwaway board seeded with the clean
# store team (docs/browser-checks/mobile-shots.js --keep --data store), so no real account, agent or Mac appears.
#
# Two sizes, light and dark, the same four screens in store order:
#   6.3/  iPhone 17          1206x2622  App Store Connect's REQUIRED iPhone size (Dynamic Island, medium display)
#   6.9/  iPhone 17 Pro Max  1320x2868  the large size; optional, shown on the biggest phones
# filed as screenshots/<size>-<theme>/NN-name.png with no alpha channel. The status bar reads 9:41, full signal and
# battery, as Apple's own pictures do.
#
# Needs: Xcode with an iOS simulator runtime (xcodebuild -downloadPlatform iOS), Python with Pillow, the pw-runtime
# for mobile-shots.js, and this Mac on a network (the app reaches the board at this Mac's network address, which
# is what gives the board its phone-app layout; the proxy listens there only while this runs, and answers only
# requests that come from this Mac).
# It is a heavy run: it refuses unless tools/heavy-gate.sh is clear.
#
# Usage: NODE_PATH=$HOME/work/pw-runtime/node_modules ios/store/shoot-app.sh
# Ends with one VERDICT: line; no verdict line means it did not finish.
set -u -o pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/ios-app-shots-XXXXXX")"
board_pid=""; proxy_pid=""; sims=()
cleanup() {
  [ -n "$proxy_pid" ] && kill "$proxy_pid" 2>/dev/null
  # SIGINT is the board's Ctrl-C: it stops and deletes its data.
  # SIGINT is what mobile-shots.js listens for (its own handler; a background job's default would ignore it).
  # Wait up to 20s for it to delete its data, then make sure it is gone.
  if [ -n "$board_pid" ] && kill -INT "$board_pid" 2>/dev/null; then
    for _ in $(seq 1 40); do kill -0 "$board_pid" 2>/dev/null || break; sleep 0.5; done
    kill -TERM "$board_pid" 2>/dev/null
  fi
  for s in "${sims[@]+"${sims[@]}"}"; do xcrun simctl shutdown "$s" >/dev/null 2>&1; xcrun simctl delete "$s" >/dev/null 2>&1; done
  rm -rf "$work"
}
trap cleanup EXIT
fail() { echo "VERDICT: FAIL ($1)"; exit 1; }

bash "$repo/tools/heavy-gate.sh" --quiet || fail "the heavy-run gate is not clear"
runtime="$(xcrun simctl list runtimes 2>/dev/null | grep -o 'com.apple.CoreSimulator.SimRuntime.iOS-[0-9-]*' | sort -V | tail -1)"
[ -n "$runtime" ] || fail "no iOS simulator runtime; install one with xcodebuild -downloadPlatform iOS"
sdk="$(xcodebuild -showsdks 2>/dev/null | grep -o 'iphonesimulator[0-9.]*' | sort -V | tail -1)"
[ -n "$sdk" ] || fail "no iphonesimulator SDK"

echo "== build (Debug, $sdk, KOSMOS_STORE_SHOTS)"
xcodebuild -project "$repo/ios/Kosmos.xcodeproj" -target Kosmos -sdk "$sdk" -configuration Debug CODE_SIGNING_ALLOWED=NO \
  SYMROOT="$work/sym" OBJROOT="$work/obj" 'SWIFT_ACTIVE_COMPILATION_CONDITIONS=DEBUG KOSMOS_STORE_SHOTS' build \
  > "$work/build.log" 2>&1 || { grep -E 'error:' "$work/build.log" | head -5; fail "the app did not build"; }
app="$work/sym/Debug-iphonesimulator/Kosmos.app"
grep -a -q KOSMOS_SHOTS_URL "$app/Kosmos" || fail "the build does not carry the screenshot switch"

# --remote: its leak guard reads the same four screens first, in the phone layout the app shows.
echo "== throwaway board (mobile-shots.js --keep --data store --remote)"
order=(home push-landing agent-chat project-room)
node "$repo/docs/browser-checks/mobile-shots.js" --out "$work/check" --data store --remote --sizes iphone15 --engines webkit \
  --themes light --screens "$(IFS=,; echo "${order[*]}")" --keep > "$work/board.log" 2>&1 &
board_pid=$!
base=""
for _ in $(seq 1 240); do
  base="$(grep -o 'stays up at http://127\.0\.0\.1:[0-9]*' "$work/board.log" | grep -o 'http://.*')" && [ -n "$base" ] && break
  kill -0 "$board_pid" 2>/dev/null || break
  sleep 1
done
if grep -q 'LEAK GUARD' "$work/board.log"; then fail "mobile-shots.js's leak guard stopped the board run"; fi
[ -n "$base" ] || { tail -5 "$work/board.log"; fail "the throwaway board did not come up"; }

lan="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
[ -n "$lan" ] || fail "this Mac has no network address for the app to reach the board at"
node "$here/shots-proxy.js" "$lan" "$base" "$repo" > "$work/proxy.log" 2>&1 &
proxy_pid=$!
for _ in $(seq 1 20); do grep -q '^listening' "$work/proxy.log" && break; sleep 0.5; done
grep -q '^listening' "$work/proxy.log" || fail "the proxy did not start"
url="$(sed -n 's/^listening //p' "$work/proxy.log" | head -1)/"

# Each screen is an address, as a tapped notification opens one (the board's own deep links). The agents' board
# names are the store set's (mobile-shots.js STORE_AGENTS: Cleo asks, Dana chats).
path_for() {
  case "$1" in
    home) echo "" ;;
    push-landing) echo "?tab=detail&agent=cleo" ;;
    agent-chat) echo "?tab=detail&agent=dana" ;;
    project-room) echo "?tab=projects&project=launchthespringcatalogue" ;;
  esac
}

devices=("6.3:com.apple.CoreSimulator.SimDeviceType.iPhone-17" "6.9:com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max")
mkdir -p "$work/raw"
for d in "${devices[@]}"; do
  size="${d%%:*}"; type="${d#*:}"
  udid="$(xcrun simctl create "kosmos-store-shots-$size" "$type" "$runtime")" || fail "could not create a $size simulator"
  sims+=("$udid")
  xcrun simctl boot "$udid" && xcrun simctl bootstatus "$udid" -b >/dev/null || fail "the $size simulator did not boot"
  xcrun simctl install "$udid" "$app" || fail "could not install the app on $size"
  xcrun simctl status_bar "$udid" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100
  for theme in light dark; do
    xcrun simctl ui "$udid" appearance "$theme"
    for name in "${order[@]}"; do
      xcrun simctl terminate "$udid" io.kosmos.app >/dev/null 2>&1
      SIMCTL_CHILD_KOSMOS_SHOTS_URL="$url$(path_for "$name")" xcrun simctl launch "$udid" io.kosmos.app >/dev/null \
        || fail "the app did not launch on $size"
      sleep "${SHOTS_SETTLE:-10}"   # the board's first polls, and the agent page's 4s reveal hold
      xcrun simctl io "$udid" screenshot "$work/raw/$size--$theme--$name.png" >/dev/null 2>&1 || fail "no screenshot of $name"
      echo "shot $size $theme $name"
    done
  done
done

if grep -q '^REFUSED' "$work/proxy.log"; then fail "something other than this Mac reached the proxy; nothing filed"; fi
if grep -q '^LEAK' "$work/proxy.log"; then grep '^LEAK' "$work/proxy.log" | head -5; fail "the proxy's leak guard refused an answer; nothing filed"; fi

python3 - "$work/raw" "$here/screenshots" "${order[@]}" <<'PY' || fail "filing the shots failed"
import sys, os, glob
from PIL import Image
raw, dest, order = sys.argv[1], sys.argv[2], sys.argv[3:]
want = {'6.3': (1206, 2622), '6.9': (1320, 2868)}
sets = [(s, t) for s in want for t in ('light', 'dark')]
stage = os.path.join(raw, 'filed')
for size, theme in sets:
    os.makedirs(os.path.join(stage, f'{size}-{theme}'))
    for i, name in enumerate(order, 1):
        im = Image.open(os.path.join(raw, f'{size}--{theme}--{name}.png'))
        if im.size != want[size]:
            sys.exit(f'{size} {theme} {name} is {im.size}, not {want[size]}')
        im.convert('RGB').save(os.path.join(stage, f'{size}-{theme}', f'{i:02d}-{name}.png'), optimize=True)
# Only once every shot was written: the committed sets are replaced as a whole, including the old light/ and dark/.
for old in glob.glob(os.path.join(dest, '*', '*.png')):
    os.remove(old)
for d in glob.glob(os.path.join(dest, '*')):
    if os.path.isdir(d) and not os.listdir(d):
        os.rmdir(d)
for size, theme in sets:
    d = os.path.join(dest, f'{size}-{theme}')
    os.makedirs(d, exist_ok=True)
    for f in sorted(os.listdir(os.path.join(stage, f'{size}-{theme}'))):
        os.replace(os.path.join(stage, f'{size}-{theme}', f), os.path.join(d, f))
        print('filed', f'screenshots/{size}-{theme}/{f}', Image.open(os.path.join(d, f)).size)
PY
echo "VERDICT: PASS"
