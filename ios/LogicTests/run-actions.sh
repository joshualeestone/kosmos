#!/bin/bash
# Build and run the notification actions' logic tests (#7017) on this Mac, as run.sh does for the rest of the app.
# A separate suite so #7017 and the chat slices never edit the same test file. Pass a directory to compile the app
# sources from somewhere else (a deliberately broken copy, to prove the suite can fail).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
xcrun swiftc -O -o "$out/action-logic-tests" \
  "$src/PushBridgeLogic.swift" "$src/PushRegistrar.swift" "$src/ShellLogic.swift" \
  "$src/NotificationCategories.swift" "$src/BoardLogic.swift" "$src/BoardClient.swift" "$src/SessionKeychain.swift" \
  "$src/NotificationActionLogic.swift" "$src/../KosmosNotice/NoticeLogic.swift" "$here/actions/main.swift"
"$out/action-logic-tests"
