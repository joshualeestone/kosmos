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

# 2b. WEB-SCOPING (WARNING #1 lock, red-capable): a full multi-file diff whose NON-web file carries a
#     mapped token must NOT be reported -- the gate diffs ONLY web/index.html. Without the web-section
#     scoping in _bcm_covering, the engine/foo.js `-const x = "alltasks-count";` line would match and
#     covering would name render-alltasks.js. The web section here changes only benign markup.
printf '%s\n' 'diff --git a/engine/foo.js b/engine/foo.js' '--- a/engine/foo.js' '+++ b/engine/foo.js' \
  '@@ -1 +1 @@' '-const x = "alltasks-count";' '+const x = "alltasks-count2";' \
  'diff --git a/web/index.html b/web/index.html' '--- a/web/index.html' '+++ b/web/index.html' \
  '@@ -1 +1 @@' '-  <div>hello</div>' '+  <div>hi</div>' > "$TMP/wd-multi"
if [ -z "$(bash "$BCM" covering < "$TMP/wd-multi")" ]; then
  pass "web-scoping: a mapped token changed in a NON-web file is not reported (gate diffs only web/index.html)"
else
  fail "web-scoping: covering over-reported a mapped token from a non-web file"
fi

# 3. AGREEMENT with the gate (no-update case): the same pj-parent change covering names is the
#    check the gate REFUSES when NO check was updated. Cross-checks the shared map + match (no drift).
gate_rc=0
( . "$HERE/lib/browser-check-surface-gate.sh" \
    && KOSMOS_BCSG_WEBDIFF="$TMP/wd-parent" KOSMOS_BCG_FILES="/dev/null" KOSMOS_BCG_MSGS="/dev/null" \
       kosmos_browser_check_surface_gate ) >/dev/null 2>&1 || gate_rc=$?
if [ "$gate_rc" -eq 1 ] && printf '%s\n' "$cov" | grep -qx "render-subprojects-1994.js"; then
  pass "no-update case: covering names render-subprojects-1994.js and the gate refuses it (rc=$gate_rc)"
else
  fail "covering/gate disagree on the pj-parent change with no update (gate rc=$gate_rc)"
fi
# NB rc==1 not rc!=0: the gate returns exactly 1 on a real refusal (gate `return 1`). A missing/renamed
# gate function exits 127, which `-ne 0` would misread as a refusal, false-greening the no-drift cross-check.

# 3b. SUPERSET semantics: covering is COVERAGE, not a staleness verdict. The LOAD-BEARING assertion here
#     is the CONTRAST: with the check marked updated, the GATE flips to rc=0 (does not flag it), while
#     covering's output does NOT change (still names it) -- so covering is a strict superset of the gate's
#     verdict. NB the helper reads NO update state today (no KOSMOS_BCG_FILES code path), so setting that
#     env on the covering call is a no-op NOW; it is kept as a guard against a FUTURE regression that adds
#     gate-style update-filtering (which would naturally key on KOSMOS_BCG_FILES) -- that would drop the
#     check here and red. arm 3 already proves covering names it with no update; this adds the gate-flip.
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
if printf '%s\n' "$cov_at" | grep -qx "render-alltasks.js" && [ "$gate_rc3" -eq 1 ]; then
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

# 6b. ID-LIST ROBUSTNESS (WARNING #1 lock, red-capable): a plain id-list whose FIRST line happens to
#     start with a diff-marker prefix (`--- `) must STILL resolve its real ids -- it is NOT a diff.
#     With the old `^(@@ |+++ |--- )` shape detector this whole list was misread as a headerless hunk
#     and every id silently dropped. alltasks-count is render-alltasks's token.
printf '%s\n' '--- some-banner-line' 'alltasks-count' > "$TMP/idlist-marker"
if bash "$BCM" covering < "$TMP/idlist-marker" | grep -qx "render-alltasks.js"; then
  pass "id-list: a list with a leading '--- ' line still resolves its ids (not misread as a diff)"
else
  fail "id-list misclassified as a diff by a leading marker-shaped line -- ids silently dropped"
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
