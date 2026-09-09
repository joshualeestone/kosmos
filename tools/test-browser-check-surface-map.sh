#!/usr/bin/env bash
# #2518: the surface MAP must stay honest. Every `// Browser-check-surface:` token a
# browser-check declares MUST be present (whole-token) in web/index.html. A token that
# is NOT present is a DEAD annotation: browser-check-surface-gate.sh can never fire for
# it, so a stale check it was meant to guard slips through silently -- the exact miss
# #2518 exists to prevent, one layer up. This meta-guard fails loudly on a dead token,
# so growing the map cannot quietly add coverage that does nothing.
#
# dstat/dpath naming avoided; no tied var names (path/status/cdpath); find, not a glob
# (zsh aborts a no-match glob); every glob quoted. Runs under bash (shebang) and is
# wired into test:shell.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$REPO/web/index.html"
BCDIR="$REPO/docs/browser-checks"
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
[ -f "$WEB" ] || { echo "FAIL  no web/index.html at $WEB"; exit 1; }
[ -d "$BCDIR" ] || { echo "FAIL  no $BCDIR"; exit 1; }

# Whole-token presence, the SAME match tools/lib/browser-check-surface-gate.sh uses, so
# "present here" means exactly "the gate can fire on it". That parity requires escaping ERE
# metachars in the token FIRST, exactly as the gate does (its esc_tok) -- otherwise a token
# with a literal `.` would be a regex here but a literal there, and this guard could certify
# a token the gate can never actually match (or miss one it can), the dead-annotation class
# this test exists to catch.
present_in_web() {
  local esc; esc="$(printf '%s' "$1" | sed 's/[][\\.^$*+?(){}|]/\\&/g')"
  grep -qE "(^|[^A-Za-z0-9_-])${esc}([^A-Za-z0-9_-]|\$)" "$WEB"
}

annotated=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  toks="$(sed -n 's|^[[:space:]]*//[[:space:]]*[Bb][Rr][Oo][Ww][Ss][Ee][Rr]-[Cc][Hh][Ee][Cc][Kk]-[Ss][Uu][Rr][Ff][Aa][Cc][Ee]:[[:space:]]*\(.*\)$|\1|p' "$f" | head -1)"
  [ -n "$toks" ] || continue
  annotated=$((annotated + 1))
  base="${f##*/}"
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    if present_in_web "$t"; then
      ok "$base: surface token '$t' is present in web/index.html"
    else
      bad "$base: surface token '$t' is NOT in web/index.html -- dead annotation, the gate can never fire for it"
    fi
  done <<< "$(printf '%s' "$toks" | tr ' \t' '\n\n')"
done <<< "$(find "$BCDIR" -maxdepth 1 -type f -name '*.js' 2>/dev/null)"

# The map must not be silently empty (a broken parse would pass vacuously otherwise).
[ "$annotated" -ge 1 ] \
  && ok "found $annotated annotated check(s) to validate (map is non-empty)" \
  || bad "no annotated checks found -- the parse is broken or the map is empty (vacuous pass averted)"

# RED-CAPABILITY: a token that is genuinely absent from web must read as absent, or this
# test could not catch a dead annotation. This proves present_in_web can return the
# dangerous answer, so an all-green run above means something.
if present_in_web "this-surface-token-is-absent-from-web-xyzzy-2518"; then
  bad "CONTROL: a planted absent token matched web -- the guard cannot prove it detects a dead token"
else
  ok "CONTROL: a planted absent token is correctly detected as absent (the guard is red-capable)"
fi

[ "$FAILS" -eq 0 ] && echo "browser-check surface map: all arms passed" || echo "browser-check surface map: $FAILS FAILED"
exit "$FAILS"
