#!/bin/bash
# Build and run the task page's logic tests (kosmos#7074) on this Mac, as run-room.sh does for a project's room.
# Pass a directory to compile the app sources from somewhere else (a deliberately broken copy, proving it can fail).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
xcrun swiftc -O -o "$out/taskpage-logic-tests" \
  "$src/PushBridgeLogic.swift" "$src/PushRegistrar.swift" "$src/ShellLogic.swift" \
  "$src/NotificationCategories.swift" "$src/BoardLogic.swift" "$src/TodayLogic.swift" "$src/TasksLogic.swift" "$src/BoardClient.swift" "$src/SessionKeychain.swift" \
  "$src/BoardRoom.swift" "$src/TaskPageLogic.swift" "$src/TaskPageModel.swift" "$here/taskpage/main.swift"
"$out/taskpage-logic-tests"
