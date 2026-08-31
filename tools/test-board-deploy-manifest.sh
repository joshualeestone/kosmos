#!/usr/bin/env bash
# The board deploy and the release bundle must stage the SAME app files (#1164).
#
# 🛑 WHY THIS EXISTS. deploy/install-board.sh copies the app to a location
# outside the git tree. tools/build-kosmos-bundle.sh copies the same app into the
# release bundle. Those are two copies of one fact, and two copies of one fact
# drift: a new runtime file added to the bundle and forgotten here produces a
# deployed board missing a module, which fails at require time on whichever page
# happens to need it.
#
# The duplication is deliberate. The alternative was refactoring the shared
# staging out of a RELEASE-CRITICAL script, which is a worse thing to get wrong
# than this is. This guard is the price of that choice: the lists may be in two
# places, but they cannot disagree.
#
# ⚠️ IT COMPARES SOURCES, NOT DESTINATIONS. The two scripts stage into different
# layouts on purpose (the bundle builds app/ inside a tarball; the deploy builds
# the app root itself), so asserting destinations would fail on a difference that
# is correct.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE="$REPO/tools/build-kosmos-bundle.sh"
DEPLOY="$REPO/deploy/install-board.sh"
fails=0
ok()   { printf 'PASS: %s\n' "$1"; }
bad()  { printf 'FAIL: %s\n' "$1"; fails=$((fails+1)); }

# Pull every repo-relative source path a script copies FROM. Quotes are stripped
# first because the two scripts quote differently ("$REPO/x" vs "$REPO"/x), and a
# regex that handled only one form would silently see half the list.
sources() {
  tr -d '"' \
    | grep -oE '\$REPO/[A-Za-z0-9._/*-]+' \
    | sed 's|^\$REPO/||' \
    | grep -v '/$' \
    | sort -u
}

# 🛑 ONLY THE APP SECTION OF THE BUNDLE. The bundle also stages the installer,
# the `kosmos` command and the native app, which go elsewhere in the tarball and
# are NOT part of the board. My first version compared the whole file and
# reported six false differences: an instrument answering an adjacent question.
# ⚠️ THE DASH IS LOAD-BEARING IN THESE PATTERNS. `/^# ---- the app /` also matches
# `# ---- the app can tell when it is the stale half`, 300 lines later, which
# REOPENED the range and swept in the whole rest of the file. Anchoring on the
# section rule's dashes is what distinguishes a section header from a sentence
# that starts the same way.
b="$(awk '/^# ---- the app -/{f=1} /^# ---- the command -/{f=0} f' "$BUNDLE" | sources)"
d="$(sources < "$DEPLOY")"

# --- the control comes first, because a comparison of two empty lists passes ---
bn=$(printf '%s\n' "$b" | grep -c . || true)
dn=$(printf '%s\n' "$d" | grep -c . || true)
if [ "$bn" -ge 5 ] && [ "$dn" -ge 5 ]; then
  ok "control: both extractions found paths (bundle=$bn, deploy=$dn), so a match means something"
else
  bad "control: extraction found too little (bundle=$bn, deploy=$dn) - the comparison below would pass vacuously"
fi

only_b="$(comm -23 <(printf '%s\n' "$b") <(printf '%s\n' "$d"))"
only_d="$(comm -13 <(printf '%s\n' "$b") <(printf '%s\n' "$d"))"

if [ -z "$only_b" ]; then
  ok "every file the release bundle stages is also deployed"
else
  bad "the bundle stages files the board deploy does NOT (a deployed board would be missing them):"
  printf '        %s\n' $only_b
fi

if [ -z "$only_d" ]; then
  ok "the board deploy stages nothing the release bundle does not"
else
  bad "the board deploy stages files the bundle does NOT (they would never reach a user):"
  printf '        %s\n' $only_d
fi

echo "─────────────────────────────"
if [ "$fails" -eq 0 ]; then echo "Results: 3 passed, 0 failed"; else echo "Results: $((3-fails)) passed, $fails failed"; fi
[ "$fails" -eq 0 ]
