#!/bin/bash
# Build and run the agent page's logic tests (kosmos#7267: Profile | AI Settings) on this Mac, as run.sh does for the
# rest of the app: the UIKit-free files compile for macOS unchanged. Its own suite, like the room's and the Tasks tab's.
# Pass a directory to compile the app sources from somewhere else (a deliberately broken copy, to prove it can fail).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
xcrun swiftc -O -o "$out/agentinfo-logic-tests" \
  "$src/PushBridgeLogic.swift" "$src/BoardLogic.swift" "$src/AgentInfoLogic.swift" "$here/agentinfo/main.swift"
# The repo root, so the suite can read the board's own words (web/index.html).
KOSMOS_REPO="$here/../.." "$out/agentinfo-logic-tests"
