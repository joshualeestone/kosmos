#!/bin/bash
# kosmos#7945: redraws ios/Kosmos/Assets.xcassets/LaunchSweep.imageset from SweepLogic (20 pt, SweepDots' default side;
# light and dark, 1x-3x). Usage: ios/tools/render-launch-sweep.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
ios=$(cd "$here/.." && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
xcrun swiftc -O -o "$out/render" "$ios/Kosmos/SweepLogic.swift" "$here/launch-sweep/main.swift"
"$out/render" "$ios/Kosmos/Assets.xcassets/LaunchSweep.imageset" 20
