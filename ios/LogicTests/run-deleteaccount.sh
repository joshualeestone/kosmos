#!/bin/bash
# Build and run the native delete-account logic tests (kosmos#8959 slice C) on this Mac, as run.sh does for the rest of
# the app: the UIKit-free files compile for macOS unchanged. Pass a directory to compile the app sources from somewhere
# else (a deliberately broken copy, to prove the suite can fail).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "${out:?}"' EXIT
xcrun swiftc -O -o "$out/deleteaccount-logic-tests" \
  "$src/SignInLogic.swift" "$src/DeleteAccountLogic.swift" "$here/deleteaccount/main.swift"
"$out/deleteaccount-logic-tests"
