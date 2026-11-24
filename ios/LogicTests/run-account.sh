#!/bin/bash
# Build and run the native Kosmos+ account screen's logic tests (kosmos#8959 slice B1a) on this Mac, as run-settings.sh
# does for Settings: the UIKit-free file compiles for macOS unchanged. Pass a directory to compile the app sources from
# somewhere else (a deliberately broken copy, to prove the suite can fail).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
xcrun swiftc -O -o "$out/account-logic-tests" "$src/AccountLogic.swift" "$here/account/main.swift"
"$out/account-logic-tests"
