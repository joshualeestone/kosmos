#!/bin/bash
# Build and run the Community ready logic tests (kosmos#8959 slice D1d3a) on this Mac, as run.sh does for the rest of the app: the
# UIKit-free files compile for macOS unchanged. A separate suite so this slice never edits the Settings suite, which
# other slices edit. Pass a directory to compile the app sources from somewhere else (a deliberately broken copy, to
# prove the suite can fail).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
xcrun swiftc -Onone -o "$out/ready-logic-tests" \
  "$src/PushBridgeLogic.swift" "$src/PushRegistrar.swift" "$src/ShellLogic.swift" \
  "$src/NotificationCategories.swift" "$src/BoardLogic.swift" "$src/SignInLogic.swift" "$src/TodayLogic.swift" "$src/TasksLogic.swift" "$src/BoardClient.swift" "$src/SessionKeychain.swift" \
  "$src/SettingsLogic.swift" "$src/ReadyLogic.swift" "$here/ready/main.swift"
# The repo root, so the suite can read the board's own words and the computer's kinds.
KOSMOS_REPO="$here/../.." "$out/ready-logic-tests"
