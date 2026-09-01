#!/bin/bash
# kosmos#1720: the repo-local browser-check gate.
#
# THE GAP IT CLOSES: the browser-check ASSERTIONS live in docs/browser-checks/, not
# in the driver tools/browser-checks.sh (which only NAMES them). So a change to web/
# (the rendered surface) can ship with no assertion, and the guard stays green while
# the page breaks -- which is exactly what #1702 did to render-accounts-openai, red
# every cut until #1711 repaired the check. A sweep of the driver looks thorough and
# misses every assertion that matters.
#
# 🔑 REPO-LOCAL BY JOSH'S RULING (2026-09-01). The fleet pre-challenge-gate hook is
# `bash ~/.claude/hooks/user/pre-challenge-gate.sh`, one file every agent on the box
# runs at PR creation across EVERY repo -- a bug there breaks PR creation fleet-wide.
# This gate is about THIS repo's web/ and docs/browser-checks/, so it lives in
# agent-workforce's own test:shell sequence, where its radius is agent-workforce
# contributors only, not the fleet. That is the measured difference.
#
# THE RULE: a change touching web/ must EITHER touch docs/browser-checks/ (a real
# assertion update) OR carry an explicit override trailer, or it is refused with the
# pointer.
#
# THE OVERRIDE (Josh's condition -- a web/ change that genuinely needs no browser
# check must not block colleagues): a commit-message trailer `Browser-check: <reason>`
# (the key is case-insensitive) with a NON-EMPTY reason. A blank trailer is not an
# acknowledge; the author must say why (copy-only / already covered / ran the browser
# gate), so a bypass is deliberate and auditable rather than a silent flag.
#
# ⚠️ THE OVERRIDE IS BRANCH-WIDE, NOT PER-COMMIT. It is read across the whole branch
# (git log base..HEAD), so ONE trailer anywhere on the branch excuses ALL of the
# branch's web/ changes. That matches the gate's branch-level granularity (it looks at
# the branch diff, not one commit), and it is acceptable for an honesty aid -- but do
# not read it as a per-commit acknowledgement.
#
# SEAMS (for the test, so the gate is provable here without a real branch):
#   KOSMOS_BCG_FILES = a file of `status<TAB>path` lines, one per change, in the shape
#                      `git diff --name-status --no-renames $BASE...HEAD` produces
#                      (default: that command). Status is A / M / D etc.
#   KOSMOS_BCG_MSGS  = a file of commit messages (default: git log --format=%B $BASE..HEAD)
#   KOSMOS_BCG_BASE  = the diff base (default: origin/main)
#
# FAIL-SOFT: if it cannot compute a diff at all (detached HEAD, no origin/main, not a
# repo), it returns 0 rather than breaking an unrelated run. A gate that reds a
# checkout it could not read is worse than the gap; it is repo-local exactly so a
# mistake here cannot stop the fleet, and fail-soft keeps even this repo's unrelated
# runs green.

kosmos_browser_check_gate() {
  # NB: dstat/dpath, NOT status/path -- zsh ties `path` to PATH (emptying it) and
  # `status` to $?, and this lib is sourced, sometimes into a zsh shell.
  local base files msgs f dstat dpath tab touched_web touched_bc reason oldifs
  base="${KOSMOS_BCG_BASE:-origin/main}"

  if [ -n "${KOSMOS_BCG_FILES:-}" ]; then
    files="$(cat "$KOSMOS_BCG_FILES" 2>/dev/null)"
  else
    # --name-status --no-renames: a DELETED or renamed-away assertion must NOT count
    # as coverage (a rename is a D of the old name + an A of the new; only the A
    # counts), and --no-renames keeps every line a single `status<TAB>path`.
    files="$(git diff --name-status --no-renames "$base...HEAD" 2>/dev/null)" || {
      # Fail soft, but SAY SO: a silent skip cannot be told from a clean pass, and a
      # gate that quietly stopped running is the hazard it exists to guard against.
      echo "browser-check gate: could not diff against $base, skipping (not a branch gap)" >&2
      return 0
    }
  fi
  if [ -n "${KOSMOS_BCG_MSGS:-}" ]; then
    msgs="$(cat "$KOSMOS_BCG_MSGS" 2>/dev/null)"
  else
    msgs="$(git log --format=%B "$base..HEAD" 2>/dev/null || true)"
  fi

  touched_web=0; touched_bc=0
  tab="$(printf '\t')"
  oldifs="$IFS"; IFS='
'
  for f in $files; do
    dstat="${f%%"$tab"*}"   # A / M / D (etc.) from --name-status
    dpath="${f#*"$tab"}"    # the path after the TAB
    # A web/ change of ANY kind is a rendered change to guard -- add, edit OR delete.
    # Per-path so docs/webhooks/x never matches web/.
    case "$dpath" in web/*) touched_web=1 ;; esac
    # A docs/browser-checks/ path counts as coverage ONLY when ADDED or MODIFIED. A
    # DELETE (or rename-away, which --no-renames shows as a D) is the REMOVAL of an
    # assertion, not coverage -- otherwise an author could delete the very check that
    # covered a surface and ship the change green, the gap this gate exists to catch.
    case "$dstat" in
      A*|M*) case "$dpath" in docs/browser-checks/*) touched_bc=1 ;; esac ;;
    esac
  done
  IFS="$oldifs"

  [ "$touched_web" -eq 0 ] && return 0   # no rendered change: nothing to guard
  [ "$touched_bc"  -eq 1 ] && return 0   # a real browser-check assertion was updated: pass

  # override trailer with a non-empty reason (blank is not an acknowledge)
  reason="$(printf '%s\n' "$msgs" | sed -n 's/^[Bb][Rr][Oo][Ww][Ss][Ee][Rr]-[Cc][Hh][Ee][Cc][Kk]:[[:space:]]*\(.*[^[:space:]].*\)$/\1/p' | head -1)"
  if [ -n "$reason" ]; then
    echo "browser-check gate: web/ changed with no docs/browser-checks/ update, overridden -- $reason"
    return 0
  fi

  cat >&2 <<'MSG'
FAIL  browser-check gate (#1720): this change touches web/ (the rendered surface) but
updates no docs/browser-checks/ assertion.

The browser-check ASSERTIONS live in docs/browser-checks/, NOT in the driver
tools/browser-checks.sh (which only names them). A rendered change with no assertion is
the gap #1720 exists to catch: the guard stays green while the page breaks.

Do ONE of:
  - update or add the relevant docs/browser-checks/*.js assertion for what you changed, OR
  - if this web/ change genuinely needs no browser check (copy-only, already covered, or
    you ran the browser gate), add a commit-message trailer stating why:
        Browser-check: <one-line reason>
MSG
  return 1
}
