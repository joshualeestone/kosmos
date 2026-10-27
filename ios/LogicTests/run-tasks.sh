#!/bin/bash
# Build and run the Tasks tab's logic tests (#7031) on this Mac, as run-settings.sh does for Settings: the UIKit-free
# files compile for macOS unchanged. Its own suite, so #7031 and Today (#7030) never edit the same test file. Pass a
# directory to compile the app sources from somewhere else (a deliberately broken copy, to prove the suite can fail).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
xcrun swiftc -O -o "$out/tasks-logic-tests" \
  "$src/PushBridgeLogic.swift" "$src/BoardLogic.swift" "$src/SignInLogic.swift" "$src/TodayLogic.swift" "$src/TasksLogic.swift" "$here/tasks/main.swift"
# The repo root, so the suite can read the board's own words (web/index.html).
KOSMOS_REPO="$here/../.." "$out/tasks-logic-tests"
