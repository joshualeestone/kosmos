#!/bin/bash
# kosmos#7896: the KOSMOS orb's geometry (OrbLogic.swift), compiled for macOS and run, as run.sh does for the other
# UIKit-free files. Pass a directory to compile the app sources from somewhere else (to run against a broken copy).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
xcrun swiftc -O -o "$out/orb-logic-tests" "$src/OrbLogic.swift" "$here/orb/main.swift"
"$out/orb-logic-tests"

# kosmos#7945: the launch screen's orb (LaunchOrb.imageset) is drawn from OrbLogic by ios/tools/render-launch-orb.sh.
# Drawn again here and compared, decoded, with the committed PNGs (pixels, with a small tolerance, not file bytes), so
# a change to OrbLogic cannot leave the launch screen's orb behind.
xcrun swiftc -O -o "$out/render-launch-orb" "$src/OrbLogic.swift" "$here/../tools/launch-orb/main.swift"
if "$out/render-launch-orb" --check "$src/Assets.xcassets/LaunchOrb.imageset" 120; then
  echo "ok   the launch screen's orb matches OrbLogic (6 PNGs)"
else
  echo "VERDICT: FAIL (the launch screen's orb is stale)"; exit 1
fi
