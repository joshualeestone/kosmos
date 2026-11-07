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
  ( set -e; CUT_CHANNEL="$1"; PKG_PROD_SERVED_SHA="$2"; _site_export="$EXP"; eval "$CX"; echo "EXPORT-OK" ) 2>&1
}
serve; mk "$EXP/dist" Kosmos.pkg "PROD" "$OLDIN"; BEFORE="$(psha "$EXP/dist/Kosmos.pkg")"
out="$(runx staging "$BEFORE")"; rc=$?
[ "$rc" = 0 ] && case "$out" in *EXPORT-OK*) true;; *) false;; esac && pass "export guard: the pre-cut Kosmos.pkg in the export deploys" || bad "export guard pass arm (rc=$rc out=$out)"
mk "$EXP/dist" Kosmos.pkg "CHANGED-AFTER-3C" "$WANT"
out="$(runx staging "$BEFORE")"; rc=$?
[ "$rc" != 0 ] && case "$out" in *"something changed the site dist after step 3c"*) true;; *) false;; esac && pass "export guard: a Kosmos.pkg changed after 3c refuses the deploy" || bad "export guard changed arm (rc=$rc out=$out)"
rm -f "$EXP/dist/Kosmos.pkg"*; mk "$EXP/dist" Kosmos-staging.pkg "STAGING" "$WANT"
out="$(runx staging "$BEFORE")"; rc=$?
[ "$rc" != 0 ] && case "$out" in *"has no whole Kosmos.pkg triple"*) true;; *) false;; esac && pass "export guard: an export with only the staging pkg refuses (the Download button would 404)" || bad "export guard staging-only arm (rc=$rc out=$out)"
out="$(runx prod "$BEFORE")"; rc=$?
[ "$rc" = 0 ] && pass "export guard: CONTROL a prod cut is not held to the pre-cut sha" || bad "export guard prod control (rc=$rc out=$out)"

echo ""
if [ "$fail" = 0 ]; then echo "test-pkg-channel-8167: ALL PASS"; else echo "test-pkg-channel-8167: FAILURES above"; exit 1; fi
