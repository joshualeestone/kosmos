#!/bin/bash
# test-artifact-setup-source-2360.sh - kosmos#2360.
#
# The 9e outside-audit's "served /setup matches the repo" check used to compare the served /setup
# against the LOCAL working-tree chaoskosmos-site/setup. But the deploy ships from origin/main (via
# the #2286 fresh-origin-main mechanism), so a shared checkout that lagged origin by a /setup commit
# made 9e FALSE-RED "served /setup DIFFERS" -> release-exit=1, though the served bytes were correct.
# The fix compares served vs origin/main:setup (the deploy source), which cannot false-fail on a stale
# local checkout. This test locks that in: STATIC (the check reads origin/main, not the bare local
# file) + BEHAVIOURAL (in a real repo where origin != local -- the exact #2360 condition -- the fix's
# derivation reads the deploy source, discriminating origin from a stale local).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
CHECK=tools/kosmos-artifact-check.sh
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }

# ---- STATIC: the fix is in place (regression guard) -----------------------------------------
grep -q 'git -C "\$SITE_CO" show origin/main:setup' "$CHECK" \
  && ok "the /setup check derives the source sha from origin/main:setup (the deploy source)" \
  || bad "the /setup check does not read origin/main:setup -- it may have regressed to the local working tree (#2360)"
# it must NOT hard-FAIL on a bare local-working-tree comparison as the PRIMARY path (that is the bug).
# The local file may still appear on the guarded fallback, but only as UNPROVEN, never a primary bad.
grep -q 'served /setup DIFFERS from origin/main:setup' "$CHECK" \
  && ok "a served-vs-origin/main difference is the hard FAIL (a real served-vs-source mismatch)" \
  || bad "the hard FAIL no longer names origin/main:setup as the reference"

# ---- BEHAVIOURAL: the derivation reads the deploy source, not a stale local -------------------
# Reproduce the exact #2360 condition in a real repo: origin/main:setup = A, local working /setup = B.
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
git init -q --bare "$T/origin.git"
git clone -q "$T/origin.git" "$T/site" 2>/dev/null
printf 'ORIGIN-SETUP-BYTES-A\n' > "$T/site/setup"
git -C "$T/site" add setup && git -C "$T/site" commit -qm "setup A"
git -C "$T/site" push -q origin HEAD:main 2>/dev/null
# now make the LOCAL working tree stale/different from origin/main (the shared-checkout-lag condition)
printf 'LOCAL-STALE-BYTES-B\n' > "$T/site/setup"

SHA_A="$(printf 'ORIGIN-SETUP-BYTES-A\n' | shasum -a 256 | awk '{print $1}')"
SHA_B="$(shasum -a 256 "$T/site/setup" | awk '{print $1}')"
[ "$SHA_A" != "$SHA_B" ] || bad "test setup invalid: A and B hash the same, so the test cannot discriminate"

# the fix's exact derivation:
git -C "$T/site" fetch -q origin 2>/dev/null || true
if git -C "$T/site" show origin/main:setup > "$T/origin-setup" 2>/dev/null && [ -s "$T/origin-setup" ]; then
  DERIVED="$(shasum -a 256 "$T/origin-setup" | awk '{print $1}')"
else
  DERIVED=""
fi
[ "$DERIVED" = "$SHA_A" ] \
  && ok "the fix's derivation reads origin/main:setup (A), NOT the stale local working tree (B)" \
  || bad "the derivation returned '$DERIVED', expected origin/main sha $SHA_A -- it did not read the deploy source"
# red-capability of the discrimination: the OLD (buggy) approach would have read the local file (B).
OLD_DERIVED="$(shasum -a 256 "$T/site/setup" | awk '{print $1}')"
[ "$OLD_DERIVED" = "$SHA_B" ] && [ "$OLD_DERIVED" != "$DERIVED" ] \
  && ok "control: the OLD local-working-tree read would have returned B ($SHA_B) -- the bug the fix removes" \
  || bad "control did not discriminate old(local) from new(origin) -- the test is vacuous"

# guard: a missing origin/main:setup yields empty (the fallback path), not a bogus fixed hash.
if git -C "$T/site" show origin/main:no-such-file > "$T/none" 2>/dev/null && [ -s "$T/none" ]; then
  bad "git show of a missing path produced non-empty output -- the empty-guard is unsound"
else
  ok "guard: git show of a missing origin/main path yields empty (falls back, not a bogus hash)"
fi

[ "$FAILS" -eq 0 ] && echo "artifact setup-source (#2360): all hold" || { echo "artifact setup-source (#2360): $FAILS failed"; exit 1; }
