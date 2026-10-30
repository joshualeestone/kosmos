#!/bin/bash
# Build and run the composer extras' logic tests (kosmos#7268: the emoji button and dictation) on this Mac, as the
# other suites do. Pass a directory to compile the app sources from somewhere else (a broken copy, to prove it can fail).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/../Kosmos}"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
xcrun swiftc -O -o "$out/composer-logic-tests" "$src/ComposerLogic.swift" "$here/composer/main.swift"
# The repo root, so the suite can read the board's own emoji list (web/index.html).
KOSMOS_REPO="$here/../.." "$out/composer-logic-tests"
