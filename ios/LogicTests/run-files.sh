#!/bin/bash
# Build and run the Files logic tests (kosmos#7679: an agent's and a project's Files on the phone) on this Mac, as run.sh
# does for the rest of the app: the UIKit-free files compile for macOS unchanged. Its own suite, like the agent page's.
# Pass a directory to compile the app sources from somewhere else (a deliberately broken copy, to prove it can fail).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
xcrun swiftc -O -o "$out/files-logic-tests" \
  "$src/PushBridgeLogic.swift" "$src/BoardLogic.swift" "$src/SignInLogic.swift" "$src/BoardRoom.swift" "$src/FilesLogic.swift" \
  "$here/files/main.swift"
# The repo root, so the suite can read the board's own words (web/index.html).
KOSMOS_REPO="$here/../.." "$out/files-logic-tests"
