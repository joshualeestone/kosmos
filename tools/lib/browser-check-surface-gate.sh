#!/bin/bash
# kosmos#2518: the SURFACE-SPECIFIC browser-check gate (a precise companion to
# tools/lib/browser-check-gate.sh).
#
# THE GAP IT CLOSES. The coarse gate (#1720, browser-check-gate.sh) refuses a web/
# change only when NO docs/browser-checks/*.js is touched at all. So a PR can change
# the surface a SPECIFIC check asserts, touch an UNRELATED check (or use the
# `Browser-check:` trailer to defer), pass the coarse gate, and stale that specific
# check -- which then reds only at the next release cut (the ~133 page checks run at
# cut 3b, not the PR gate). This cost 4 cut attempts on 0.6.49: #2498 scoped
# "view all tasks" and DEFERRED render-alltasks "to the cut"; #2487 broke
# render-subprojects-1994's exact-match ancestry assertion. Both passed their PRs.
#
# THE RULE. A browser-check declares the distinctive web tokens it asserts, in-file:
#     // Browser-check-surface: <token> <token> ...
# each token a DOM id/class/marker the check keys on AND present in web/index.html.
# If a web/index.html change touches (adds/removes a line containing) a MAPPED token
# while that check file is NOT updated on the branch, this gate REFUSES, naming the
# check + token. Pass by updating the check, OR a PER-CHECK named override trailer:
#     Browser-check-surface: <check-basename> <reason>
# 🛑 The blanket `Browser-check:` trailer does NOT excuse a surface-mapped staleness --
# that blanket defer is exactly what let #2498 through. A surface deferral must NAME
# the check, so it is deliberate and auditable per-check.
#
# INCREMENTAL + NEVER-COARSE. Only ANNOTATED checks are enforced; unannotated checks
# fall back to the coarse gate unchanged. The map grows check-by-check and is never
# falsely complete: an unmapped surface is still guarded (coarsely) by #1720.
#
# SEAMS (so the gate is provable without a real branch), same shape as #1720 plus one:
#   KOSMOS_BCG_BASE      diff base                    (default: origin/main)
#   KOSMOS_BCG_FILES     `git diff --name-status --no-renames BASE...HEAD` (to find updated checks)
#   KOSMOS_BCG_MSGS      `git log --format=%B BASE..HEAD` (override trailers)
#   KOSMOS_BCSG_WEBDIFF  `git diff BASE...HEAD -- web/index.html` (the changed web content)
#   KOSMOS_BCSG_DIR      the checks dir with the annotations (default: docs/browser-checks)
#
# FAIL-SOFT, like #1720: if it cannot read the web diff, it returns 0 (repo-local; a
# gate that reds a checkout it could not read is worse than the gap).

kosmos_browser_check_surface_gate() {
  # dstat/dpath NOT status/path: zsh ties `path`->PATH and `status`->$?, and this lib
  # is sourced, sometimes into zsh.
  local base bcdir files msgs webdiff changed tab
  local ann ann_list toks tok esc_tok basename_chk esc_base viol reason
  base="${KOSMOS_BCG_BASE:-origin/main}"
  bcdir="${KOSMOS_BCSG_DIR:-docs/browser-checks}"
  tab="$(printf '\t')"

  # 1. The changed web/index.html content (added/removed lines only, NOT context, NOT
  #    the +++/--- file headers). No web change at all -> nothing to guard.
  if [ -n "${KOSMOS_BCSG_WEBDIFF:-}" ]; then
    webdiff="$(cat "$KOSMOS_BCSG_WEBDIFF" 2>/dev/null)"
  else
    webdiff="$(git diff "$base...HEAD" -- web/index.html 2>/dev/null)" || {
      echo "browser-check surface gate: could not diff against $base, skipping (not a branch gap)" >&2
      return 0
    }
  fi
  # Keep only genuinely changed lines: start with a single + or - (a diff body line),
  # excluding the +++/--- headers.
  changed="$(printf '%s\n' "$webdiff" | grep -E '^[+-]' | grep -Ev '^(\+\+\+|---)' 2>/dev/null || true)"
  [ -n "$changed" ] || return 0

  # 2. Which check files were updated on the branch (A/M under docs/browser-checks/*.js).
  if [ -n "${KOSMOS_BCG_FILES:-}" ]; then
    files="$(cat "$KOSMOS_BCG_FILES" 2>/dev/null)"
  else
    files="$(git diff --name-status --no-renames "$base...HEAD" 2>/dev/null || true)"
  fi
  # 3. Override trailers + updated-check set are read below per candidate.
  if [ -n "${KOSMOS_BCG_MSGS:-}" ]; then
    msgs="$(cat "$KOSMOS_BCG_MSGS" 2>/dev/null)"
  else
    msgs="$(git log --format=%B "$base..HEAD" 2>/dev/null || true)"
  fi

  viol=""
  # 4. Walk every top-level check .js. Enumerate with `find` + newline-split while-read,
  #    NOT a `"$bcdir"/*.js` glob: under zsh a no-match glob ABORTS the whole function
  #    (`no matches found`) before any `[ -f ]` guard runs -- the exact
  #    `zsh-unmatched-glob-skips-the-command-entirely` trap, and this lib is sourced into
  #    zsh. find returns empty on no match in every shell, so this is nomatch-safe.
  [ -d "$bcdir" ] || return 0                       # no checks dir: nothing to map (fail-soft)
  ann_list="$(find "$bcdir" -maxdepth 1 -type f -name '*.js' 2>/dev/null || true)"
  while IFS= read -r ann; do
    [ -n "$ann" ] || continue
    # The key is case-insensitive, matching the sibling coarse gate's convention. macOS
    # sed has no portable /I flag, so spell the class out (as browser-check-gate.sh does).
    toks="$(sed -n 's|^[[:space:]]*//[[:space:]]*[Bb][Rr][Oo][Ww][Ss][Ee][Rr]-[Cc][Hh][Ee][Cc][Kk]-[Ss][Uu][Rr][Ff][Aa][Cc][Ee]:[[:space:]]*\(.*\)$|\1|p' "$ann" | head -1)"
    [ -n "$toks" ] || continue                     # unannotated: coarse gate handles it
    basename_chk="${ann##*/}"                       # e.g. render-subprojects-1994.js

    # Is this check file itself updated on the branch? Then it is not stale by construction.
    if printf '%s\n' "$files" | grep -qE "^[AM][^${tab}]*${tab}${bcdir}/${basename_chk}$" 2>/dev/null; then
      continue
    fi
    # A per-check named override with a non-empty reason excuses THIS check only. The key
    # is case-insensitive (sibling convention); the basename is escaped so its literal `.`
    # is not a BRE any-char (never restrictive, but hygiene, matching the token escaping).
    esc_base="$(printf '%s' "$basename_chk" | sed 's/[][\\.^$*]/\\&/g')"
    reason="$(printf '%s\n' "$msgs" | sed -n "s|^[Bb][Rr][Oo][Ww][Ss][Ee][Rr]-[Cc][Hh][Ee][Cc][Kk]-[Ss][Uu][Rr][Ff][Aa][Cc][Ee]:[[:space:]]*${esc_base}[[:space:]]\{1,\}\(.*[^[:space:]].*\)\$|\1|p" | head -1)"
    if [ -n "$reason" ]; then
      echo "browser-check surface gate: ${basename_chk} surface change overridden -- $reason"
      continue
    fi

    # Does any declared token appear in a CHANGED web line? If so, the check may be stale.
    # Iterate tokens via newline-split while-read, NOT `for tok in $toks`: zsh does NOT
    # word-split an unquoted expansion (this lib is sourced, sometimes into zsh), so the
    # `for` form would test the whole "tok1 tok2" string as ONE token and miss every
    # multi-token check. tr turns the space/tab-separated list into one token per line.
    while IFS= read -r tok; do
      [ -n "$tok" ] || continue
      # WHOLE-token match, bounded by non-identifier chars, so token `pj-parent` does
      # NOT over-fire on an unrelated `pj-parenthetical`. Escape ERE metachars first
      # (tokens are DOM-id-like, but a stray `.` in an annotation must stay literal).
      esc_tok="$(printf '%s' "$tok" | sed 's/[][\\.^$*+?(){}|]/\\&/g')"
      if printf '%s\n' "$changed" | grep -qE "(^|[^A-Za-z0-9_-])${esc_tok}([^A-Za-z0-9_-]|\$)" 2>/dev/null; then
        viol="${viol}  ${basename_chk}  (surface token '${tok}' changed in web/index.html)
"
        break
      fi
    done <<< "$(printf '%s' "$toks" | tr ' \t' '\n\n')"
  done <<< "$ann_list"

  [ -n "$viol" ] || return 0

  {
    echo "FAIL  browser-check surface gate (#2518): web/index.html changes a surface a browser-check"
    echo "asserts, but that check was not updated -- it will stale and red only at the next cut:"
    printf '%s' "$viol"
    echo
    echo "For each check above, do ONE of:"
    echo "  - update docs/browser-checks/<check> so its assertion matches the new surface, OR"
    echo "  - if this surface change genuinely does not affect that check, add a per-check trailer:"
    echo "        Browser-check-surface: <check-basename> <one-line reason>"
    echo "    (the blanket 'Browser-check:' trailer does NOT excuse a surface-mapped staleness.)"
    echo "    NB: if you take this override path AND touch no docs/browser-checks/ file at all, the"
    echo "    coarse gate (#1720) still needs its own 'Browser-check: <reason>' trailer as well."
  } >&2
  return 1
}
