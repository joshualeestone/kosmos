#!/bin/bash
# kosmos#1720: prove the repo-local browser-check gate.
#
# The gate refuses a change that touches web/ (the rendered surface) but updates no
# docs/browser-checks/ assertion, unless the commit carries a non-empty
# `Browser-check: <reason>` override. This drives it through its seams
# (KOSMOS_BCG_FILES / KOSMOS_BCG_MSGS) so the logic is provable without a real branch.
#
# It is a real control: it asserts BOTH the refuse arm (rc 1, the core catch) AND the
# pass arms (rc 0). A run that could only ever pass would prove nothing.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=tools/lib/browser-check-gate.sh
. "$HERE/lib/browser-check-gate.sh"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/bcg-test.XXXXXXXX")"
trap 'rm -rf "$tmp"' EXIT
fails=0

# run <files> <msgs> -> sets RC to the gate's exit status (output suppressed).
run() {
  printf '%s\n' "$1" > "$tmp/files"
  printf '%s\n' "$2" > "$tmp/msgs"
  KOSMOS_BCG_FILES="$tmp/files" KOSMOS_BCG_MSGS="$tmp/msgs" \
    kosmos_browser_check_gate >/dev/null 2>&1
  RC=$?
}

check() {  # check <name> <expected-rc> <actual-rc>
  if [ "$2" = "$3" ]; then
    echo "PASS  $1"
  else
    echo "FAIL  $1 (expected rc=$2, got rc=$3)"
    fails=$((fails + 1))
  fi
}

# THE CORE CATCH: a rendered change with no assertion and no override is refused.
run "web/index.html" "reflow the accounts row" \
  ; check "web/ change, no docs/browser-checks/, no override -> REFUSED" 1 "$RC"

# A nested web/ path is still a rendered change (per-line matching, not substring).
run "web/sub/deep.css" "restyle a control" \
  ; check "nested web/ path, no assertion -> REFUSED" 1 "$RC"

# PASS: a real browser-check assertion was updated alongside the rendered change.
run "web/index.html
docs/browser-checks/render-accounts-openai.js" "reflow the row and update its check" \
  ; check "web/ change WITH a docs/browser-checks/ update -> pass" 0 "$RC"

# PASS: an explicit override trailer with a non-empty reason.
run "web/index.html" "copy fix

Browser-check: copy-only, no rendered behaviour change" \
  ; check "web/ change + non-empty Browser-check override -> pass" 0 "$RC"

# REFUSED: a blank override trailer is not an acknowledge (the author must say why).
run "web/index.html" "web change

Browser-check:    " \
  ; check "web/ change + BLANK Browser-check trailer -> REFUSED" 1 "$RC"

# PASS: no rendered change at all, nothing to guard.
run "engine/create.js
tools/release.sh" "backend only" \
  ; check "no web/ change -> pass" 0 "$RC"

# PASS: a path that merely contains a similar segment is not web/ (docs/webhooks vs web).
run "docs/webhooks/notes.md" "unrelated docs" \
  ; check "docs/webhooks/ (not web/) -> pass" 0 "$RC"

# PASS: the override match is anchored to the message; a body mention of the phrase
# without the trailer form does not count, but a genuine trailer with mixed case does.
run "web/index.html" "Browser-check: already covered by render-create-form.js" \
  ; check "web/ change + case-insensitive trailer, real reason -> pass" 0 "$RC"

echo "---"
if [ "$fails" -eq 0 ]; then
  echo "browser-check-gate: all checks passed"
  exit 0
fi
echo "browser-check-gate: $fails FAILED"
exit 1
