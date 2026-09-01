#!/bin/bash
# kosmos#1720: prove the repo-local browser-check gate.
#
# The gate refuses a change touching web/ (the rendered surface) that updates no
# docs/browser-checks/ ASSERTION (added or modified -- a DELETE does not count), unless
# a commit carries a non-empty `Browser-check: <reason>` override. This drives it
# through its seams (KOSMOS_BCG_FILES in `git diff --name-status` shape /
# KOSMOS_BCG_MSGS), and also runs it seam-free against the real branch so the git path
# is exercised too.
#
# It is a real control: it asserts BOTH the refuse arm (rc 1, the core catch) AND the
# pass arms (rc 0). A run that could only ever pass would prove nothing.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=tools/lib/browser-check-gate.sh
. "$HERE/lib/browser-check-gate.sh"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/bcg-test.XXXXXXXX")"
trap 'rm -rf "$tmp"' EXIT
fails=0

# ns <status> <path> [<status> <path> ...] -> `status<TAB>path` lines, the shape of
# `git diff --name-status --no-renames`.
ns() {
  while [ "$#" -ge 2 ]; do
    printf '%s\t%s\n' "$1" "$2"
    shift 2
  done
}

# run <name-status-lines> <msgs> -> sets RC to the gate's exit status (output hushed).
run() {
  printf '%s' "$1" > "$tmp/files"
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
run "$(ns M web/index.html)" "reflow the accounts row" \
  ; check "web/ change, no assertion, no override -> REFUSED" 1 "$RC"

# A nested web/ path is still a rendered change (per-path, not substring).
run "$(ns M web/sub/deep.css)" "restyle a control" \
  ; check "nested web/ path, no assertion -> REFUSED" 1 "$RC"

# A DELETED web/ page is a rendered change too, and still needs coverage.
run "$(ns D web/old-page.html)" "remove a page" \
  ; check "web/ page DELETED, no assertion -> REFUSED" 1 "$RC"

# PASS: a browser-check assertion ADDED or MODIFIED alongside the rendered change.
run "$(ns M web/index.html M docs/browser-checks/render-accounts-openai.js)" "reflow + update its check" \
  ; check "web/ change WITH an added/modified assertion -> pass" 0 "$RC"

# THE FALSE-NEGATIVE GUARD (iter-1 WARNING): DELETING an assertion is NOT coverage.
# An author must not remove the check that covered a surface and ship the change green.
run "$(ns M web/index.html D docs/browser-checks/gone.js)" "drop the row and its check" \
  ; check "web/ change + DELETED assertion (not coverage) -> REFUSED" 1 "$RC"

# PASS: an explicit override trailer with a non-empty reason.
run "$(ns M web/index.html)" "copy fix

Browser-check: copy-only, no rendered behaviour change" \
  ; check "web/ change + non-empty override -> pass" 0 "$RC"

# REFUSED: a blank override trailer is not an acknowledge (the author must say why).
run "$(ns M web/index.html)" "web change

Browser-check:    " \
  ; check "web/ change + BLANK override -> REFUSED" 1 "$RC"

# PASS: the override key is case-insensitive (a real trailer, any case).
run "$(ns M web/index.html)" "BROWSER-CHECK: already covered by render-create-form.js" \
  ; check "web/ change + upper-case override key -> pass" 0 "$RC"

# PASS: no rendered change at all, nothing to guard.
run "$(ns M engine/create.js M tools/release.sh)" "backend only" \
  ; check "no web/ change -> pass" 0 "$RC"

# PASS: a path that merely contains a similar segment is not web/.
run "$(ns M docs/webhooks/notes.md)" "unrelated docs" \
  ; check "docs/webhooks/ (not web/) -> pass" 0 "$RC"

# PASS via the REAL git path (no seams): this branch touches no web/, so the live
# `git diff --name-status origin/main...HEAD` returns 0. Exercises the git integration
# and, on a checkout without origin/main, the fail-soft branch (also rc 0).
( kosmos_browser_check_gate >/dev/null 2>&1 ); RC=$? \
  ; check "real git path on this branch (no web/) -> pass" 0 "$RC"

echo "---"
if [ "$fails" -eq 0 ]; then
  echo "browser-check-gate: all checks passed"
  exit 0
fi
echo "browser-check-gate: $fails FAILED"
exit 1
