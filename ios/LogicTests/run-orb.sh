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
# Drawn again here and compared byte for byte, so a change to OrbLogic cannot leave the launch screen's orb behind.
mkdir "$out/launch"
xcrun swiftc -O -o "$out/render-launch-orb" "$src/OrbLogic.swift" "$here/../tools/launch-orb/main.swift"
"$out/render-launch-orb" "$out/launch" 120 >/dev/null
set_dir="$src/Assets.xcassets/LaunchOrb.imageset"
stale=0
for f in "$out"/launch/*.png; do
  if ! cmp -s "$f" "$set_dir/$(basename "$f")"; then echo "STALE  $(basename "$f"): run ios/tools/render-launch-orb.sh"; stale=1; fi
done
n=$(find "$out/launch" -name '*.png' | wc -l | tr -d ' ')
[ "$n" -eq 6 ] || { echo "VERDICT: FAIL (launch orb: drew $n PNGs, expected 6)"; exit 1; }
[ "$stale" -eq 0 ] || { echo "VERDICT: FAIL (launch orb is stale)"; exit 1; }
echo "ok   the launch screen's orb matches OrbLogic (6 PNGs, byte for byte)"
