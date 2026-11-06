#!/bin/bash
# Build and run pull to refresh's logic tests (kosmos#8078) on this Mac.
# Pass a directory to compile the app sources from somewhere else (a deliberately broken copy, proving it can fail).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
xcrun swiftc -O -o "$out/pullrefresh-logic-tests" "$src/PullRefreshLogic.swift" "$here/pullrefresh/main.swift"
"$out/pullrefresh-logic-tests"
