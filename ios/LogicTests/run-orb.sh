#!/bin/bash
# kosmos#7896: the KOSMOS orb's geometry (OrbLogic.swift), compiled for macOS and run, as run.sh does for the other
# UIKit-free files. Pass a directory to compile the app sources from somewhere else (to run against a broken copy);
# it must hold OrbLogic.swift. (The launch screen's checks moved to run-sweep.sh with kosmos#7945's follow-up: the
# launch mark is the Sweep ring now, not the orb.)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
xcrun swiftc -O -o "$out/orb-logic-tests" "$src/OrbLogic.swift" "$here/orb/main.swift"
"$out/orb-logic-tests"
