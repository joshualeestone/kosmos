#!/bin/bash
# Build and run the Connections logic tests (kosmos#8959 slice D2b1) on this Mac, as run.sh does for the rest of the app:
# the UIKit-free files compile for macOS unchanged. A separate suite so this slice never edits another slice's suite.
# Pass a directory to compile the app sources from somewhere else (a deliberately broken copy, to prove it can fail).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
xcrun swiftc -Onone -o "$out/conn-logic-tests" \
  "$src/PushBridgeLogic.swift" "$src/PushRegistrar.swift" "$src/ShellLogic.swift" \
  "$src/NotificationCategories.swift" "$src/BoardLogic.swift" "$src/SignInLogic.swift" "$src/TodayLogic.swift" "$src/TasksLogic.swift" "$src/BoardClient.swift" "$src/SessionKeychain.swift" \
  "$src/SettingsLogic.swift" "$src/ConnLogic.swift" "$here/conn/main.swift"
# The repo root, so the suite can read the board's own code.
KOSMOS_REPO="$here/../.." "$out/conn-logic-tests"
