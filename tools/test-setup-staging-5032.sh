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
# (cases 19-27). engine/update.js's setupUrl is covered by
# engine/update.win32-check.test.js ("#5032: ...").
#
#   bash tools/test-setup-staging-5032.sh
set -uo pipefail
# kosmos#6149: these fixtures' versions are below the setup floor, so it is lowered here; their stand-in installers
# carry KOSMOS_READONLY_APP, since the installer check runs under any floor. tools/test-setup-floor-6149.sh tests the floor.
export KOSMOS_SETUP_FLOOR_TEST=1 KOSMOS_SETUP_FLOOR_LOWER=0.0.0
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/setup-staging-5032.XXXXXXXX")"
SRV8=""; trap '[ -z "$SRV8" ] || kill "$SRV8" 2>/dev/null; rm -rf "$T"' EXIT
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
grep -qF '_site_paths="dist/$POINTER_FILE dist/kosmos-$V-arm64.manifest.json dist/kosmos-$V-arm64.manifest.json.sig $SETUP_FILE $SETUP_FILE.sha256 versions.html"' "$REPO/tools/release.sh" \
  && pass "release: the release commit carries the channel's installer pair" || bad "release: _site_paths does not name \$SETUP_FILE"
grep -qF 'KOSMOS_VERIFY_SETUP="$SETUP_FILE"' "$REPO/tools/release.sh" && pass "release: step 9 verifies the channel's installer" || bad "release: step 9 does not pass KOSMOS_VERIFY_SETUP"

# ---- release.sh: the pointer's setup_sha256 comes from the build's own installer pair (the block, RUN) ----
BLK="$(awk '/^KM_SETUP_SHA="\$\(awk/{p=1} p{print} p&&/does not name dist\/setup.s bytes/{exit}' "$REPO/tools/release.sh")"
[ -n "$BLK" ] && pass "release: found the installer-sha block" || bad "release: no installer-sha block"
F="$T/fixrepo"; mkdir -p "$F/dist"; printf 'BUILT-INSTALLER KOSMOS_READONLY_APP\n' > "$F/dist/setup"; ( cd "$F/dist" && shasum -a 256 setup > setup.sha256 )
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
  printf 'PROD-INSTALLER KOSMOS_READONLY_APP\n' > "$d/setup"; ( cd "$d" && shasum -a 256 setup > setup.sha256 )
  git -C "$d" add dist/latest.json setup setup.sha256; git -C "$d" commit -qm init
  printf '%s' "$d"
}
# A first staging cut wrote an UNTRACKED pair and aborted: removed.
S="$(newsite)"; printf 'NEVER-SERVED KOSMOS_READONLY_APP\n' > "$S/setup-staging"; echo x > "$S/setup-staging.sha256"
release_site_restore "$S" 1.0.1 1 >/dev/null
[ ! -e "$S/setup-staging" ] && [ ! -e "$S/setup-staging.sha256" ] && pass "restore: an untracked setup-staging pair is removed" || bad "restore left an untracked setup-staging pair"
[ "$(cat "$S/setup")" = "PROD-INSTALLER KOSMOS_READONLY_APP" ] && pass "restore: CONTROL /setup is left alone" || bad "restore touched /setup"
# Untracked here but ALREADY on origin/main with the same bytes (a cut that died after its 7b push): kept.
# With other bytes (an older copy on origin/main): removed, or the next pull would refuse to overwrite it.
OR="$T/origin-site.git"; git init -q --bare "$OR"
S="$(newsite)"; git -C "$S" remote add origin "$OR"
printf 'PUSHED-STAGING KOSMOS_READONLY_APP\n' > "$S/setup-staging"; ( cd "$S" && shasum -a 256 setup-staging > setup-staging.sha256 )
git -C "$S" add setup-staging setup-staging.sha256; git -C "$S" commit -qm pushed; git -C "$S" push -q origin HEAD:main; git -C "$S" fetch -q origin
git -C "$S" rm -q --cached setup-staging setup-staging.sha256; git -C "$S" commit -qm "local checkout without it"
release_site_restore "$S" 1.0.3 1 >/dev/null
[ "$(cat "$S/setup-staging" 2>/dev/null)" = "PUSHED-STAGING KOSMOS_READONLY_APP" ] && pass "restore: an untracked pair origin/main already holds (same bytes) is kept" || bad "restore removed a pair origin/main holds"
printf 'NEWER-NEVER-SERVED KOSMOS_READONLY_APP\n' > "$S/setup-staging"
release_site_restore "$S" 1.0.4 1 >/dev/null
[ ! -e "$S/setup-staging" ] && pass "restore: CONTROL an untracked pair whose bytes differ from origin/main's is removed" || bad "restore kept bytes origin/main does not hold"
# A later staging cut changed a TRACKED pair and aborted: put back to the committed bytes.
S="$(newsite)"; printf 'SERVED-STAGING KOSMOS_READONLY_APP\n' > "$S/setup-staging"; ( cd "$S" && shasum -a 256 setup-staging > setup-staging.sha256 )
git -C "$S" add setup-staging setup-staging.sha256; git -C "$S" commit -qm staging
printf 'ABORTED-STAGING KOSMOS_READONLY_APP\n' > "$S/setup-staging"; echo y > "$S/setup-staging.sha256"
release_site_restore "$S" 1.0.2 1 >/dev/null
[ "$(cat "$S/setup-staging")" = "SERVED-STAGING KOSMOS_READONLY_APP" ] && git -C "$S" diff --quiet -- setup-staging.sha256 && pass "restore: a changed tracked setup-staging pair is put back" || bad "restore did not put back the tracked setup-staging pair"

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
    printf 'STAGING-INSTALLER KOSMOS_READONLY_APP\n' > "$s/setup-staging"; ( cd "$s" && shasum -a 256 setup-staging | sed 's/setup-staging$/setup/' > setup-staging.sha256 )
    git -C "$s" add setup-staging setup-staging.sha256; git -C "$s" commit -qm "staging installer"
    name_installer "$s" "$(shasum -a 256 < "$s/setup-staging" | awk '{print $1}')"   # the staging pointer names it, as release.sh writes it
  fi
  printf '%s' "$s"
}
name_installer() { node -e 'const f=process.argv[1];const p=JSON.parse(require("fs").readFileSync(f,"utf8"));p.setup_sha256=process.argv[2];require("fs").writeFileSync(f,JSON.stringify(p)+"\n")' "$1/dist/latest-staging.json" "$2"; }
Sp="$(promote_site yes)"
[ "$(cat "$Sp/setup")" = "PROD-INSTALLER KOSMOS_READONLY_APP" ] && pass "promote: CONTROL before the promote /setup is the prod installer" || bad "promote fixture: /setup is not the prod installer"
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
[ "$rc" = 0 ] && [ "$(cat "$Sa/setup")" = "PROD-INSTALLER KOSMOS_READONLY_APP" ] && grep -q '"9.9.9"' "$Sa/dist/latest.json" && has "$out" "names no installer" \
  && pass "promote: a pointer naming no installer leaves /setup as it is and still promotes" || bad "promote no-field arm (rc=$rc, out=$out)"
Sb="$(promote_site no)"; printf 'SOME-INSTALLER KOSMOS_READONLY_APP\n' > "$Sb/setup-staging"; ( cd "$Sb" && shasum -a 256 setup-staging > setup-staging.sha256 ); git -C "$Sb" add setup-staging setup-staging.sha256; git -C "$Sb" commit -qm x
out="$(bash "$HERE/promote-channel.sh" "$Sb" 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$Sb/setup")" = "PROD-INSTALLER KOSMOS_READONLY_APP" ] && pass "promote: CONTROL a committed setup-staging the pointer does not name is not copied" || bad "promote copied an unnamed setup-staging (rc=$rc, out=$out)"
has "$out" "WARNING setup-staging differs from /setup" && pass "promote: ...and says loudly that prod now serves the build beside the older /setup" || bad "promote did not warn about the unnamed, differing setup-staging (out=$out)"
has "$(bash "$HERE/promote-channel.sh" "$(promote_site no)" 2>&1)" "WARNING setup-staging differs" && bad "promote warned with no setup-staging at all" || pass "promote: CONTROL no setup-staging, no warning"

# Refusals: each leaves BOTH the prod pointer and /setup untouched.
refused() {   # label site expected-phrase
  local out rc; out="$(bash "$HERE/promote-channel.sh" "$2" 2>&1)"; rc=$?
  # newsite committed a prod pointer naming 1.0.0: untouched means it still does.
  if [ "$rc" = 1 ] && [ "$(cat "$2/dist/latest.json")" = '{"version":"1.0.0"}' ] && [ "$(cat "$2/setup")" = "PROD-INSTALLER KOSMOS_READONLY_APP" ] && has "$out" "$3"; then pass "promote: refuses $1, nothing written"
  else bad "promote $1 (rc=$rc, latest.json: $(cat "$2/dist/latest.json"), out=$out)"; fi
}
Su="$(promote_site no)"; printf 'NEVER-SERVED KOSMOS_READONLY_APP\n' > "$Su/setup-staging"; ( cd "$Su" && shasum -a 256 setup-staging > setup-staging.sha256 )
name_installer "$Su" "$(shasum -a 256 < "$Su/setup-staging" | awk '{print $1}')"
refused "an untracked setup-staging the pointer names" "$Su" "is not committed"
Sg="$(promote_site no)"; name_installer "$Sg" "$(printf 'X\n' | shasum -a 256 | awk '{print $1}')"
refused "a pointer naming an installer the site does not have" "$Sg" "is not committed"
So="$(promote_site yes)"; name_installer "$So" "$(printf 'ANOTHER-CUT\n' | shasum -a 256 | awk '{print $1}')"
refused "a setup-staging that is not the installer the pointer names" "$So" "but the staging pointer names installer"
Sm="$(promote_site yes)"; printf 'EDITED KOSMOS_READONLY_APP\n' > "$Sm/setup-staging"; ( cd "$Sm" && shasum -a 256 setup-staging | sed 's/setup-staging$/setup/' > setup-staging.sha256 )
refused "a setup-staging that differs from its committed copy" "$Sm" "differs from its committed copy"
# The gates take minutes: a setup-staging replaced while they ran is refused before the first write.
Sc="$(promote_site yes)"; CHG="$T/stub-changing-gate.sh"
printf '#!/usr/bin/env bash\nprintf "REPLACED-DURING-GATES\\n" > "$CHANGE_SITE/setup-staging"\nexit 0\n' > "$CHG"; chmod +x "$CHG"
out="$(CHANGE_SITE="$Sc" KOSMOS_PROMOTE_GATE_CMD="bash $CHG" bash "$HERE/promote-channel.sh" "$Sc" 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "changed while the gates ran" && [ "$(cat "$Sc/dist/latest.json")" = '{"version":"1.0.0"}' ] && [ "$(cat "$Sc/setup")" = "PROD-INSTALLER KOSMOS_READONLY_APP" ] \
  && pass "promote: a setup-staging replaced while the gates ran is refused, nothing written" || bad "promote changed-during-gates (rc=$rc, out=$out)"
Sx="$(promote_site yes)"; printf '%s  setup\n' "$(printf 0%.0s $(seq 64))" > "$Sx/setup-staging.sha256"; git -C "$Sx" commit -qam "bad sidecar"
refused "a sidecar that does not name the bytes" "$Sx" "not the setup-staging bytes"
Sh="$(promote_site yes)"; rm -f "$Sh/setup-staging"; git -C "$Sh" commit -qam "script gone, sidecar kept" >/dev/null 2>&1
refused "a sidecar with no script" "$Sh" "not committed"

# ---- deploy-site.sh: the guard (the pointer names its installer) is RUN in tools/test-deploy-site-promote.sh
# (cases 19-27, the edge check included).
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

# ---- kosmos#8167: the installer PKG moves with the promote too ----------------------------------------------
. "$REPO/tools/lib/pkg-inputs.sh"
mkpkg() {   # <site> <name> <bytes> <input-sha>
  printf '%s' "$3" > "$1/dist/$2"
  printf '%s  %s\n' "$(shasum -a 256 < "$1/dist/$2" | awk '{print $1}')" "$2" > "$1/dist/$2.sha256"
  pkg_sidecar_write "$1/dist/$2" "$4" "$1/dist/$2.inputs"
}
IN_OLD="$(printf 'old' | shasum -a 256 | awk '{print $1}')"; IN_NEW="$(printf 'new' | shasum -a 256 | awk '{print $1}')"
# A stand-in host: promote copies the staging pkg only when the HOST serves it (its .sha256 equals the local one).
WWW8="$T/www8167"; mkdir -p "$WWW8/dist"
( cd "$WWW8" && exec python3 -u -m http.server 0 -b 127.0.0.1 ) > "$T/srv8167.log" 2>&1 & SRV8=$!
P8=""; for i in $(seq 1 100); do P8="$(sed -n 's/.*port \([0-9][0-9]*\).*/\1/p' "$T/srv8167.log" | head -n1)"; [ -n "$P8" ] && break; sleep 0.1; done
[ -n "$P8" ] && pass "8167 promote: the stand-in host is up" || bad "8167 promote: the stand-in host did not start"
export KOSMOS_SITE_URL="http://127.0.0.1:$P8"
served8() { rm -f "$WWW8/dist/"*; [ -z "${1:-}" ] || cp "$1/dist/Kosmos-staging.pkg.sha256" "$WWW8/dist/"; }
Sk="$(promote_site yes)"; mkpkg "$Sk" Kosmos.pkg "PROD-PKG" "$IN_OLD"; mkpkg "$Sk" Kosmos-staging.pkg "STAGING-PKG" "$IN_NEW"; served8 "$Sk"
[ "$(cat "$Sk/dist/Kosmos.pkg")" = "PROD-PKG" ] && pass "8167 promote: CONTROL before the promote Kosmos.pkg is the prod pkg" || bad "8167 fixture: Kosmos.pkg is not the prod pkg"
out="$(bash "$HERE/promote-channel.sh" "$Sk" 2>&1)"; rc=$?
[ "$rc" = 0 ] && cmp -s "$Sk/dist/Kosmos-staging.pkg" "$Sk/dist/Kosmos.pkg" && cmp -s "$Sk/dist/Kosmos-staging.pkg.inputs" "$Sk/dist/Kosmos.pkg.inputs" \
  && pass "8167 promote: Kosmos.pkg and its sidecar are now the staging pkg's" || bad "8167 promote did not copy the staging pkg (rc=$rc, out=$out)"
[ "$(awk '{print $2}' "$Sk/dist/Kosmos.pkg.sha256")" = Kosmos.pkg ] && [ "$(awk '{print $1}' "$Sk/dist/Kosmos.pkg.sha256")" = "$(shasum -a 256 < "$Sk/dist/Kosmos.pkg" | awk '{print $1}')" ] \
  && pass "8167 promote: the promoted Kosmos.pkg.sha256 names Kosmos.pkg and its bytes" || bad "8167 promote: Kosmos.pkg.sha256 reads '$(cat "$Sk/dist/Kosmos.pkg.sha256")'"
has "$out" "copied the staging installer pkg onto Kosmos.pkg" && pass "8167 promote: says it copied the pkg" || bad "8167 promote did not say so (out=$out)"
# A staging pkg the host does NOT serve (a staging cut that aborted after 3c) is not copied: the pointer promotes, loudly.
Sv="$(promote_site yes)"; mkpkg "$Sv" Kosmos.pkg "PROD-PKG" "$IN_OLD"; mkpkg "$Sv" Kosmos-staging.pkg "UNSERVED-PKG" "$IN_NEW"; served8
out="$(bash "$HERE/promote-channel.sh" "$Sv" 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$Sv/dist/Kosmos.pkg")" = "PROD-PKG" ] && grep -q '"9.9.9"' "$Sv/dist/latest.json" && has "$out" "is not what http://127.0.0.1:$P8 serves" \
  && pass "8167 promote: an UNSERVED staging pkg is not copied, the pointer still promotes, and it says why" || bad "8167 promote unserved arm (rc=$rc, Kosmos.pkg: $(cat "$Sv/dist/Kosmos.pkg"), out=$out)"
# ...and one the host serves under OTHER bytes is not copied either.
Sw="$(promote_site yes)"; mkpkg "$Sw" Kosmos.pkg "PROD-PKG" "$IN_OLD"; mkpkg "$Sw" Kosmos-staging.pkg "LOCAL-PKG" "$IN_NEW"; served8 "$Sw"; printf '%064d  Kosmos-staging.pkg\n' 7 > "$WWW8/dist/Kosmos-staging.pkg.sha256"
out="$(bash "$HERE/promote-channel.sh" "$Sw" 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$Sw/dist/Kosmos.pkg")" = "PROD-PKG" ] && pass "8167 promote: a staging pkg the host serves under other bytes is not copied" || bad "8167 promote other-bytes arm (rc=$rc, out=$out)"
# No staging pkg (before the first staging cut after #8167): Kosmos.pkg is left alone and the promote goes on.
Sn="$(promote_site yes)"; mkpkg "$Sn" Kosmos.pkg "PROD-PKG" "$IN_OLD"
out="$(bash "$HERE/promote-channel.sh" "$Sn" 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$Sn/dist/Kosmos.pkg")" = "PROD-PKG" ] && grep -q '"9.9.9"' "$Sn/dist/latest.json" && pass "8167 promote: CONTROL with no staging pkg, Kosmos.pkg is left as it is and the pointer still promotes" || bad "8167 promote no-staging-pkg arm (rc=$rc, out=$out)"
# Already the same pkg: nothing to copy.
Ss="$(promote_site yes)"; mkpkg "$Ss" Kosmos.pkg "SAME-PKG" "$IN_NEW"; mkpkg "$Ss" Kosmos-staging.pkg "SAME-PKG" "$IN_NEW"
out="$(bash "$HERE/promote-channel.sh" "$Ss" 2>&1)"; rc=$?
[ "$rc" = 0 ] && has "$out" "already the staging pkg" && pass "8167 promote: an identical staging pkg is not copied again" || bad "8167 promote identical arm (rc=$rc, out=$out)"
# A broken staging triple refuses BEFORE any write: the pointer, /setup and Kosmos.pkg are all untouched.
Sb8="$(promote_site yes)"; mkpkg "$Sb8" Kosmos.pkg "PROD-PKG" "$IN_OLD"; mkpkg "$Sb8" Kosmos-staging.pkg "STAGING-PKG" "$IN_NEW"; printf 'TAMPERED' > "$Sb8/dist/Kosmos-staging.pkg"
out="$(bash "$HERE/promote-channel.sh" "$Sb8" 2>&1)"; rc=$?
[ "$rc" = 0 ] && grep -q '"9.9.9"' "$Sb8/dist/latest.json" && [ "$(cat "$Sb8/dist/Kosmos.pkg")" = "PROD-PKG" ] && has "$out" "WARNING dist/Kosmos-staging.pkg is not a whole, self-consistent triple" \
  && pass "8167 promote: a tampered staging pkg is not copied, Kosmos.pkg is untouched, and the pointer still promotes" || bad "8167 promote tampered arm (rc=$rc, latest.json: $(cat "$Sb8/dist/latest.json"), out=$out)"
Sb9="$(promote_site yes)"; mkpkg "$Sb9" Kosmos.pkg "PROD-PKG" "$IN_OLD"; mkpkg "$Sb9" Kosmos-staging.pkg "STAGING-PKG" "$IN_NEW"; rm -f "$Sb9/dist/Kosmos-staging.pkg.inputs"
out="$(bash "$HERE/promote-channel.sh" "$Sb9" 2>&1)"; rc=$?
[ "$rc" = 0 ] && grep -q '"9.9.9"' "$Sb9/dist/latest.json" && [ "$(cat "$Sb9/dist/Kosmos.pkg")" = "PROD-PKG" ] && has "$out" "is missing" && pass "8167 promote: a staging pkg missing its sidecar is not copied, and the pointer still promotes" || bad "8167 promote partial arm (rc=$rc, out=$out)"

kill "$SRV8" 2>/dev/null; wait "$SRV8" 2>/dev/null; unset KOSMOS_SITE_URL

echo ""
if [ "$fail" = 0 ]; then echo "test-setup-staging-5032: ALL PASS"; else echo "test-setup-staging-5032: FAILURES above"; exit 1; fi
