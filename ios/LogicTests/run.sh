#!/bin/bash
# Build and run the iOS logic tests (#718) on this Mac. The iOS app's
# UIKit-free files compile for macOS unchanged, so their logic is proven
# without an iOS simulator runtime. Pass a directory to compile the app sources
# from somewhere else (used to run the suite against a deliberately broken copy,
# proving it can fail).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
# -Onone, not -O (kosmos#9213): the tests run in seconds and the optimizer was a third of this
# step (the compile went from 80 s to 52 s on this Mac; the step took up to 13 min on a slow CI runner).
# The optimized app is still built by the Release and archive steps in ios.yml. Every run*.sh in this
# folder compiles the same way.
xcrun swiftc -Onone -o "$out/push-logic-tests" \
  "$src/PushBridgeLogic.swift" "$src/PushRegistrar.swift" "$src/ShellLogic.swift" \
  "$src/NotificationCategories.swift" "$src/BoardLogic.swift" "$src/TodayLogic.swift" "$src/TasksLogic.swift" "$src/BoardClient.swift" "$src/SessionKeychain.swift" "$src/SignInLogic.swift" "$src/DownloadLogic.swift" \
  "$src/../KosmosNotice/NoticeLogic.swift" "$here/main.swift"
"$out/push-logic-tests"
