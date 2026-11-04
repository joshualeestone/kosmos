#!/bin/bash
# kosmos#7954: the board's Sweep loader on the iPhone (SweepLogic.swift), compiled for macOS and run, as run-orb.sh does.
# Pass a directory to compile the app sources from somewhere else (to run against a broken copy).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
xcrun swiftc -O -o "$out/sweep-logic-tests" "$src/SweepLogic.swift" "$here/sweep/main.swift"
"$out/sweep-logic-tests"
