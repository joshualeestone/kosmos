#!/usr/bin/env bash
# test-setup-staging-5032.sh - kosmos#5032: the installer is channelled like the pointer.
#
# A staging cut publishes /setup-staging and leaves /setup (what prod installs and prod updates run)
# at the prior prod installer; promote-channel.sh copies the pair onto /setup; the cut's abort restore
# and deploy-site.sh --promote keep the two honest. Before #5032 every cut wrote /setup, so a staging
# cut's untested installer ran on every prod box against the OLD prod tarball.
#
# Covered here: release.sh's channel selection (extracted and evaluated) and its step 5 / site paths /
# verify call (source checks); verify-served.sh's name gate (run); release_site_restore's two new arms
# (run, each with a control); promote-channel.sh's copy and its four refusals (run against a fixture
# git site, with a control that /setup really changed); deploy-site.sh's promote guard (source check:
# the deploy itself needs a live host). engine/update.js's setupUrl is covered by
# engine/update.win32-check.test.js ("#5032: ...").
#
#   bash tools/test-setup-staging-5032.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/setup-staging-5032.XXXXXXXX")"
trap 'rm -rf "$T"' EXIT
fail=0
pass() { printf 'PASS  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fail=1; }
has()  { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

# ---- release.sh: the channel selects the installer's name (the case block, extracted and evaluated) ----
SEL="$(awk '/^case "\$CUT_CHANNEL" in$/{p=1} p{print} p&&/^esac$/{exit}' "$REPO/tools/release.sh")"
[ -n "$SEL" ] && pass "release: found the channel case block" || bad "release: no channel case block"
pick() { ( CUT_CHANNEL="$1"; eval "$SEL"; printf '%s %s' "$POINTER_FILE" "$SETUP_FILE" ) 2>/dev/null; }
[ "$(pick staging)" = "latest-staging.json setup-staging" ] && pass "release: a staging cut writes setup-staging" || bad "release: staging -> '$(pick staging)'"
[ "$(pick prod)" = "latest.json setup" ] && pass "release: a prod cut writes setup (CONTROL: the prod arm is unchanged)" || bad "release: prod -> '$(pick prod)'"
grep -qF 'cp "$REPO/dist/setup" "$SITE/$SETUP_FILE"' "$REPO/tools/release.sh" && grep -qF 'cp "$REPO/dist/setup.sha256" "$SITE/$SETUP_FILE.sha256"' "$REPO/tools/release.sh" \
  && pass "release: step 5 copies to \$SETUP_FILE" || bad "release: step 5 does not copy to \$SETUP_FILE"
grep -qF 'cp "$REPO/dist/setup" "$SITE/setup"' "$REPO/tools/release.sh" && bad "release: step 5 still writes /setup unconditionally" || pass "release: no unconditional write of /setup is left"
grep -qF '_site_paths="dist/$POINTER_FILE dist/kosmos-$V-arm64.manifest.json $SETUP_FILE $SETUP_FILE.sha256 versions.html"' "$REPO/tools/release.sh" \
  && pass "release: the release commit carries the channel's installer pair" || bad "release: _site_paths does not name \$SETUP_FILE"
grep -qF 'KOSMOS_VERIFY_SETUP="$SETUP_FILE"' "$REPO/tools/release.sh" && pass "release: step 9 verifies the channel's installer" || bad "release: step 9 does not pass KOSMOS_VERIFY_SETUP"

# ---- verify-served.sh: only the two names, refused before any fetch ----
# HOST is a port nothing listens on: a name that got past the gate would fail at the network
# control instead, with a different sentence (that is the control arm).
out="$(KOSMOS_VERIFY_SETUP=setupx HOST=http://127.0.0.1:9 REPO="$REPO" bash "$REPO/tools/verify-served.sh" 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "must be setup or setup-staging" && pass "verify-served: refuses a name that is not setup or setup-staging" || bad "verify-served bad name (rc=$rc, out=$out)"
out="$(KOSMOS_VERIFY_SETUP=setup-staging HOST=http://127.0.0.1:9 REPO="$REPO" bash "$REPO/tools/verify-served.sh" 2>&1)"; rc=$?
! has "$out" "must be setup or setup-staging" && has "$out" "CONTROL" && pass "verify-served: CONTROL setup-staging passes the gate and reaches the network control" || bad "verify-served good name (rc=$rc, out=$out)"

# ---- release_site_restore: the staging installer pair on abort ----
. "$REPO/tools/lib/release-freeze.sh"
newsite() {
  local d; d="$(mktemp -d "$T/site.XXXXXX")"; mkdir -p "$d/dist"
  git -C "$d" init -q; git -C "$d" config user.email t@t; git -C "$d" config user.name t
  echo '{"version":"1.0.0"}' > "$d/dist/latest.json"
  printf 'PROD-INSTALLER\n' > "$d/setup"; ( cd "$d" && shasum -a 256 setup > setup.sha256 )
  git -C "$d" add dist/latest.json setup setup.sha256; git -C "$d" commit -qm init
  printf '%s' "$d"
}
# A first staging cut wrote an UNTRACKED pair and aborted: removed.
S="$(newsite)"; printf 'NEVER-SERVED\n' > "$S/setup-staging"; echo x > "$S/setup-staging.sha256"
release_site_restore "$S" 1.0.1 1 >/dev/null
[ ! -e "$S/setup-staging" ] && [ ! -e "$S/setup-staging.sha256" ] && pass "restore: an untracked setup-staging pair is removed" || bad "restore left an untracked setup-staging pair"
[ "$(cat "$S/setup")" = PROD-INSTALLER ] && pass "restore: CONTROL /setup is left alone" || bad "restore touched /setup"
# A later staging cut changed a TRACKED pair and aborted: put back to the committed bytes.
S="$(newsite)"; printf 'SERVED-STAGING\n' > "$S/setup-staging"; ( cd "$S" && shasum -a 256 setup-staging > setup-staging.sha256 )
git -C "$S" add setup-staging setup-staging.sha256; git -C "$S" commit -qm staging
printf 'ABORTED-STAGING\n' > "$S/setup-staging"; echo y > "$S/setup-staging.sha256"
release_site_restore "$S" 1.0.2 1 >/dev/null
[ "$(cat "$S/setup-staging")" = SERVED-STAGING ] && git -C "$S" diff --quiet -- setup-staging.sha256 && pass "restore: a changed tracked setup-staging pair is put back" || bad "restore did not put back the tracked setup-staging pair"

# ---- promote-channel.sh: the staging installer moves onto /setup with the pointer ----
V=9.9.9; ART="kosmos-$V-arm64.tar.gz"
STUB="$T/stub-gate.sh"; printf '#!/usr/bin/env bash\nexit 0\n' > "$STUB"; chmod +x "$STUB"
export KOSMOS_PROMOTE_GATE_CMD="bash $STUB" KOSMOS_PROMOTE_AGENT_GATE_CMD="bash $STUB" KOSMOS_PROMOTE_PLUS_GATE_CMD="bash $STUB" KOSMOS_PROMOTE_TUNNEL_GATE_CMD="bash $STUB"
export KOSMOS_PLUS_VERIFY_DIR="$T/plus-verify"
promote_site() {   # a git site: committed prod installer, a published staging pointer, and (with $1=yes) a committed staging installer
  local s; s="$(newsite)"
  printf 'ARTIFACT-BYTES-%s\n' "$V" > "$s/dist/$ART"; ( cd "$s/dist" && shasum -a 256 "$ART" > "$ART.sha256" )
  printf '{"files":[]}\n' > "$s/dist/kosmos-$V-arm64.manifest.json"
  bash "$HERE/publish-staging-pointer.sh" "$s" >/dev/null 2>&1
  if [ "${1:-}" = yes ]; then
    printf 'STAGING-INSTALLER\n' > "$s/setup-staging"; ( cd "$s" && shasum -a 256 setup-staging | sed 's/setup-staging$/setup/' > setup-staging.sha256 )
    git -C "$s" add setup-staging setup-staging.sha256; git -C "$s" commit -qm "staging installer"
    name_installer "$s" "$(shasum -a 256 < "$s/setup-staging" | awk '{print $1}')"   # the staging pointer names it, as release.sh writes it
  fi
  printf '%s' "$s"
}
name_installer() { node -e 'const f=process.argv[1];const p=JSON.parse(require("fs").readFileSync(f,"utf8"));p.setup_sha256=process.argv[2];require("fs").writeFileSync(f,JSON.stringify(p)+"\n")' "$1/dist/latest-staging.json" "$2"; }
Sp="$(promote_site yes)"
[ "$(cat "$Sp/setup")" = PROD-INSTALLER ] && pass "promote: CONTROL before the promote /setup is the prod installer" || bad "promote fixture: /setup is not the prod installer"
out="$(bash "$HERE/promote-channel.sh" "$Sp" 2>&1)"; rc=$?
[ "$rc" = 0 ] && pass "promote: exit 0" || bad "promote exit (rc=$rc, out=$out)"
cmp -s "$Sp/setup-staging" "$Sp/setup" && cmp -s "$Sp/setup-staging.sha256" "$Sp/setup.sha256" && pass "promote: /setup and its sidecar are now the staging pair" || bad "promote did not copy setup-staging onto setup"
( cd "$Sp" && [ "$(awk '{print $1}' setup.sha256)" = "$(shasum -a 256 < setup | awk '{print $1}')" ] ) && pass "promote: the promoted /setup.sha256 names the promoted bytes" || bad "promoted setup.sha256 does not describe setup"
has "$out" "COMMIT setup and setup.sha256" && pass "promote: says to commit the installer pair with the pointer" || bad "promote did not say to commit the pair (out=$out)"
ls -a "$Sp" | grep -q '^\.setup' && bad "promote left a .setup temp file" || pass "promote: no temp file left beside /setup"

# The pointer names no installer (a cut before #5032, or a hand republish): /setup is left alone and the
# promote goes on, EVEN with a committed setup-staging beside it (nothing says which build it belongs to).
Sa="$(promote_site no)"
out="$(bash "$HERE/promote-channel.sh" "$Sa" 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$Sa/setup")" = PROD-INSTALLER ] && grep -q '"9.9.9"' "$Sa/dist/latest.json" && has "$out" "names no installer" \
  && pass "promote: a pointer naming no installer leaves /setup as it is and still promotes" || bad "promote no-field arm (rc=$rc, out=$out)"
Sb="$(promote_site no)"; printf 'SOME-INSTALLER\n' > "$Sb/setup-staging"; ( cd "$Sb" && shasum -a 256 setup-staging > setup-staging.sha256 ); git -C "$Sb" add setup-staging setup-staging.sha256; git -C "$Sb" commit -qm x
out="$(bash "$HERE/promote-channel.sh" "$Sb" 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$Sb/setup")" = PROD-INSTALLER ] && pass "promote: CONTROL a committed setup-staging the pointer does not name is not copied" || bad "promote copied an unnamed setup-staging (rc=$rc, out=$out)"

# Refusals: each leaves BOTH the prod pointer and /setup untouched.
refused() {   # label site expected-phrase
  local out rc; out="$(bash "$HERE/promote-channel.sh" "$2" 2>&1)"; rc=$?
  # newsite committed a prod pointer naming 1.0.0: untouched means it still does.
  if [ "$rc" = 1 ] && [ "$(cat "$2/dist/latest.json")" = '{"version":"1.0.0"}' ] && [ "$(cat "$2/setup")" = PROD-INSTALLER ] && has "$out" "$3"; then pass "promote: refuses $1, nothing written"
  else bad "promote $1 (rc=$rc, latest.json: $(cat "$2/dist/latest.json"), out=$out)"; fi
}
Su="$(promote_site no)"; printf 'NEVER-SERVED\n' > "$Su/setup-staging"; ( cd "$Su" && shasum -a 256 setup-staging > setup-staging.sha256 )
name_installer "$Su" "$(shasum -a 256 < "$Su/setup-staging" | awk '{print $1}')"
refused "an untracked setup-staging the pointer names" "$Su" "is not committed"
Sg="$(promote_site no)"; name_installer "$Sg" "$(printf 'X\n' | shasum -a 256 | awk '{print $1}')"
refused "a pointer naming an installer the site does not have" "$Sg" "is not committed"
So="$(promote_site yes)"; name_installer "$So" "$(printf 'ANOTHER-CUT\n' | shasum -a 256 | awk '{print $1}')"
refused "a setup-staging that is not the installer the pointer names" "$So" "but the staging pointer names installer"
Sm="$(promote_site yes)"; printf 'EDITED\n' > "$Sm/setup-staging"; ( cd "$Sm" && shasum -a 256 setup-staging | sed 's/setup-staging$/setup/' > setup-staging.sha256 )
refused "a setup-staging that differs from its committed copy" "$Sm" "differs from its committed copy"
Sx="$(promote_site yes)"; printf '%s  setup\n' "$(printf 0%.0s $(seq 64))" > "$Sx/setup-staging.sha256"; git -C "$Sx" commit -qam "bad sidecar"
refused "a sidecar that does not name the bytes" "$Sx" "not the setup-staging bytes"
Sh="$(promote_site yes)"; rm -f "$Sh/setup-staging"; git -C "$Sh" commit -qam "script gone, sidecar kept" >/dev/null 2>&1
refused "a sidecar with no script" "$Sh" "not committed"

# ---- deploy-site.sh: the guard (the pointer names its installer) is RUN in tools/test-deploy-site-promote.sh
# (cases 19-22). Here only that the staging pair is edge-checked after a deploy (needs a live host to run).
grep -qF 'served_verify_asset_ok "$HOST/setup-staging"' "$REPO/tools/deploy-site.sh" && pass "deploy-site: the staging pair is checked at the edge" || bad "deploy-site: no edge check for /setup-staging"

# ---- the pointer writer: setup_sha256 only when given, and only a real sha ----
WR="$REPO/tools/lib/write-latest-pointer.js"; P="$T/ptr.json"; G="$(printf 'g\n' | shasum -a 256 | awk '{print $1}')"
KM_LJ_VERSION=1 KM_LJ_SHA=a KM_LJ_ARTIFACT=b KM_LJ_MANIFEST=c node "$WR" "$P" && ! grep -q setup_sha256 "$P" && pass "writer: no KM_LJ_SETUP_SHA, no field (CONTROL: the old shape)" || bad "writer wrote a field it was not given: $(cat "$P")"
KM_LJ_VERSION=1 KM_LJ_SHA=a KM_LJ_ARTIFACT=b KM_LJ_MANIFEST=c KM_LJ_SETUP_SHA="$G" node "$WR" "$P" && grep -q "\"setup_sha256\":\"$G\"" "$P" && pass "writer: KM_LJ_SETUP_SHA becomes setup_sha256" || bad "writer did not write setup_sha256: $(cat "$P")"
KM_LJ_VERSION=1 KM_LJ_SHA=a KM_LJ_ARTIFACT=b KM_LJ_MANIFEST=c KM_LJ_SETUP_SHA=NOTASHA node "$WR" "$P" 2>/dev/null && bad "writer accepted a non-sha installer" || pass "writer: refuses a KM_LJ_SETUP_SHA that is not a sha256"
grep -qF 'KM_LJ_SETUP_SHA="$KM_SETUP_SHA"' "$REPO/tools/release.sh" && pass "release: the cut's pointer names its installer" || bad "release: the pointer does not get KM_LJ_SETUP_SHA"

echo ""
if [ "$fail" = 0 ]; then echo "test-setup-staging-5032: ALL PASS"; else echo "test-setup-staging-5032: FAILURES above"; exit 1; fi
