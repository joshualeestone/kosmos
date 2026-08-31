#!/usr/bin/env bash
# kosmos#1594: the pinned-Playwright provision must COMPOSE with the gate's run,
# the pin must be a SINGLE source of truth, and the npx-cache fallback must be
# LOUD. Static checks only (no npm install, no browser download, no network).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PROV="$REPO/tools/provision-pw.sh"
GATE="$REPO/tools/browser-checks.sh"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok   %s\n' "$*"; }

[ -f "$PROV" ] || fail "provision-pw.sh is missing"
[ -x "$PROV" ] || fail "provision-pw.sh is not executable"
bash -n "$PROV" || fail "provision-pw.sh does not parse"
pass "provision-pw.sh exists, is executable, and parses"

# 1. It pins an EXACT version (not a range, not a bare package), and installs
#    BOTH engines the checks use.
ver="$(sed -n 's/^PW_VERSION="\([0-9][0-9.]*\)".*/\1/p' "$PROV" | head -1)"
[ -n "$ver" ] || fail "provision-pw.sh has no exact PW_VERSION=\"x.y.z\" pin"
case "$ver" in *[!0-9.]*) fail "PW_VERSION '$ver' is not an exact numeric version" ;; esac
grep -q 'playwright@\$PW_VERSION' "$PROV" || fail "provision-pw.sh does not install the pinned playwright@\$PW_VERSION"
grep -q 'playwright install chromium webkit' "$PROV" || fail "provision-pw.sh does not install BOTH engines (chromium webkit)"
pass "provision-pw.sh pins an exact version ($ver) and installs both engines"

# 2. It is IDEMPOTENT: a re-run with the pinned version already present is a
#    no-op (it must check what is installed before installing).
grep -q 'already present' "$PROV" || fail "provision-pw.sh is not idempotent (no already-present short-circuit)"
pass "provision-pw.sh is idempotent"

# 3. The gate's documented provision POINTS AT the script, in both the doc
#    comment and the failure message, and the non-composing bare-npm install is
#    gone (CONTROL: the throwaway step must not be documented anywhere in it).
[ "$(grep -c 'tools/provision-pw.sh' "$GATE")" -ge 2 ] || fail "browser-checks.sh does not point at provision-pw.sh in both the doc comment and the failure hint"
if grep -qE 'npm i playwright' "$GATE"; then
  fail "browser-checks.sh still documents the non-composing 'npm i playwright' (bare, into a throwaway dir)"
fi
pass "the gate points at provision-pw.sh and no longer documents the throwaway provision"

# 4. resolve_pw makes the npx-cache fallback LOUD, not silent (the #1594 defect
#    made visible). Both the naming of the cache and the unpinned warning.
grep -q 'npx cache' "$GATE" || fail "resolve_pw does not name the npx-cache fallback"
grep -q 'UNPINNED' "$GATE" || fail "resolve_pw does not warn that the npx-cache build is UNPINNED"
pass "resolve_pw warns loudly when it falls back to the unpinned npx-cache build"

# 5. SINGLE SOURCE OF TRUTH: the pinned version number lives only in
#    provision-pw.sh; the gate references the script by name, never a second
#    copy of the number that could drift.
if grep -qE 'playwright@[0-9]' "$GATE"; then
  fail "browser-checks.sh carries a second copy of the pinned version; the pin must live only in provision-pw.sh"
fi
pass "the pinned version lives only in provision-pw.sh (no drift)"

echo "provision-pw: all checks passed"
