#!/bin/bash
# kosmos#9091: Hop's rules (HopLogic.swift), compiled for macOS and run, as run-orb.sh does. Pass a directory to compile
# the app sources from somewhere else (to run against a broken copy); it must hold HopLogic.swift and KDots.swift.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
xcrun swiftc -Onone -o "$out/hop-logic-tests" "$src/HopLogic.swift" "$src/KDots.swift" "$here/hop/main.swift"
"$out/hop-logic-tests" "$here/hop/k-dots.json"
