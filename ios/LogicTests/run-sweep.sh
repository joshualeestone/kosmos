#!/bin/bash
# kosmos#7954: the board's Sweep loader on the iPhone (SweepLogic.swift), compiled for macOS and run, as run-orb.sh does.
# It reads web/index.html from KOSMOS_REPO, so ios.board-parity-7084.test.js runs it in the board's own suite too.
# Pass a directory to compile the app sources from somewhere else (to run against a broken copy).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
xcrun swiftc -O -o "$out/sweep-logic-tests" "$src/SweepLogic.swift" "$here/sweep/main.swift"
KOSMOS_REPO="$here/../.." "$out/sweep-logic-tests"
