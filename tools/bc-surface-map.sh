#!/bin/bash
# kosmos#2518: a reusable query over the browser-check SURFACE MAP, for the CI-integration
# half (@barondraxum). The map is the co-located `// Browser-check-surface: <tokens>`
# annotations in docs/browser-checks/*.js (added by #2518) -- the FROZEN contract this and
# tools/lib/browser-check-surface-gate.sh both read; the annotation FORMAT is the single
# source of truth. The annotation-parse sed and the whole-token boundary match here are
# COPIED byte-for-byte from the gate (not yet a shared function -- extracting one is a clean
# follow-up). They agree today because they are identical. DRIFT-DETECTOR arms in
# test-bc-surface-map.sh assert the helper and the gate agree BEHAVIOURALLY on: plain tokens
# (arms 3/3c), a '.'-metachar token AND a mixed-case annotation key (arm 3d) -- so an unmirrored
# edit to the whole-token boundary match, the metachar ESCAPE, or the case-insensitive KEY reds the
# suite. This is a STRONG check, not a proof: it does not exercise every path (e.g. head -1
# multi-annotation). 🛑 If you edit the parse/match here, MIRROR it in the gate (and vice versa)
# until they share one function.
#
# USAGE
#   tools/bc-surface-map.sh map [dir]
#       -> `<check-basename><TAB><space-separated tokens>` for every annotated check.
#   tools/bc-surface-map.sh covering [dir]   (reads stdin)
#       stdin = a web/index.html unified diff, OR a newline/space-separated list of changed
#       DOM ids/tokens. Prints the cut-checks that COVER the changed surfaces (one basename per
#       line, sorted-unique) -- i.e. whose declared tokens appear (whole-token) in the changed
#       content. Empty = nothing covered.
#       NB the diff path web-scopes on the DEFAULT `b/web/index.html` prefix, so feed a normal
#       `git diff` (not diff.noprefix / a custom --dst-prefix), matching the gate's assumption.
#
# 🛑 COVERAGE, NOT A STALENESS VERDICT. `covering` answers "which checks EXERCISE these changed
# surfaces", by token presence only. It is a SUPERSET of "checks the gate would flag stale":
# the gate ADDITIONALLY skips a check that was updated on the branch OR carries a per-check
# `Browser-check-surface: <check> <reason>` override. So do NOT read `covering` output as "these
# WILL red at the cut" -- read it as "these checks cover what you changed; make sure each is
# updated or consciously overridden." The map + the whole-token match are COPIED identical from the
# gate (drift-guarded by a test, per the header), so covering and the gate agree about WHICH checks
# cover a surface; they differ only in the gate's extra updated/override filtering.
#
# Contract for the consumer: exit 0 always on a readable map (a query is not a failure); the
# covering list is the payload. Fail-soft: a missing checks dir yields an empty map.
#
# zsh-safe (find + newline while-read for the check enumeration, tr + while-read for tokens;
# no `path`/`status` locals) because it may be invoked from any shell.
set -u

BCSG_DIR_DEFAULT="docs/browser-checks"

# Emit `<basename>\t<tokens>` for every annotated top-level check. Same parse + case-insensitive
# key as the gate; find (not a glob) so a no-match under zsh does not abort.
_bcm_map() {
  local dir ann toks base tab
  dir="$1"
  tab="$(printf '\t')"
  [ -d "$dir" ] || return 0
  local list; list="$(find "$dir" -maxdepth 1 -type f -name '*.js' 2>/dev/null || true)"
  while IFS= read -r ann; do
    [ -n "$ann" ] || continue
    toks="$(sed -n 's|^[[:space:]]*//[[:space:]]*[Bb][Rr][Oo][Ww][Ss][Ee][Rr]-[Cc][Hh][Ee][Cc][Kk]-[Ss][Uu][Rr][Ff][Aa][Cc][Ee]:[[:space:]]*\(.*\)$|\1|p' "$ann" | head -1)"
    [ -n "$toks" ] || continue
    base="${ann##*/}"
    printf '%s%s%s\n' "$base" "$tab" "$toks"
  done <<< "$list"
}

# 0 if $1 (a token) appears WHOLE (bounded by non-identifier chars) in $2 (changed text). The
# SAME match the gate uses, so covering() agrees with what the gate would flag.
_bcm_token_hits() {
  local esc
  esc="$(printf '%s' "$1" | sed 's/[][\\.^$*+?(){}|]/\\&/g')"
  printf '%s\n' "$2" | grep -qE "(^|[^A-Za-z0-9_-])${esc}([^A-Za-z0-9_-]|\$)" 2>/dev/null
}

_bcm_covering() {
  local dir changed base toks tok tab
  dir="$1"
  tab="$(printf '\t')"
  changed="$(cat)"                                   # stdin
  # Reduce stdin to the CHANGED web/index.html surface, matching exactly what the gate sees:
  # the gate diffs ONLY web/index.html (KOSMOS_BCSG_WEBDIFF = git diff BASE...HEAD -- web/index.html).
  # Three input shapes:
  #  1. A (possibly multi-file) unified diff carrying `diff --git` headers -> keep ONLY the
  #     web/index.html file section's changed body lines (+/-, excluding the +++/--- headers).
  #     This is what makes a full-repo `git diff | covering` AGREE with the gate instead of
  #     over-reporting a mapped token that changed in a NON-web file the gate never reads.
  #  2. A headerless hunk (no `diff --git`, but @@/+++/---) -> cannot file-scope, so keep the
  #     changed body lines; the caller owns that this is the web diff.
  #  3. A plain changed-id/token list (no diff markers at all) -> verbatim, each non-empty line a
  #     caller-asserted changed token. 🛑 Do NOT feed diff CONTEXT lines stripped of headers here:
  #     with no +/- prefix and no header they read as tokens and would match UNCHANGED surface.
  # Shape detection order matters: `diff --git` first (a git diff), THEN a REAL unified-diff hunk
  # header `^@@ -<digit>` for a headerless `diff -u` (shape 2), ELSE an id-list. The hunk-header key
  # is deliberately the anchored numeric form, NOT a bare `@@ `/`+++ `/`--- ` prefix: an id-list line
  # that merely starts with `--- ` / `+++ ` / `@@ text` must NOT be misread as a diff and silently
  # dropped (a real hunk header is always `@@ -N`), which was a silent false-negative in id-list mode.
  if printf '%s\n' "$changed" | grep -qE '^diff --git ' 2>/dev/null; then
    changed="$(printf '%s\n' "$changed" | awk '
      /^diff --git / { insec = ($0 ~ /[ ]b\/web\/index\.html$/) ? 1 : 0; next }
      insec && /^(\+\+\+|---)/ { next }
      insec && /^[+-]/         { print }
    ')"
  elif printf '%s\n' "$changed" | grep -qE '^@@ -[0-9]' 2>/dev/null; then
    changed="$(printf '%s\n' "$changed" | grep -E '^[+-]' | grep -Ev '^(\+\+\+|---)' 2>/dev/null || true)"
  fi
  [ -n "$changed" ] || return 0
  while IFS="$tab" read -r base toks; do
    [ -n "$base" ] || continue
    while IFS= read -r tok; do
      [ -n "$tok" ] || continue
      if _bcm_token_hits "$tok" "$changed"; then
        printf '%s\n' "$base"
        break
      fi
    done <<< "$(printf '%s' "$toks" | tr ' \t' '\n\n')"
  done <<< "$(_bcm_map "$dir")" | sort -u
}

main() {
  local cmd dir
  cmd="${1:-}"
  dir="${2:-${KOSMOS_BCSG_DIR:-$BCSG_DIR_DEFAULT}}"
  case "$cmd" in
    map)      _bcm_map "$dir" ;;
    covering) _bcm_covering "$dir" ;;
    *)
      echo "usage: bc-surface-map.sh map [dir]                     # <check>\\t<tokens> lines" >&2
      echo "       bc-surface-map.sh covering [dir]  < web-diff     # covering checks for changed surfaces" >&2
      return 2 ;;
  esac
}

main "$@"
