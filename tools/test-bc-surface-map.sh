#!/bin/bash
# kosmos#2518: prove the surface-map query helper (tools/bc-surface-map.sh) emits the map and
# answers the "changed web ids -> covering cut-checks" query precisely, and AGREES with the
# gate on the seeded checks (no drift). Runs from the repo root (uses the real docs/browser-checks).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
BCM="$HERE/bc-surface-map.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails + 1)); }

cd "$REPO" || { echo "cannot cd repo"; exit 1; }

# A web diff that changes a line carrying render-subprojects-1994.js's mapped token pj-parent.
printf '%s\n' 'diff --git a/web/index.html b/web/index.html' '--- a/web/index.html' '+++ b/web/index.html' \
  '@@ -100,1 +100,1 @@' '-      <span class="pj-parent">under App</span>' \
  '+      <span class="pj-parent">Kosmos > App</span>' > "$TMP/wd-parent"
# Compound identifier merely CONTAINING pj-parent -> must NOT be covered (boundary).
printf '%s\n' 'diff --git a/web/index.html b/web/index.html' '@@ -5,1 +5,1 @@' \
  '-  <div class="pj-parenthetical-note">a</div>' '+  <div class="pj-parenthetical-note">b</div>' > "$TMP/wd-substr"
# An unmapped token -> nothing covered.
printf '%s\n' 'diff --git a/web/index.html b/web/index.html' '@@ -1,1 +1,1 @@' \
  '-  <div class="zzz-unmapped">a</div>' '+  <div class="zzz-unmapped">b</div>' > "$TMP/wd-unmapped"
# A plain changed-id list (not a diff) touching alltasks-count (render-alltasks's token).
printf '%s\n' 'alltasks-count' 'some-other-id' > "$TMP/idlist"

# 1. map: the seeded checks appear with their declared tokens.
mapout="$(bash "$BCM" map)"
if printf '%s\n' "$mapout" | grep -qE "^render-subprojects-1994\.js	.*pj-parent" \
   && printf '%s\n' "$mapout" | grep -qE "^render-alltasks\.js	.*alltasks-count"; then
  pass "map emits the seeded checks with their tokens"
else
  fail "map did not emit the seeded check->token lines"
fi

# 2. covering (diff): a pj-parent change -> render-subprojects-1994.js.
cov="$(bash "$BCM" covering < "$TMP/wd-parent")"
if printf '%s\n' "$cov" | grep -qx "render-subprojects-1994.js"; then
  pass "covering: a pj-parent web change is covered by render-subprojects-1994.js"
else
  fail "covering did not name render-subprojects-1994.js for a pj-parent change"
fi

# 3. AGREEMENT with the gate (no-update case): the same pj-parent change covering names is the
#    check the gate REFUSES when NO check was updated. Cross-checks the shared map + match (no drift).
gate_rc=0
( . "$HERE/lib/browser-check-surface-gate.sh" \
    && KOSMOS_BCSG_WEBDIFF="$TMP/wd-parent" KOSMOS_BCG_FILES="/dev/null" KOSMOS_BCG_MSGS="/dev/null" \
       kosmos_browser_check_surface_gate ) >/dev/null 2>&1 || gate_rc=$?
if [ "$gate_rc" -ne 0 ] && printf '%s\n' "$cov" | grep -qx "render-subprojects-1994.js"; then
  pass "no-update case: covering names render-subprojects-1994.js and the gate refuses it (rc=$gate_rc)"
else
  fail "covering/gate disagree on the pj-parent change with no update (gate rc=$gate_rc)"
fi

# 3b. SUPERSET semantics (the WARNING lock): covering is COVERAGE, not a staleness verdict, and is
#     UPDATE-AGNOSTIC. RE-INVOKE covering WITH the update env set: it must STILL name the check (a
#     covering that wrongly filtered updated checks -- collapsing to the gate's verdict -- would drop
#     it here and red). And the gate with that same update passes rc=0, proving covering is a superset.
gate_rc2=0
printf 'M\tdocs/browser-checks/render-subprojects-1994.js\n' > "$TMP/files-updated"
( . "$HERE/lib/browser-check-surface-gate.sh" \
    && KOSMOS_BCSG_WEBDIFF="$TMP/wd-parent" KOSMOS_BCG_FILES="$TMP/files-updated" KOSMOS_BCG_MSGS="/dev/null" \
       kosmos_browser_check_surface_gate ) >/dev/null 2>&1 || gate_rc2=$?
cov_upd="$(KOSMOS_BCG_FILES="$TMP/files-updated" bash "$BCM" covering < "$TMP/wd-parent")"
if [ "$gate_rc2" -eq 0 ] && printf '%s\n' "$cov_upd" | grep -qx "render-subprojects-1994.js"; then
  pass "superset: covering (re-run WITH the update env) still names the check while the gate passes rc=0"
else
  fail "superset broken: covering must ignore update state (gate rc=$gate_rc2, cov_upd='$cov_upd')"
fi

# 3c. DRIFT-DETECTOR on a SECOND check + token: a diff touching render-alltasks's token
#     alltasks-count -> covering names render-alltasks.js AND the gate (no update) refuses it. If the
#     parse/match ever drift between the helper and the gate, this behavioural agreement breaks.
printf '%s\n' 'diff --git a/web/index.html b/web/index.html' '@@ -1 +1 @@' \
  '-  <b id="alltasks-count">3</b>' '+  <b id="alltasks-count">4 tasks</b>' > "$TMP/wd-alltasks"
cov_at="$(bash "$BCM" covering < "$TMP/wd-alltasks")"
gate_rc3=0
( . "$HERE/lib/browser-check-surface-gate.sh" \
    && KOSMOS_BCSG_WEBDIFF="$TMP/wd-alltasks" KOSMOS_BCG_FILES="/dev/null" KOSMOS_BCG_MSGS="/dev/null" \
       kosmos_browser_check_surface_gate ) >/dev/null 2>&1 || gate_rc3=$?
if printf '%s\n' "$cov_at" | grep -qx "render-alltasks.js" && [ "$gate_rc3" -ne 0 ]; then
  pass "drift-detector: helper covering + gate agree on a 2nd check/token (render-alltasks / alltasks-count)"
else
  fail "helper/gate drift on render-alltasks (cov='$cov_at', gate rc=$gate_rc3)"
fi

# 4. boundary: pj-parenthetical (substring superset) is NOT covered.
if [ -z "$(bash "$BCM" covering < "$TMP/wd-substr")" ]; then
  pass "covering: pj-parenthetical (substring of pj-parent) is not covered (boundary match)"
else
  fail "covering over-fired on a substring superset"
fi

# 5. unmapped token -> nothing covered.
if [ -z "$(bash "$BCM" covering < "$TMP/wd-unmapped")" ]; then
  pass "covering: an unmapped token covers nothing"
else
  fail "covering named a check for an unmapped token"
fi

# 6. plain id-list input (not a diff): alltasks-count -> render-alltasks.js.
if bash "$BCM" covering < "$TMP/idlist" | grep -qx "render-alltasks.js"; then
  pass "covering accepts a plain changed-id list, not only a diff"
else
  fail "covering did not handle a plain id list"
fi

# 7. zsh arm: the helper runs correctly under zsh (find/tr while-reads, no tied vars).
if command -v zsh >/dev/null 2>&1; then
  if zsh "$BCM" covering < "$TMP/wd-parent" | grep -qx "render-subprojects-1994.js"; then
    pass "zsh: covering reproduces under zsh (self-defends the zsh-safety)"
  else
    fail "zsh: covering did not name the covering check under zsh"
  fi
else
  echo "SKIP  zsh not available"
fi

echo "bc-surface-map: $fails FAILED"
[ "$fails" -eq 0 ]
