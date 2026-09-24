#!/bin/bash
# Build and run the push bridge logic tests (#718) on this Mac. The iOS app's
# Foundation-only files compile for macOS unchanged, so their logic is proven
# without an iOS simulator runtime. Pass a directory to compile the app sources
# from somewhere else (used to run the suite against a deliberately broken copy,
# proving it can fail).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
xcrun swiftc -O -o "$out/push-logic-tests" \
  "$src/PushBridgeLogic.swift" "$src/PushRegistrar.swift" "$here/main.swift"
"$out/push-logic-tests"
