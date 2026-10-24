#!/bin/bash
# Build and run the Settings tab's logic tests (#7010) on this Mac, as run.sh does for the rest of the app: the
# UIKit-free files compile for macOS unchanged. A separate suite so #7010 and the chat slice (#7008) never edit the
# same test file. Pass a directory to compile the app sources from somewhere else (a deliberately broken copy, to
# prove the suite can fail).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
xcrun swiftc -O -o "$out/settings-logic-tests" \
  "$src/PushBridgeLogic.swift" "$src/PushRegistrar.swift" "$src/ShellLogic.swift" \
  "$src/NotificationCategories.swift" "$src/BoardLogic.swift" "$src/TodayLogic.swift" "$src/TasksLogic.swift" "$src/BoardClient.swift" "$src/SessionKeychain.swift" \
  "$src/SettingsLogic.swift" "$here/settings/main.swift"
# The repo root, so the suite can read the board's own words and the computer's kinds.
KOSMOS_REPO="$here/../.." "$out/settings-logic-tests"
