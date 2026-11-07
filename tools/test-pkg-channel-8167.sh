#!/bin/bash
# test-pkg-channel-8167.sh - kosmos#8167: the installer pkg's NAME follows the channel.
#
# /dist/Kosmos.pkg is the one file the public Download button links. Before #8167 release.sh step 3c
# rewrote it on every cut, staging cuts included, so an installer change reached every new install
# before any promote. Now a staging cut writes Kosmos-staging.pkg and leaves Kosmos.pkg alone; a prod
# cut writes both; promote-channel.sh copies one onto the other (tested in test-setup-staging-5032.sh
# and test-promote-named-7005.sh; deploy-site.sh in test-deploy-site-promote.sh).
#
# Here: release.sh's 3c publish loop and 9c served check, each EXTRACTED by its own markers and RUN
# against fixture site dists, a fake pkg build that records whether it ran, and a local HTTP server
# standing in for the host. Each arm has a control that can return the dangerous answer.
#
#   bash tools/test-pkg-channel-8167.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO_REAL="$(cd "$HERE/.." && pwd)"
REL="$REPO_REAL/tools/release.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/pkg-channel-8167.XXXXXX")"; SRV=""
trap '[ -z "$SRV" ] || { kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; }; rm -rf "$T"' EXIT
fail=0; pass(){ printf 'PASS  %s\n' "$*"; }; bad(){ printf 'FAIL  %s\n' "$*"; fail=1; }
. "$REPO_REAL/tools/lib/pkg-inputs.sh"

# ---- extract the two blocks by their own markers ----
C3="$(awk '/^PKG_NAMES="\$\(pkg_names_for_channel "\$CUT_CHANNEL"\)"/{p=1} p{print} p&&/^  echo "   \$PKG_PROD_NAME left as it is: a staging cut does not touch/{getline; print; exit}' "$REL")"
case "$C3" in *'PKG_NAMES='*'pkg_triple_copy'*'left as it is'*'fi') pass "3c: extracted the publish loop by its markers" ;; *) bad "3c: could not extract the publish loop"; C3="exit 99" ;; esac
C9="$(awk '/^_pkg_served_check\(\) \{/{p=1} p&&/^step "== 9d\./{exit} p{print}' "$REL")"
case "$C9" in *'_pkg_served_check() {'*'for _pkg_name in $PKG_NAMES'*'"$PKG_PROD_NAME" unchanged'*) pass "9c: extracted the served check by its markers" ;; *) bad "9c: could not extract the served check"; C9="exit 99" ;; esac
case "$C9" in *'step "'*) bad "9c: the extracted region holds another step" ;; esac
CX="$(awk '/^# kosmos#8167: what deploys is the export, and the site checkout is shared/{p=1} p{print} p&&/^fi$/{exit}' "$REL")"
case "$CX" in *'pkg_triple_check "$_site_export/dist" "$PKG_PROD_NAME"'*'PKG_PROD_SERVED_SHA'*'fi') pass "export guard: extracted by its markers" ;; *) bad "export guard: could not extract it"; CX="exit 99" ;; esac

WANT="$(printf 'source-inputs' | shasum -a 256 | awk '{print $1}')"; OLDIN="$(printf 'old-inputs' | shasum -a 256 | awk '{print $1}')"
mk() {   # <dir> <name> <bytes> <input-sha>: a whole triple
  printf '%s' "$3" > "$1/$2"; printf '%s  %s\n' "$(_pkg_hash < "$1/$2" | awk '{print $1}')" "$2" > "$1/$2.sha256"; pkg_sidecar_write "$1/$2" "$4" "$1/$2.inputs"
}
# A fake repo whose tools/build-installer-pkg.sh writes a Kosmos.pkg triple for $WANT and records that it ran.
FR="$T/repo"; mkdir -p "$FR/tools/lib" "$FR/dist"; cp "$REPO_REAL/tools/lib/pkg-inputs.sh" "$FR/tools/lib/"
cat > "$FR/tools/build-installer-pkg.sh" <<EOF
#!/bin/bash
. "$FR/tools/lib/pkg-inputs.sh"
echo built >> "$T/builds"
printf 'BUILT-PKG' > "\$OUT_DIR/Kosmos.pkg"
printf '%s  Kosmos.pkg\n' "\$(_pkg_hash < "\$OUT_DIR/Kosmos.pkg" | awk '{print \$1}')" > "\$OUT_DIR/Kosmos.pkg.sha256"
pkg_sidecar_write "\$OUT_DIR/Kosmos.pkg" "$WANT" "\$OUT_DIR/Kosmos.pkg.inputs"
EOF
# A local HTTP server stands in for the host (3c reads the served Kosmos.pkg on a staging cut; 9c reads everything).
PY3="$(command -v python3)"
WWW="$T/www"; mkdir -p "$WWW/dist"; EXP="$T/export"; mkdir -p "$EXP/dist"; BR="$T/build"; mkdir -p "$BR"
( cd "$WWW" && exec "$PY3" -u -m http.server 0 -b 127.0.0.1 ) > "$T/srv.log" 2>&1 & SRV=$!
PORT=""; for i in $(seq 1 100); do PORT="$(sed -n 's/.*port \([0-9][0-9]*\).*/\1/p' "$T/srv.log" | head -n1)"; [ -n "$PORT" ] && break; sleep 0.1; done
[ -n "$PORT" ] && pass "the stand-in host is up" || bad "the stand-in host did not start: $(cat "$T/srv.log")"
serve() { rm -f "$WWW/dist/"* "$EXP/dist/"*; }   # reset both sides
# serve_prod <site-dist>: the host serves exactly the site dist's Kosmos.pkg triple (the usual, consistent state)
serve_prod() { serve; cp "$1/Kosmos.pkg" "$1/Kosmos.pkg.sha256" "$1/Kosmos.pkg.inputs" "$WWW/dist/"; }
run3c() {   # <channel> <site-dist>: runs the extracted 3c in a subshell; prints its output, rc is its own
  : > "$T/builds"; rm -f "$FR/dist/Kosmos.pkg"*
  ( set -e; CUT_CHANNEL="$1"; SITE="$(dirname "$2")"; REPO="$FR"; V=9.9.9; _pkg_want="$WANT"; HOST="http://127.0.0.1:$PORT"; BUILD_ROOT="$BR"; eval "$C3"; echo "PUBLISHED=[$PKG_NAMES_PUBLISHED] SERVED=[$PKG_PROD_SERVED_SHA]" ) 2>&1
}
builds() { grep -c built "$T/builds" 2>/dev/null || true; }
newsite() { local s; s="$(mktemp -d "$T/site.XXXXXX")"; mkdir -p "$s/dist"; printf '%s/dist' "$s"; }

# 1) staging, Kosmos.pkg holds the OLD prod installer, no staging pkg: build once, publish ONLY Kosmos-staging.pkg.
D="$(newsite)"; mk "$D" Kosmos.pkg "PROD-PKG" "$OLDIN"; cp "$D/Kosmos.pkg" "$T/prod.before"; cp "$D/Kosmos.pkg.sha256" "$T/prodsum.before"; serve_prod "$D"
out="$(run3c staging "$D")"; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$D/Kosmos-staging.pkg" 2>/dev/null)" = "BUILT-PKG" ] && [ "$(builds)" = 1 ] && pass "3c staging: builds once and publishes Kosmos-staging.pkg" || bad "3c staging publish (rc=$rc builds=$(builds) out=$out)"
cmp -s "$D/Kosmos.pkg" "$T/prod.before" && cmp -s "$D/Kosmos.pkg.sha256" "$T/prodsum.before" && pass "3c staging: Kosmos.pkg (the Download button's file) is untouched" || bad "3c staging CHANGED Kosmos.pkg"
[ "$(awk '{print $2}' "$D/Kosmos-staging.pkg.sha256")" = Kosmos-staging.pkg ] && pass "3c staging: the staging .sha256 names its own file" || bad "3c staging .sha256: $(cat "$D/Kosmos-staging.pkg.sha256")"
case "$out" in *"PUBLISHED=[ Kosmos-staging.pkg] SERVED=[$(_pkg_hash < "$D/Kosmos.pkg" | awk '{print $1}')]"*) pass "3c staging: PKG_NAMES_PUBLISHED names only the staging pkg, and the served prod sha is recorded" ;; *) bad "3c staging published list: $out" ;; esac
case "$out" in *"Kosmos.pkg left as it is"*) pass "3c staging: says Kosmos.pkg was left alone" ;; *) bad "3c staging did not say so: $out" ;; esac
# 2) staging again, now current: nothing built, nothing published.
out="$(run3c staging "$D")"; rc=$?
[ "$rc" = 0 ] && [ "$(builds)" = 0 ] && case "$out" in *"PUBLISHED=[]"*) true;; *) false;; esac && pass "3c staging: a current staging pkg is not rebuilt" || bad "3c staging re-run (rc=$rc builds=$(builds) out=$out)"
# 3) staging, Kosmos.pkg is ALREADY current (inputs = source) and no staging pkg: copied, not rebuilt.
D="$(newsite)"; mk "$D" Kosmos.pkg "CURRENT-PKG" "$WANT"; serve_prod "$D"
out="$(run3c staging "$D")"; rc=$?
[ "$rc" = 0 ] && [ "$(builds)" = 0 ] && cmp -s "$D/Kosmos.pkg" "$D/Kosmos-staging.pkg" && pass "3c staging: a current Kosmos.pkg is COPIED to the staging name, no second sign + notarise" || bad "3c staging copy arm (rc=$rc builds=$(builds) out=$out)"
# 3b) THE ABORTED-PROD-CUT LEFTOVER: the site dist's Kosmos.pkg is NOT what the host serves. A staging cut must put
#     the served triple back, never deploy the leftover to the Download button.
D="$(newsite)"; mk "$D" Kosmos.pkg "SERVED-PKG" "$OLDIN"; serve_prod "$D"; mk "$D" Kosmos.pkg "LEFTOVER-FROM-ABORTED-PROD-CUT" "$WANT"
out="$(run3c staging "$D")"; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$D/Kosmos.pkg")" = "SERVED-PKG" ] && cmp -s "$D/Kosmos.pkg.inputs" "$WWW/dist/Kosmos.pkg.inputs" && case "$out" in *"putting the served triple back"*) true;; *) false;; esac \
  && pass "3c staging: a site dist Kosmos.pkg that differs from the served one is replaced by the served triple" || bad "3c staging leftover arm (rc=$rc, Kosmos.pkg: $(cat "$D/Kosmos.pkg"), out=$out)"
[ "$(awk '{print $2}' "$D/Kosmos.pkg.sha256")" = Kosmos.pkg ] && pass "3c staging: the restored .sha256 names Kosmos.pkg" || bad "3c staging restored sha256: $(cat "$D/Kosmos.pkg.sha256")"
# 3b2) the leftover is a promote's copy that was never deployed (Kosmos.pkg == the local staging pkg): replaced, and said.
D="$(newsite)"; mk "$D" Kosmos.pkg "SERVED-PKG" "$OLDIN"; serve_prod "$D"; mk "$D" Kosmos-staging.pkg "PROMOTED-NOT-DEPLOYED" "$WANT"; mk "$D" Kosmos.pkg "PROMOTED-NOT-DEPLOYED" "$WANT"
out="$(run3c staging "$D")"; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$D/Kosmos.pkg")" = "SERVED-PKG" ] && case "$out" in *"looks like a promote's copy that was never deployed"*) true;; *) false;; esac \
  && pass "3c staging: an undeployed promote copy is replaced, with a WARNING that the promote has not happened" || bad "3c staging promote-copy arm (rc=$rc out=$out)"
# 3c) no local Kosmos.pkg at all: restored from the host too.
D="$(newsite)"; mk "$D" Kosmos.pkg "SERVED-PKG" "$OLDIN"; serve_prod "$D"; rm -f "$D/Kosmos.pkg"*
out="$(run3c staging "$D")"; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$D/Kosmos.pkg" 2>/dev/null)" = "SERVED-PKG" ] && pass "3c staging: a missing Kosmos.pkg is restored from the host" || bad "3c staging missing arm (rc=$rc out=$out)"
# 3d) the host serves no Kosmos.pkg.sha256 (404): the staging cut stops; there is no Download button pkg to keep.
D="$(newsite)"; mk "$D" Kosmos.pkg "PROD-PKG" "$OLDIN"; serve
out="$(run3c staging "$D")"; rc=$?
[ "$rc" != 0 ] && [ ! -e "$D/Kosmos-staging.pkg" ] && case "$out" in *"HTTP 404"*) true;; *) false;; esac && pass "3c staging: a 404 for the served Kosmos.pkg.sha256 stops the cut, nothing published" || bad "3c staging 404 arm (rc=$rc out=$out)"
# 3e) the served .sha256 names no sha: stops too.
D="$(newsite)"; mk "$D" Kosmos.pkg "PROD-PKG" "$OLDIN"; serve_prod "$D"; printf 'not a checksum\n' > "$WWW/dist/Kosmos.pkg.sha256"
out="$(run3c staging "$D")"; rc=$?
[ "$rc" != 0 ] && [ ! -e "$D/Kosmos-staging.pkg" ] && pass "3c staging: a served .sha256 with no sha stops the cut" || bad "3c staging bad-sha arm (rc=$rc out=$out)"
# 4) prod, empty dist: build once, publish both names.
D="$(newsite)"
out="$(run3c prod "$D")"; rc=$?
[ "$rc" = 0 ] && [ "$(builds)" = 1 ] && [ "$(cat "$D/Kosmos.pkg")" = BUILT-PKG ] && [ "$(cat "$D/Kosmos-staging.pkg")" = BUILT-PKG ] && pass "3c prod: builds ONCE and publishes both names" || bad "3c prod (rc=$rc builds=$(builds) out=$out)"
[ "$(awk '{print $2}' "$D/Kosmos.pkg.sha256")" = Kosmos.pkg ] && [ "$(awk '{print $2}' "$D/Kosmos-staging.pkg.sha256")" = Kosmos-staging.pkg ] && pass "3c prod: each .sha256 names its own file" || bad "3c prod sha256 names"
# 5) CONTROL: prod with an OLD Kosmos.pkg DOES replace it (the arm a staging cut must never take).
D="$(newsite)"; mk "$D" Kosmos.pkg "PROD-PKG" "$OLDIN"
out="$(run3c prod "$D")"; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$D/Kosmos.pkg")" = BUILT-PKG ] && pass "3c prod: CONTROL a prod cut does replace an old Kosmos.pkg" || bad "3c prod replace (rc=$rc out=$out)"
# 6) an error inside the decision stops the cut instead of reading as current (fail closed).
D="$(newsite)"
out="$( CUT_CHANNEL=bogus; SITE="$(dirname "$D")"; REPO="$FR"; V=9.9.9; _pkg_want="$WANT"; eval "$C3" ) 2>&1"; rc=$?
[ "$rc" != 0 ] && [ ! -e "$D/Kosmos.pkg" ] && pass "3c: an unknown channel stops the step, nothing published" || bad "3c bogus channel (rc=$rc out=$out)"

# ---- 9c ----
run9c() {   # <channel> <names> <published> [served prod sha before the cut]: the extracted 9c, sleeps stubbed out
  ( set -e; sleep(){ :; }; CUT_CHANNEL="$1"; PKG_NAMES="$2"; PKG_NAMES_PUBLISHED="$3"; PKG_PROD_SERVED_SHA="${4:-}"; HOST="http://127.0.0.1:$PORT"; BUILD_ROOT="$BR"; _site_export="$EXP"; _pkg_want="$WANT"; eval "$C9"; echo "NINE-C-OK" ) 2>&1
}
psha() { _pkg_hash < "$1" | awk '{print $1}'; }
# 7) staging: the served staging pkg is the source's and the export's, the served Kosmos.pkg is the export's: passes.
serve; mk "$WWW/dist" Kosmos-staging.pkg "STAGING" "$WANT"; mk "$WWW/dist" Kosmos.pkg "PROD" "$OLDIN"; cp "$WWW/dist/"* "$EXP/dist/"
out="$(run9c staging Kosmos-staging.pkg " Kosmos-staging.pkg" "$(psha "$WWW/dist/Kosmos.pkg")")"; rc=$?
[ "$rc" = 0 ] && case "$out" in *NINE-C-OK*"Download button's installer did not move"*|*"Download button's installer did not move"*NINE-C-OK*) true;; *) false;; esac && pass "9c staging: passes, and says the Download button's installer did not move" || bad "9c staging pass arm (rc=$rc out=$out)"
# 8) staging: the export CARRIED a different Kosmos.pkg and it went live (the leftover shape the export cannot see,
#    because export and served agree): red, because it is not the sha served before the cut.
serve; mk "$WWW/dist" Kosmos-staging.pkg "STAGING" "$WANT"; mk "$WWW/dist" Kosmos.pkg "PROD" "$OLDIN"; BEFORE="$(psha "$WWW/dist/Kosmos.pkg")"
mk "$WWW/dist" Kosmos.pkg "SHIPPED-BY-THIS-CUT" "$WANT"; cp "$WWW/dist/"* "$EXP/dist/"
out="$(run9c staging Kosmos-staging.pkg " Kosmos-staging.pkg" "$BEFORE")"; rc=$?
[ "$rc" != 0 ] && case "$out" in *"THE SERVED Kosmos.pkg IS NOT THE ONE THIS STAGING CUT LEFT"*"not the one served before this cut"*|*"not the one served before this cut"*"THE SERVED Kosmos.pkg IS NOT THE ONE THIS STAGING CUT LEFT"*) true;; *) false;; esac \
  && pass "9c staging: a Kosmos.pkg this cut shipped (export and served agree) reds, against the pre-cut served sha" || bad "9c staging shipped-prod arm (rc=$rc out=$out)"
# 8b) staging: an edge serving something the export did not carry: red too.
serve; mk "$WWW/dist" Kosmos-staging.pkg "STAGING" "$WANT"; mk "$WWW/dist" Kosmos.pkg "PROD" "$OLDIN"; cp "$WWW/dist/"* "$EXP/dist/"; BEFORE="$(psha "$WWW/dist/Kosmos.pkg")"
mk "$WWW/dist" Kosmos.pkg "SOMETHING-NEW" "$WANT"
out="$(run9c staging Kosmos-staging.pkg " Kosmos-staging.pkg" "$BEFORE")"; rc=$?
[ "$rc" != 0 ] && case "$out" in *"THE SERVED Kosmos.pkg IS NOT THE ONE THIS STAGING CUT LEFT"*) true;; *) false;; esac && pass "9c staging: a served Kosmos.pkg that is not the export's reds the cut" || bad "9c staging edge arm (rc=$rc out=$out)"
# 9) staging: the served STAGING pkg has old inputs: red, and it names the staging pkg.
serve; mk "$WWW/dist" Kosmos-staging.pkg "STAGING" "$OLDIN"; mk "$WWW/dist" Kosmos.pkg "PROD" "$OLDIN"; cp "$WWW/dist/"* "$EXP/dist/"
out="$(run9c staging Kosmos-staging.pkg " Kosmos-staging.pkg" "$(psha "$WWW/dist/Kosmos.pkg")")"; rc=$?
[ "$rc" != 0 ] && case "$out" in *"THE SERVED INSTALLER Kosmos-staging.pkg IS NOT THE ONE 3c PUBLISHED"*) true;; *) false;; esac && pass "9c staging: a stale served staging pkg reds and names it" || bad "9c stale staging arm (rc=$rc out=$out)"
# 10) CONTROL: a prod cut does NOT accept an old Kosmos.pkg (prod must match the source).
serve; mk "$WWW/dist" Kosmos-staging.pkg "STAGING" "$WANT"; mk "$WWW/dist" Kosmos.pkg "PROD" "$OLDIN"; cp "$WWW/dist/"* "$EXP/dist/"
out="$(run9c prod "Kosmos.pkg Kosmos-staging.pkg" "")"; rc=$?
[ "$rc" != 0 ] && case "$out" in *"THE SERVED INSTALLER Kosmos.pkg IS NOT THE SITE DIST'S"*) true;; *) false;; esac && pass "9c prod: CONTROL an old served Kosmos.pkg reds a prod cut" || bad "9c prod control (rc=$rc out=$out)"
# 11) prod with both current: passes, no staging-only line.
serve; mk "$WWW/dist" Kosmos-staging.pkg "BOTH" "$WANT"; mk "$WWW/dist" Kosmos.pkg "BOTH" "$WANT"; cp "$WWW/dist/"* "$EXP/dist/"
out="$(run9c prod "Kosmos.pkg Kosmos-staging.pkg" " Kosmos.pkg Kosmos-staging.pkg")"; rc=$?
[ "$rc" = 0 ] && case "$out" in *NINE-C-OK*) true;; *) false;; esac && case "$out" in *"did not move"*) false;; *) true;; esac && pass "9c prod: both current passes, with no staging-only check" || bad "9c prod pass (rc=$rc out=$out)"
[ -z "$(find "$BR" -name 'pkg9c.*' 2>/dev/null)" ] && pass "9c: no temp dir left behind" || bad "9c left temp dirs in BUILD_ROOT"

# ---- the export guard: a staging cut refuses to deploy an export whose Kosmos.pkg is not the pre-cut served one ----
runx() {   # <channel> <served-sha-before>
  ( set -e; CUT_CHANNEL="$1"; PKG_PROD_SERVED_SHA="$2"; _site_export="$EXP"; HOST="http://127.0.0.1:$PORT"; eval "$CX"; echo "EXPORT-OK" ) 2>&1
}
# The host serves what the export holds, unless an arm moves it.
serve; mk "$EXP/dist" Kosmos.pkg "PROD" "$OLDIN"; BEFORE="$(psha "$EXP/dist/Kosmos.pkg")"; cp "$EXP/dist/Kosmos.pkg.sha256" "$WWW/dist/"
out="$(runx staging "$BEFORE")"; rc=$?
[ "$rc" = 0 ] && case "$out" in *EXPORT-OK*) true;; *) false;; esac && pass "export guard: the pre-cut Kosmos.pkg in the export deploys" || bad "export guard pass arm (rc=$rc out=$out)"
mk "$EXP/dist" Kosmos.pkg "CHANGED-AFTER-3C" "$WANT"
out="$(runx staging "$BEFORE")"; rc=$?
[ "$rc" != 0 ] && case "$out" in *"something changed the site dist after step 3c"*) true;; *) false;; esac && pass "export guard: a Kosmos.pkg changed after 3c refuses the deploy" || bad "export guard changed arm (rc=$rc out=$out)"
rm -f "$EXP/dist/Kosmos.pkg"*; mk "$EXP/dist" Kosmos-staging.pkg "STAGING" "$WANT"
out="$(runx staging "$BEFORE")"; rc=$?
[ "$rc" != 0 ] && case "$out" in *"has no whole Kosmos.pkg triple"*) true;; *) false;; esac && pass "export guard: an export with only the staging pkg refuses (the Download button would 404)" || bad "export guard staging-only arm (rc=$rc out=$out)"
serve; mk "$EXP/dist" Kosmos.pkg "PROD" "$OLDIN"; mk "$WWW/dist" Kosmos.pkg "PROMOTED-ELSEWHERE" "$WANT"
out="$(runx staging "$(psha "$EXP/dist/Kosmos.pkg")")"; rc=$?
[ "$rc" != 0 ] && case "$out" in *"it moved during this cut"*) true;; *) false;; esac && pass "export guard: a served Kosmos.pkg that moved during the cut refuses (no rollback)" || bad "export guard moved arm (rc=$rc out=$out)"
out="$(runx prod "$BEFORE")"; rc=$?
[ "$rc" = 0 ] && pass "export guard: CONTROL a prod cut is not held to the pre-cut sha" || bad "export guard prod control (rc=$rc out=$out)"

# ---- kosmos#8172: the pointer names its installer pkg (pkg_sha256) ------------------------------------------
WR="$REPO_REAL/tools/lib/write-latest-pointer.js"; PJ="$T/ptr8172.json"; G="$(printf 'pkg' | shasum -a 256 | awk '{print $1}')"
KM_LJ_VERSION=1 KM_LJ_SHA=a KM_LJ_ARTIFACT=b KM_LJ_MANIFEST=c node "$WR" "$PJ" && ! grep -q pkg_sha256 "$PJ" && pass "8172 writer: no KM_LJ_PKG_SHA, no field (CONTROL: the old shape)" || bad "8172 writer wrote a pkg field it was not given: $(cat "$PJ")"
KM_LJ_VERSION=1 KM_LJ_SHA=a KM_LJ_ARTIFACT=b KM_LJ_MANIFEST=c KM_LJ_PKG_SHA="$G" node "$WR" "$PJ" && grep -q "\"pkg_sha256\":\"$G\"" "$PJ" && pass "8172 writer: KM_LJ_PKG_SHA becomes pkg_sha256" || bad "8172 writer did not write pkg_sha256: $(cat "$PJ")"
KM_LJ_VERSION=1 KM_LJ_SHA=a KM_LJ_ARTIFACT=b KM_LJ_MANIFEST=c KM_LJ_PKG_SHA=NOTASHA node "$WR" "$PJ" 2>/dev/null && bad "8172 writer accepted a non-sha pkg" || pass "8172 writer: refuses a KM_LJ_PKG_SHA that is not a sha256"

# release.sh: the pointer names the pkg the cut leaves for ITS channel. The block is extracted by its markers and run.
CP="$(awk '/^# kosmos#8172: and the installer pkg it leaves for its channel/{p=1} p{print} p&&/^KM_PKG_SHA=/{exit}' "$REL")"
case "$CP" in *'KM_PKG_NAME="$PKG_STAGING_NAME"'*'KM_PKG_SHA="$(pkg_triple_check'*) pass "8172 release: extracted the pointer's pkg block" ;; *) bad "8172 release: could not extract the pointer's pkg block"; CP="exit 99" ;; esac
grep -qF 'KM_LJ_PKG_SHA="$KM_PKG_SHA"' "$REL" && pass "8172 release: the cut's pointer is written with KM_LJ_PKG_SHA" || bad "8172 release: the pointer write does not pass KM_LJ_PKG_SHA"
D="$(newsite)"; mk "$D" Kosmos.pkg "PROD" "$OLDIN"; mk "$D" Kosmos-staging.pkg "STAGING" "$WANT"
got="$( CUT_CHANNEL=staging; SITE="$(dirname "$D")"; eval "$CP" && printf '%s' "$KM_PKG_SHA" )"
[ "$got" = "$(psha "$D/Kosmos-staging.pkg")" ] && pass "8172 release: a staging cut's pointer names Kosmos-staging.pkg" || bad "8172 release staging names '$got'"
got="$( CUT_CHANNEL=prod; SITE="$(dirname "$D")"; eval "$CP" && printf '%s' "$KM_PKG_SHA" )"
[ "$got" = "$(psha "$D/Kosmos.pkg")" ] && pass "8172 release: CONTROL a prod cut's pointer names Kosmos.pkg" || bad "8172 release prod names '$got'"
printf 'tampered' > "$D/Kosmos-staging.pkg"
( CUT_CHANNEL=staging; SITE="$(dirname "$D")"; eval "$CP" ) >/dev/null 2>&1 && bad "8172 release: a broken staging triple was named" || pass "8172 release: a broken triple stops the cut instead of being named"

# verify-served.sh: its pkg block (with the #8167 dispatch) is extracted and run against the stand-in host, with
# pkgutil and xcrun stubbed so the signature and staple lines answer for the fixture.
VS="$(awk '/^_vs_pkg\(\) \{/{p=1} p{print} p&&/^esac$/{exit}' "$REPO_REAL/tools/verify-served.sh")"
case "$VS" in *'_vs_pkg() {'*'_vs_ptr'*'esac') pass "8172 verify-served: extracted the pkg block" ;; *) bad "8172 verify-served: could not extract it"; VS="exit 99" ;; esac
runvs() {   # [pointer this run verifies, default latest.json]: prints the say lines, then FAIL=<n>
  ( fail=0; say(){ printf '%s | %s\n' "$1" "$2"; }; pkgutil(){ printf '%s\n' "$KOSMOS_SIGN_INSTALLER_DEFAULT"; }; xcrun(){ return 0; }
    POINTER="${1:-latest.json}"; HOST="http://127.0.0.1:$PORT"; REPO="$REPO_REAL"; pwant="$WANT"; eval "$VS"; echo "FAIL=$fail" ) 2>&1
}
ptr() { printf '{"version":"9","sha256":"x","artifact":"a","manifest":"m"%s}\n' "${2:+,\"pkg_sha256\":\"$2\"}" > "$WWW/dist/$1"; }
# (a) a staging pkg served, both pointers naming exactly what is served: clean.
serve; mk "$WWW/dist" Kosmos-staging.pkg "STAGING" "$WANT"; mk "$WWW/dist" Kosmos.pkg "PROD" "$OLDIN"
ptr latest-staging.json "$(psha "$WWW/dist/Kosmos-staging.pkg")"; ptr latest.json "$(psha "$WWW/dist/Kosmos.pkg")"
out="$(runvs)"
case "$out" in *"FAIL=0"*) true;; *) false;; esac && case "$out" in *"/dist/Kosmos.pkg vs latest.json | is the pkg the pointer names"*) true;; *) false;; esac && case "$out" in *"/dist/Kosmos-staging.pkg vs latest-staging.json | is the pkg the pointer names"*) true;; *) false;; esac \
  && pass "8172 verify-served: each served pkg is the one its pointer names, and it says so" || bad "8172 verify-served clean arm: $out"
# (b) the served Kosmos.pkg is NOT the one latest.json names: red on a prod verify, the defect #8172 exists for.
ptr latest.json "$(psha "$WWW/dist/Kosmos-staging.pkg")"
out="$(runvs latest.json)"
case "$out" in *"NOT the pkg the pointer names"*"FAIL=1"*) true;; *) false;; esac && pass "8172 verify-served: a Kosmos.pkg that is not latest.json's pkg reds a prod verify" || bad "8172 verify-served mismatch arm: $out"
# (b2) the same state on a STAGING verify is said, not failed (a promote that could not move the pkg leaves it so,
#      and a staging cut can neither cause nor repair it).
out="$(runvs latest-staging.json)"
case "$out" in *"not this run's channel (latest-staging.json), so not failed"*"FAIL=0"*) true;; *) false;; esac && pass "8172 verify-served: the same Kosmos.pkg mismatch does not red a staging verify" || bad "8172 verify-served cross-channel arm: $out"
# (e) THE PROD-CUT SHAPE: a prod cut rewrote Kosmos-staging.pkg under the older latest-staging.json. Its own (prod)
#     verify must stay green; a staging verify reds.
ptr latest.json "$(psha "$WWW/dist/Kosmos.pkg")"; ptr latest-staging.json "$(printf 'older' | shasum -a 256 | awk '{print $1}')"
out="$(runvs latest.json)"
case "$out" in *"/dist/Kosmos-staging.pkg vs latest-staging.json | differs"*"FAIL=0"*) true;; *) false;; esac && pass "8172 verify-served: a prod cut's verify is not failed by the staging pointer naming an older pkg" || bad "8172 verify-served prod-cut arm: $out"
out="$(runvs latest-staging.json)"
case "$out" in *"/dist/Kosmos-staging.pkg vs latest-staging.json | NOT the pkg the pointer names"*"FAIL=1"*) true;; *) false;; esac && pass "8172 verify-served: CONTROL a staging verify does red a staging pkg that is not its pointer's" || bad "8172 verify-served staging red arm: $out"
# (f) the OTHER channel's pointer is missing (a site that never had a staging cut): a prod verify says so and stays
#     green; the same missing pointer on a staging verify is its own channel, and reds.
ptr latest.json "$(psha "$WWW/dist/Kosmos.pkg")"; rm -f "$WWW/dist/latest-staging.json"
out="$(runvs latest.json)"
case "$out" in *"could not be fetched; not this run's channel (latest.json)"*"FAIL=0"*) true;; *) false;; esac && pass "8172 verify-served: a missing staging pointer does not red a prod verify" || bad "8172 verify-served missing-other arm: $out"
out="$(runvs latest-staging.json)"
case "$out" in *"/dist/latest-staging.json | could not be fetched, so"*"FAIL=1"*) true;; *) false;; esac && pass "8172 verify-served: CONTROL the same missing pointer reds a staging verify" || bad "8172 verify-served missing-own arm: $out"
# (g) a MALFORMED pkg_sha256 on this run's channel reds, and is not called "cut before #8172".
serve; mk "$WWW/dist" Kosmos.pkg "PROD" "$WANT"; ptr latest.json "$(psha "$WWW/dist/Kosmos.pkg" | tr 'a-f' 'A-F')"
out="$(runvs latest.json)"
case "$out" in *"pkg_sha256 is not a sha256, so it names nothing"*"FAIL=1"*) true;; *) false;; esac && pass "8172 verify-served: a malformed pkg_sha256 on this run's channel reds" || bad "8172 verify-served malformed arm: $out"
serve; mk "$WWW/dist" Kosmos-staging.pkg "STAGING" "$WANT"; mk "$WWW/dist" Kosmos.pkg "PROD" "$OLDIN"
ptr latest-staging.json "$(psha "$WWW/dist/Kosmos-staging.pkg")"; ptr latest.json "$(psha "$WWW/dist/Kosmos.pkg")"
# (c) pointers cut before #8172 name no pkg: said, not failed, and #8167's lag rule still holds.
ptr latest-staging.json ""; ptr latest.json ""
out="$(runvs)"
case "$out" in *"names no pkg (cut before kosmos#8172, or republished by hand): not checked"*"FAIL=0"*) true;; *) false;; esac && pass "8172 verify-served: CONTROL a pointer naming no pkg is reported, not failed" || bad "8172 verify-served no-field arm: $out"
# (d) no staging pkg served (404): only Kosmos.pkg, held to the source as before #8167.
serve; mk "$WWW/dist" Kosmos.pkg "PROD" "$WANT"; ptr latest.json "$(psha "$WWW/dist/Kosmos.pkg")"
out="$(runvs)"
case "$out" in *"Kosmos-staging"*) false;; *) true;; esac && case "$out" in *"/dist/Kosmos.pkg.inputs | matches source"*"FAIL=0"*) true;; *) false;; esac && pass "8172 verify-served: with no staging pkg served, Kosmos.pkg is held to the source" || bad "8172 verify-served 404 arm: $out"

echo ""
if [ "$fail" = 0 ]; then echo "test-pkg-channel-8167: ALL PASS"; else echo "test-pkg-channel-8167: FAILURES above"; exit 1; fi
