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
