#!/bin/bash
# kosmos#7945: redraws ios/Kosmos/Assets.xcassets/LaunchOrb.imageset from OrbLogic (120 pt, light and dark, 1x-3x).
# Usage: ios/tools/render-launch-orb.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
ios=$(cd "$here/.." && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
xcrun swiftc -O -o "$out/render" "$ios/Kosmos/OrbLogic.swift" "$here/launch-orb/main.swift"
"$out/render" "$ios/Kosmos/Assets.xcassets/LaunchOrb.imageset" 120
