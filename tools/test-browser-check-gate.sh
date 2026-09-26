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

# THE README GUARD (iter-2 WARNING): a NON-.js file in docs/browser-checks/ (a README)
# is not an assertion, so it does not excuse a web/ change.
run "$(ns M web/index.html M docs/browser-checks/README.md)" "touch the readme, not a check" \
  ; check "web/ change + non-.js docs/browser-checks file -> REFUSED" 1 "$RC"

# THE SUBDIR GUARD (iter-3 WARNING): a .js NESTED in a docs/browser-checks/ subdir
# (e.g. shots/) is not a top-level assertion the driver runs, so it is not coverage.
run "$(ns M web/index.html A docs/browser-checks/shots/helper.js)" "add a nested helper" \
  ; check "web/ change + NESTED .js (driver never runs it) -> REFUSED" 1 "$RC"

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

# REAL git path (no seams): drive the gate through its live `git diff` + `git log`
# subprocesses on a base pinned to a KNOWN ref, so the outcome is deterministic and
# independent of what the branch under test touches. The refuse-vs-pass decision LOGIC
# is already proven by the seam-driven arms above (KOSMOS_BCG_FILES); these two arms
# prove the real git plumbing runs and returns the RIGHT verdict for a known input.
#
# 🔑 This file only SELF-TESTS the gate lib. The actual browser-check ENFORCEMENT --
# refusing a real web/ change that lacks a docs/browser-checks/ assertion or a
# `Browser-check:` trailer -- is run-tests.sh:118, which runs the gate seam-free
# against the branch and reds the suite. Do NOT re-add a branch-dependent "assert the
# real branch passes" arm here to double as enforcement: it duplicates line 118, and
# its red is mislabeled (this arm has no way to say "you touched web/ without an
# assertion" -- only line 118 prints that). #1833.
#
# ⚠️ WHY NOT the old form. It ran the gate seam-free against the branch and asserted
# rc 0, on the assumption "this branch touches no web/". The default base is
# origin/main, so on any branch that legitimately changes web/ without an inline
# assertion the live `origin/main...HEAD` diff is non-empty and the gate CORRECTLY
# refuses (rc 1) -- making the arm a function of the branch under test: green on main
# (empty diff), red on a web-changing branch, SAME code. That is kosmos#1833, misread
# as a tmux-server race (the "error connecting to .../tmux-501/default" lines are
# benign and appear identically in green and red runs; status.snapshot reads a missing
# socket as the no-server empty). Pinning the base removes the branch-dependence.
#
# Base = HEAD: `git diff HEAD...HEAD` is empty on EVERY branch, so the gate runs its
# real diff+log and returns 0 via the "no rendered change" path (NOT the fail-soft
# escape, which fires only when the diff command itself errors). Asserting exactly 0
# also catches a gate that wrongly refused an empty diff -- which rc-in-{0,1} could not.
( KOSMOS_BCG_BASE=HEAD kosmos_browser_check_gate >/dev/null 2>&1 ); RC=$? \
  ; check "real git path, empty diff (base=HEAD) -> pass" 0 "$RC"

# Base = a ref that cannot resolve: `git diff <nope>...HEAD` errors, so the gate takes
# its fail-soft branch (browser-check-gate.sh: "could not diff against <base>,
# skipping") and returns 0. Exercises the no-origin/main path the old comment claimed
# to cover but only reached by accident on a checkout that happened to lack origin/main.
( KOSMOS_BCG_BASE=kosmos-bcg-no-such-ref kosmos_browser_check_gate >/dev/null 2>&1 ); RC=$? \
  ; check "real git path, unresolvable base -> fail-soft pass" 0 "$RC"

# ZSH SAFETY (iter-2 WARNING): the lib is sourced into zsh in some contexts, and zsh
# does not word-split an unquoted expansion. A `for f in $files` loop would iterate
# ONCE over the whole blob under zsh and false-REFUSE a change that HAS its assertion.
# Run the exact valid case under a real zsh and require a pass -- a non-zsh-safe loop
# reds this. Skipped (not failed) where zsh is unavailable.
if command -v zsh >/dev/null 2>&1; then
  ns M web/index.html M docs/browser-checks/render-x.js > "$tmp/zfiles"
  printf 'reflow and update the check\n' > "$tmp/zmsgs"
  zsh -c ". \"$HERE/lib/browser-check-gate.sh\" && KOSMOS_BCG_FILES=\"$tmp/zfiles\" KOSMOS_BCG_MSGS=\"$tmp/zmsgs\" kosmos_browser_check_gate" >/dev/null 2>&1
  check "zsh: web/ change WITH assertion PASSES (the loop is zsh-safe)" 0 "$?"
else
  echo "SKIP  zsh not available -- cannot verify the zsh-safe loop"
fi

# #3893: a PR already MERGED into base when CI checked out (two merge bases). main's M1
# changes web/ only and is excused by a blanket `Browser-check:` trailer; the PR touches an
# unrelated file; HEAD is the synthetic merge of the PR head into M1. `base...HEAD` picked the
# PR head as merge base (so M1's web change read as the PR's) while `base..HEAD` never showed
# M1's trailer: a refusal for main's own excused change. Dates make the PR head the newer base.
cx() {  # <dir> <pr-touches-web: 0|1> -> prints "M1 M2 H"
  local d="$1" t=1700000000
  g() { GIT_COMMITTER_DATE="@$t +0000" GIT_AUTHOR_DATE="@$t +0000" \
          git -C "$d" -c user.email=t@t -c user.name=t -c init.defaultBranch=main "$@"; }
  mkdir -p "$d/web" && g init -q
  printf '%s\n' 'a' '' '' '' 'z' > "$d/web/index.html"; g add -A && g commit -qm A; t=$((t + 100))
  g branch pr
  sed -i.bak 's/^a$/a2/' "$d/web/index.html" && rm -f "$d/web/index.html.bak"
  g add -A && g commit -qm M1 -m "Browser-check: copy only"; t=$((t + 100))
  local m1; m1="$(g rev-parse HEAD)"
  g checkout -q pr
  if [ "$2" = 1 ]; then sed -i.bak 's/^z$/z2/' "$d/web/index.html" && rm -f "$d/web/index.html.bak"; else echo e > "$d/engine.txt"; fi
  g add -A && g commit -qm P; t=$((t + 100))
  g checkout -q --detach "$m1" && g merge -q --no-ff -m H pr >/dev/null 2>&1
  local h; h="$(g rev-parse HEAD)"
  g checkout -q main && g merge -q --no-ff -m M2 pr >/dev/null 2>&1
  local m2; m2="$(g rev-parse HEAD)"
  g checkout -q --detach "$h"
  echo "$m1 $m2 $h"
}
read -r C_M1 C_M2 C_H <<< "$(cx "$tmp/cx" 0)"
cpick="$(git -C "$tmp/cx" merge-base "$C_M2" "$C_H")"; cpr="$(git -C "$tmp/cx" rev-parse "$C_H^2")"
[ "$cpick" = "$cpr" ]; check "#3893 fixture: git picks the PR head as the merge base (else the arm is vacuous)" 0 "$?"
( cd "$tmp/cx" && unset KOSMOS_BCG_FILES KOSMOS_BCG_MSGS; KOSMOS_BCG_BASE="$C_M2" kosmos_browser_check_gate ) >/dev/null 2>&1
check "#3893: an already-merged PR is not refused for main's own excused web change" 0 "$?"
read -r D_M1 D_M2 D_H <<< "$(cx "$tmp/dx" 1)"
( cd "$tmp/dx" && unset KOSMOS_BCG_FILES KOSMOS_BCG_MSGS; KOSMOS_BCG_BASE="$D_M1" kosmos_browser_check_gate ) >/dev/null 2>&1
check "#3893 positive control: a PR's own web change with no check and no trailer is refused" 1 "$?"

echo "---"
if [ "$fails" -eq 0 ]; then
  echo "browser-check-gate: all checks passed"
  exit 0
fi
echo "browser-check-gate: $fails FAILED"
exit 1
