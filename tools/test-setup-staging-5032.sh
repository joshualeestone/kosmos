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
# (run, each with a control); promote-channel.sh's copy and its refusals (run against a fixture git site,
# with a control that /setup really changed). deploy-site.sh's guard is RUN in test-deploy-site-promote.sh
# (cases 19-25). engine/update.js's setupUrl is covered by
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

# ---- release.sh: the pointer's setup_sha256 comes from the build's own installer pair (the block, RUN) ----
BLK="$(awk '/^KM_SETUP_SHA="\$\(awk/{p=1} p{print} p&&/does not name dist\/setup.s bytes/{exit}' "$REPO/tools/release.sh")"
[ -n "$BLK" ] && pass "release: found the installer-sha block" || bad "release: no installer-sha block"
F="$T/fixrepo"; mkdir -p "$F/dist"; printf 'BUILT-INSTALLER\n' > "$F/dist/setup"; ( cd "$F/dist" && shasum -a 256 setup > setup.sha256 )
WANT="$(shasum -a 256 < "$F/dist/setup" | awk '{print $1}')"
got="$( REPO="$F"; eval "$BLK" && printf '%s' "$KM_SETUP_SHA" )" ; rc=$?
[ "$rc" = 0 ] && [ "$got" = "$WANT" ] && pass "release: KM_SETUP_SHA is the built installer's sha (not the artifact's)" || bad "release: KM_SETUP_SHA wrong (rc=$rc got=$got want=$WANT)"
printf '%064d  setup\n' 0 > "$F/dist/setup.sha256"
( REPO="$F"; eval "$BLK" ) 2>/dev/null && bad "release: a lying dist/setup.sha256 was accepted" || pass "release: a dist/setup.sha256 that does not name dist/setup refuses the cut"

# 1f: a staging cut refuses before the bump unless the site's ORIGIN/MAIN vercel.json serves /setup-staging uncached.
# The block is extracted and RUN against fixture sites (a bare origin, a checkout of it).
a="$(grep -n 'step "== 1f. the site serves /setup-staging uncached' "$REPO/tools/release.sh" | cut -d: -f1)"; b="$(grep -n 'step "== 2. the version, in one place ==' "$REPO/tools/release.sh" | cut -d: -f1)"
[ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ] && pass "release: step 1f sits before the version bump" || bad "release: step 1f is not before the bump ($a vs $b)"
F1F="$(sed -n "$((a+1)),$((b-1))p" "$REPO/tools/release.sh")"
# The extracted region must be exactly step 1f's block: no other step crept in between (it would run here too).
case "$F1F" in *'step "'*) bad "release 1f: the region before step 2 holds another step; extract it by its own markers" ;; esac
case "$F1F" in *'if [ "$CUT_CHANNEL" = staging ]; then'*'/setup-staging'*) pass "release 1f: the extracted region is the 1f block" ;; *) bad "release 1f: the extracted region is not the 1f block" ;; esac
site_with(){ # <vercel.json text> -> a checkout whose origin/main holds it
  local o d; o="$(mktemp -d "$T/vo.XXXXXX")"; d="$(mktemp -d "$T/vs.XXXXXX")"
  git init -q --bare "$o"; git -C "$d" init -q; git -C "$d" config user.email t@t; git -C "$d" config user.name t
  printf '%s\n' "$1" > "$d/vercel.json"; git -C "$d" add vercel.json; git -C "$d" commit -qm v
  git -C "$d" remote add origin "$o"; git -C "$d" push -q origin HEAD:main; printf '%s' "$d"
}
WITH="$(site_with '{"headers":[{"source": "/setup-staging","headers":[]},{"source": "/setup-staging.sha256","headers":[]}]}')"; WITHOUT="$(site_with '{"headers":[]}')"
( CUT_CHANNEL=staging; SITE="$WITH"; eval "$F1F" ) >/dev/null 2>&1 && pass "release 1f: passes when the site's origin/main has the /setup-staging rule" || bad "release 1f refused a site that has the rule"
( CUT_CHANNEL=staging; SITE="$WITHOUT"; eval "$F1F" ) >/dev/null 2>&1 && bad "release 1f passed a site without the rule" || pass "release 1f: refuses when the site's origin/main lacks it"
HALF="$(site_with '{"headers":[{"source": "/setup-staging","headers":[]}]}')"
( CUT_CHANNEL=staging; SITE="$HALF"; eval "$F1F" ) >/dev/null 2>&1 && bad "release 1f passed a site with no .sha256 rule" || pass "release 1f: refuses when only the script's rule is there (not the sidecar's)"
# The local working tree is NOT what counts: a rule only in the checkout (uncommitted) still refuses.
printf '{"headers":[{"source": "/setup-staging"}]}\n' > "$WITHOUT/vercel.json"
( CUT_CHANNEL=staging; SITE="$WITHOUT"; eval "$F1F" ) >/dev/null 2>&1 && bad "release 1f trusted the local working tree" || pass "release 1f: reads origin/main, not the local checkout"
( CUT_CHANNEL=prod; SITE="$WITHOUT"; eval "$F1F" ) >/dev/null 2>&1 && pass "release 1f: CONTROL a prod cut is not asked" || bad "release 1f refused a prod cut"

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
# Untracked here but ALREADY on origin/main with the same bytes (a cut that died after its 7b push): kept.
# With other bytes (an older copy on origin/main): removed, or the next pull would refuse to overwrite it.
OR="$T/origin-site.git"; git init -q --bare "$OR"
S="$(newsite)"; git -C "$S" remote add origin "$OR"
printf 'PUSHED-STAGING\n' > "$S/setup-staging"; ( cd "$S" && shasum -a 256 setup-staging > setup-staging.sha256 )
git -C "$S" add setup-staging setup-staging.sha256; git -C "$S" commit -qm pushed; git -C "$S" push -q origin HEAD:main; git -C "$S" fetch -q origin
git -C "$S" rm -q --cached setup-staging setup-staging.sha256; git -C "$S" commit -qm "local checkout without it"
release_site_restore "$S" 1.0.3 1 >/dev/null
[ "$(cat "$S/setup-staging" 2>/dev/null)" = PUSHED-STAGING ] && pass "restore: an untracked pair origin/main already holds (same bytes) is kept" || bad "restore removed a pair origin/main holds"
printf 'NEWER-NEVER-SERVED\n' > "$S/setup-staging"
release_site_restore "$S" 1.0.4 1 >/dev/null
[ ! -e "$S/setup-staging" ] && pass "restore: CONTROL an untracked pair whose bytes differ from origin/main's is removed" || bad "restore kept bytes origin/main does not hold"
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
has "$out" "WARNING setup-staging differs from /setup" && pass "promote: ...and says loudly that prod now serves the build beside the older /setup" || bad "promote did not warn about the unnamed, differing setup-staging (out=$out)"
has "$(bash "$HERE/promote-channel.sh" "$(promote_site no)" 2>&1)" "WARNING setup-staging differs" && bad "promote warned with no setup-staging at all" || pass "promote: CONTROL no setup-staging, no warning"

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
# The gates take minutes: a setup-staging replaced while they ran is refused before the first write.
Sc="$(promote_site yes)"; CHG="$T/stub-changing-gate.sh"
printf '#!/usr/bin/env bash\nprintf "REPLACED-DURING-GATES\\n" > "$CHANGE_SITE/setup-staging"\nexit 0\n' > "$CHG"; chmod +x "$CHG"
out="$(CHANGE_SITE="$Sc" KOSMOS_PROMOTE_GATE_CMD="bash $CHG" bash "$HERE/promote-channel.sh" "$Sc" 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "changed while the gates ran" && [ "$(cat "$Sc/dist/latest.json")" = '{"version":"1.0.0"}' ] && [ "$(cat "$Sc/setup")" = PROD-INSTALLER ] \
  && pass "promote: a setup-staging replaced while the gates ran is refused, nothing written" || bad "promote changed-during-gates (rc=$rc, out=$out)"
Sx="$(promote_site yes)"; printf '%s  setup\n' "$(printf 0%.0s $(seq 64))" > "$Sx/setup-staging.sha256"; git -C "$Sx" commit -qam "bad sidecar"
refused "a sidecar that does not name the bytes" "$Sx" "not the setup-staging bytes"
Sh="$(promote_site yes)"; rm -f "$Sh/setup-staging"; git -C "$Sh" commit -qam "script gone, sidecar kept" >/dev/null 2>&1
refused "a sidecar with no script" "$Sh" "not committed"

# ---- deploy-site.sh: the guard (the pointer names its installer) is RUN in tools/test-deploy-site-promote.sh
# (cases 19-25, the edge check included).
grep -qF 'served_verify_asset_ok "$HOST/setup-staging"' "$REPO/tools/deploy-site.sh" && pass "deploy-site: the staging pair is checked at the edge" || bad "deploy-site: no edge check for /setup-staging"

# ---- the pointer writer: setup_sha256 only when given, and only a real sha ----
WR="$REPO/tools/lib/write-latest-pointer.js"; P="$T/ptr.json"; G="$(printf 'g\n' | shasum -a 256 | awk '{print $1}')"
KM_LJ_VERSION=1 KM_LJ_SHA=a KM_LJ_ARTIFACT=b KM_LJ_MANIFEST=c node "$WR" "$P" && ! grep -q setup_sha256 "$P" && pass "writer: no KM_LJ_SETUP_SHA, no field (CONTROL: the old shape)" || bad "writer wrote a field it was not given: $(cat "$P")"
KM_LJ_VERSION=1 KM_LJ_SHA=a KM_LJ_ARTIFACT=b KM_LJ_MANIFEST=c KM_LJ_SETUP_SHA="$G" node "$WR" "$P" && grep -q "\"setup_sha256\":\"$G\"" "$P" && pass "writer: KM_LJ_SETUP_SHA becomes setup_sha256" || bad "writer did not write setup_sha256: $(cat "$P")"
KM_LJ_VERSION=1 KM_LJ_SHA=a KM_LJ_ARTIFACT=b KM_LJ_MANIFEST=c KM_LJ_SETUP_SHA=NOTASHA node "$WR" "$P" 2>/dev/null && bad "writer accepted a non-sha installer" || pass "writer: refuses a KM_LJ_SETUP_SHA that is not a sha256"
grep -qF 'KM_LJ_SETUP_SHA="$KM_SETUP_SHA"' "$REPO/tools/release.sh" && pass "release: the cut's pointer names its installer" || bad "release: the pointer does not get KM_LJ_SETUP_SHA"
grep -qF 'KOSMOS_VERIFY_SETUP="$SETUP_FILE" bash "$REPO/tools/kosmos-artifact-check.sh"' "$REPO/tools/release.sh" && grep -qF '"$SITE/$SETUP_NAME"' "$REPO/tools/kosmos-artifact-check.sh" \
  && pass "release: step 9e audits the channel's installer (so a staging floor raise is not a false red)" || bad "release: step 9e does not audit the channel's installer"

# ---- publish-staging-pointer.sh: a hand republish keeps the installer name only for the same build ----
Sr="$(promote_site yes)"; NAMED="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).setup_sha256||"")' "$Sr/dist/latest-staging.json")"
bash "$HERE/publish-staging-pointer.sh" "$Sr" >/dev/null 2>&1
grep -q "\"setup_sha256\":\"$NAMED\"" "$Sr/dist/latest-staging.json" && [ -n "$NAMED" ] && pass "publish-staging: republishing the same build keeps the installer it names" || bad "publish-staging dropped the installer name on a same-build republish: $(cat "$Sr/dist/latest-staging.json")"
Sr2="$(promote_site yes)"; node -e 'const f=process.argv[1];const p=JSON.parse(require("fs").readFileSync(f,"utf8"));p.version="9.9.8";require("fs").writeFileSync(f,JSON.stringify(p)+"\n")' "$Sr2/dist/latest-staging.json"
bash "$HERE/publish-staging-pointer.sh" "$Sr2" >/dev/null 2>&1
! grep -q setup_sha256 "$Sr2/dist/latest-staging.json" && pass "publish-staging: CONTROL a republish of a DIFFERENT build names no installer" || bad "publish-staging carried an installer name across builds: $(cat "$Sr2/dist/latest-staging.json")"

echo ""
if [ "$fail" = 0 ]; then echo "test-setup-staging-5032: ALL PASS"; else echo "test-setup-staging-5032: FAILURES above"; exit 1; fi
