#!/bin/bash
# Build and run the New task sheet's logic tests (#7078) on this Mac, as run-tasks.sh does for the Tasks tab: the
# UIKit-free files compile for macOS unchanged. Pass a directory to compile the app sources from somewhere else (a
# deliberately broken copy, to prove the suite can fail).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
xcrun swiftc -O -o "$out/newtask-logic-tests" \
  "$src/PushBridgeLogic.swift" "$src/BoardLogic.swift" "$src/TodayLogic.swift" "$src/TasksLogic.swift" \
  "$src/BoardRoom.swift" "$src/NewTaskLogic.swift" "$here/newtask/main.swift"
# The repo root, so the suite can read the board's own words (web/index.html).
KOSMOS_REPO="$here/../.." "$out/newtask-logic-tests"
