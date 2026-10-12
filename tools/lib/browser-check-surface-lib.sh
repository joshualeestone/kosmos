#!/bin/bash
# kosmos#2518 follow-up: the SINGLE SOURCE OF TRUTH for the two browser-check SURFACE-MAP
# primitives -- the annotation parse and the whole-token boundary match.
#
# WHY THIS EXISTS. Both consumers -- tools/lib/browser-check-surface-gate.sh (the PR gate)
# and tools/bc-surface-map.sh (the CI-integration query helper) -- must read the co-located
# `// Browser-check-surface: <tokens>` annotations and match a token against changed web
# content THE SAME WAY, or the gate would refuse a surface the helper says is covered (or
# vice versa). They used to carry BYTE-COPIES of both primitives, kept honest only by
# behavioural drift-detector arms in test-bc-surface-map.sh. This lib replaces the copies
# with one definition both source, so they cannot diverge at all; the drift arms remain as a
# WIRING check (both consumers call the shared fn and agree) rather than a byte-copy guard.
#
# 🛑 SOURCED INTO BASH (run-tests.sh / test:shell) AND SOMETIMES ZSH (an agent testing by
# hand). So: no `path` / `status` / `cdpath` locals (zsh ties them to $PATH / $? / $cdpath),
# `return` and never `exit`, and every function safe under the map helper's `set -u`.

# The tokens a check declares, parsed from its FIRST `// Browser-check-surface: <tokens>`
# line. Case-insensitive key (macOS sed has no portable /I flag, so the class is spelled
# out, matching the sibling coarse gate's convention). Prints the raw space/tab-separated
# token string on stdout, or nothing when the file carries no annotation.
#   $1 = path to a check .js file
bc_surface_tokens_of() {
  sed -n 's|^[[:space:]]*//[[:space:]]*[Bb][Rr][Oo][Ww][Ss][Ee][Rr]-[Cc][Hh][Ee][Cc][Kk]-[Ss][Uu][Rr][Ff][Aa][Cc][Ee]:[[:space:]]*\(.*\)$|\1|p' "$1" | head -1
}

# 0 (success) iff $1 (a token) appears WHOLE in $2 (changed text), bounded by non-identifier
# chars so token `pj-parent` does NOT over-fire on `pj-parenthetical`. ERE metachars in the
# token are escaped first (tokens are DOM-id-like, but a stray `.` in an annotation must stay
# literal). The class `[][\.^$*+?(){}|]` is the union both consumers escaped identically.
#   $1 = token   $2 = changed text (a diff body, or an id list)
bc_surface_token_hits() {
  local esc
  esc="$(printf '%s' "$1" | sed 's/[][\\.^$*+?(){}|]/\\&/g')"
  printf '%s\n' "$2" | grep -qE "(^|[^A-Za-z0-9_-])${esc}([^A-Za-z0-9_-]|\$)" 2>/dev/null
}

# #5907: every annotated check in ONE pass, for a consumer that would otherwise call bc_surface_tokens_of and
# bc_surface_token_hits per check and per token (about 4,000 processes on the real tree; the gate took ~17 s a call).
# Prints, in find's order, one line per check whose annotation is non-empty, and a SLOW line for a check whose key
# appears in a shape this match refuses (it may turn out to have no annotation; the consumer's sed decides):
#     <path> TAB <verdict> TAB <token>
# HIT: the first token (in the check's order) that is PLAIN ([A-Za-z0-9_-]+) and occurs whole in $2; it is that token.
# MISS: every token is plain and none occurs whole in $2.
# SLOW: a non-plain token comes before any plain hit, or a line carries the key in a shape this C-locale match refuses
# (the ambient-locale sed may still read it); the consumer decides it with bc_surface_tokens_of and bc_surface_token_hits,
# as before, and skips it if the sed finds no annotation either.
# A plain token is whole in $2 exactly when it is one of $2's maximal runs of [A-Za-z0-9_-], which is
# bc_surface_token_hits's boundary. Paths go through a file and awk's getline, never shell word-splitting (this lib is
# sourced into zsh too). Returns non-zero, printing nothing, when it cannot run; the consumer then takes the slow path.
# It reads in the C locale. A non-ASCII space around the key cannot hide an annotation (that line goes SLOW, above). On
# INVALID UTF-8 (a byte in the changed text, or in a check file above its annotation) it can find a match or an
# annotation the ambient-locale grep and sed fail on, so the gate is then stricter than before, never looser.
#   $1 = checks dir   $2 = changed text
bc_surface_scan_checks() {
  local _list _chg _out _rc
  _list="$(mktemp "${TMPDIR:-/tmp}/bcsg-list.XXXXXX" 2>/dev/null)" || return 2
  _chg="$(mktemp "${TMPDIR:-/tmp}/bcsg-chg.XXXXXX" 2>/dev/null)" || { rm -f "$_list"; return 2; }
  _out="$(mktemp "${TMPDIR:-/tmp}/bcsg-out.XXXXXX" 2>/dev/null)" || { rm -f "$_list" "$_chg"; return 2; }
  find "$1" -maxdepth 1 -type f -name '*.js' 2>/dev/null > "$_list"
  printf '%s\n' "$2" > "$_chg"
  LC_ALL=C command awk '
    FILENAME == ARGV[1] { n = split($0, w, /[^A-Za-z0-9_-]+/); for (k = 1; k <= n; k++) if (w[k] != "") word[w[k]] = 1; next }
    $0 != "" {
      f = $0; found = 0; odd = 0
      while ((r = (getline line < f)) > 0) {
        if (match(line, /^[[:space:]]*\/\/[[:space:]]*[Bb][Rr][Oo][Ww][Ss][Ee][Rr]-[Cc][Hh][Ee][Cc][Kk]-[Ss][Uu][Rr][Ff][Aa][Cc][Ee]:[[:space:]]*/)) { found = 1; break }
        # The key on a line this C-locale match refuses (a Unicode space the ambient-locale sed counts as space, say):
        # the sed may take it as the annotation, so this check is left to the per-check path rather than guessed.
        if (line ~ /[Bb][Rr][Oo][Ww][Ss][Ee][Rr]-[Cc][Hh][Ee][Cc][Kk]-[Ss][Uu][Rr][Ff][Aa][Cc][Ee]:/) { odd = 1; break }
      }
      close(f)
      if (r < 0) exit 3
      if (odd) { printf "%s\tSLOW\t\n", f; next }
      if (!found) next
      rest = substr(line, RSTART + RLENGTH)
      if (rest == "") next
      m = split(rest, t, /[ \t]+/); v = "MISS"; hit = ""
      for (k = 1; k <= m; k++) {
        if (t[k] == "") continue
        if (t[k] ~ /^[A-Za-z0-9_-]+$/) { if (t[k] in word) { v = "HIT"; hit = t[k]; break } }
        else { v = "SLOW"; break }
      }
      printf "%s\t%s\t%s\n", f, v, hit
    }' "$_chg" "$_list" > "$_out"
  _rc=$?
  [ "$_rc" -eq 0 ] && cat "$_out"
  rm -f "$_list" "$_chg" "$_out"
  return "$_rc"
}
