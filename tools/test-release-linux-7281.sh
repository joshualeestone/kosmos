#!/bin/bash
# test-release-linux-7281.sh -- kosmos#7281 slice C1. Unit-tests tools/lib/release-linux.sh (the Linux family in a
# cut) and the Linux arms of release_site_restore against a fake site. The release.sh call sites need a whole cut and
# are not driven here; this proves the LIB, each refusal with a control that passes.
# The signer is a stub: the lib is copied into a temp tools/lib beside the REAL sha256-name.sh and
# write-latest-pointer.js, so no seam is added to the shipped code for the test.
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/rel-linux-7281.XXXXXX")"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/tools/lib"
cp "$HERE/tools/lib/release-linux.sh" "$HERE/tools/lib/sha256-name.sh" "$HERE/tools/lib/write-latest-pointer.js" "$HERE/tools/lib/release-freeze.sh" "$T/tools/lib/"
# The stub signer: writes a signature unless STUB_SIGN_FAIL=1.
cat > "$T/tools/lib/manifest-sign.js" <<'EOF'
if (process.env.STUB_SIGN_FAIL === '1') { process.stderr.write('stub: refusing to sign\n'); process.exit(1); }
require('fs').writeFileSync(process.argv[5], 'stub-signature\n');
EOF
. "$T/tools/lib/release-linux.sh"
. "$T/tools/lib/release-freeze.sh"

PASS=0; FAIL=0
chk() { local desc="$1"; shift; if "$@"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "FAIL: $desc" >&2; fi; }
not() { ! "$@"; }
SHA64="$(printf 'b%.0s' $(seq 1 64))"
COMMIT="$(printf 'c%.0s' $(seq 1 40))"

# A site checkout with an origin, as release.sh's SITE is.
newsite() {
  local s="$T/site-$1" o="$T/origin-$1.git"
  git init -q --bare "$o"
  git init -q -b main "$s"; git -C "$s" config user.email t@t; git -C "$s" config user.name t
  mkdir -p "$s/dist"; printf 'x\n' > "$s/dist/.keep"
  git -C "$s" add dist/.keep; git -C "$s" commit -q -m init
  git -C "$s" remote add origin "$o"; git -C "$s" push -q origin main
  printf '%s\n' "$s"
}
# A Linux build as tools/build-kosmos-linux.sh leaves it in <dist>.
newbuild() {   # <dir> <version> [manifest overrides as a node expression on m]
  local d="$1" v="$2" over="${3:-}" stage
  mkdir -p "$d"; stage="$(mktemp -d "$T/stage.XXXXXX")"
  mkdir -p "$stage/app"; printf '{"version":"%s"}\n' "$v" > "$stage/app/package.json"
  tar -czf "$d/kosmos-linux-x64.tar.gz" -C "$stage" app
  ( cd "$d" && shasum -a 256 kosmos-linux-x64.tar.gz > kosmos-linux-x64.tar.gz.sha256 )
  M_OUT="$d/kosmos-linux-x64.manifest.json" M_V="$v" M_COMMIT="$COMMIT" M_SHA="$SHA64" M_OVER="$over" node -e '
    const e = process.env;
    const m = { manifest: 1, platform: "linux", version: e.M_V, arch: "x64", artifact: "kosmos-linux-x64.tar.gz",
      app: { commit: "a", dirty: false }, node: { version: "v24.19.0", download_sha256: e.M_SHA },
      connector: { commit: e.M_COMMIT, glibc: "2.34", glibc_floor: "2.35" }, files: [] };
    if (e.M_OVER) eval(e.M_OVER);
    require("fs").writeFileSync(e.M_OUT, JSON.stringify(m, null, 1) + "\n");'
}

# ---- release_linux_decide ----
S="$(newsite decide)"
chk "pointer names per channel" [ "$(release_linux_pointer_file staging)" = latest-linux-staging.json ]
chk "prod pointer name" [ "$(release_linux_pointer_file prod)" = latest-linux.json ]
out="$(unset KOSMOS_CUT_LINUX; release_linux_decide "$S" staging 2>&1; echo "rc=$? cut=$CUT_LINUX file=$LINUX_POINTER_FILE")"
chk "CONTROL: no Linux pointer and no opt-in skips the family" [ "${out##*rc=}" = "0 cut=no file=latest-linux-staging.json" ]
out="$(KOSMOS_CUT_LINUX=1 release_linux_decide "$S" staging 2>&1; echo "rc=$? cut=$CUT_LINUX file=$LINUX_POINTER_FILE")"
chk "KOSMOS_CUT_LINUX=1 cuts it on staging" [ "${out##*rc=}" = "0 cut=yes file=latest-linux-staging.json" ]
# Review 1 (W4): prod only once promote-channel.sh moves the Linux pointer too (slice C2).
out="$(CUT_LINUX=; KOSMOS_CUT_LINUX=1 release_linux_decide "$S" prod 2>&1; echo "rc=$?")"
chk "a prod Linux cut is refused until the promote keeps lockstep" [ "${out##*rc=}" = 1 ]
out="$(CUT_LINUX=; KOSMOS_CUT_LINUX=1 RELEASE_LINUX_PROMOTE_LOCKSTEP=1 release_linux_decide "$S" prod 2>&1; echo "rc=$?")"
chk "and no variable lifts that by hand (review 2 W1)" [ "${out##*rc=}" = 1 ]
printf '# moves latest-linux.json with latest.json\n' > "$T/tools/promote-channel.sh"
out="$(KOSMOS_CUT_LINUX=1 release_linux_decide "$S" prod 2>&1; echo "rc=$? cut=$CUT_LINUX file=$LINUX_POINTER_FILE")"
chk "CONTROL: once promote-channel.sh moves the Linux pointer, prod cuts it" [ "${out##*rc=}" = "0 cut=yes file=latest-linux.json" ]
rm -f "$T/tools/promote-channel.sh"
chk "the shipped promote-channel.sh does not move it yet, so prod stays refused today" not grep -qF latest-linux.json "$HERE/tools/promote-channel.sh"
printf '{}\n' > "$S/dist/latest-linux-staging.json"
out="$(unset KOSMOS_CUT_LINUX; release_linux_decide "$S" staging 2>&1; echo "rc=$?")"
chk "a channel with a Linux pointer on disk refuses a cut without it (lockstep)" [ "${out##*rc=}" = 1 ]
case "$out" in *lockstep*) PASS=$((PASS+1)) ;; *) FAIL=$((FAIL+1)); echo "FAIL: the refusal does not say why: $out" >&2 ;; esac
out="$(unset KOSMOS_CUT_LINUX; release_linux_decide "$S" prod 2>&1; echo "rc=$?")"
chk "CONTROL: the other channel's pointer does not bind this one" [ "${out##*rc=}" = 0 ]
rm -f "$S/dist/latest-linux-staging.json"
# Published on origin/main but absent here (a stale checkout): still refused.
S2="$(newsite decide2)"; C2="$T/clone-decide2"; git clone -q "$T/origin-decide2.git" "$C2"
git -C "$C2" config user.email t@t; git -C "$C2" config user.name t
printf '{}\n' > "$C2/dist/latest-linux.json"; git -C "$C2" add dist/latest-linux.json; git -C "$C2" commit -q -m p; git -C "$C2" push -q origin main
git -C "$S2" fetch -q origin
out="$(unset KOSMOS_CUT_LINUX; release_linux_decide "$S2" prod 2>&1; echo "rc=$?")"
chk "a Linux pointer on origin/main only is refused too" [ "${out##*rc=}" = 1 ]

# ---- release_linux_check_manifest ----
B="$T/build-ok"; newbuild "$B" 1.2.3
chk "CONTROL: a release build passes" release_linux_check_manifest "$B/kosmos-linux-x64.manifest.json" "$COMMIT" 1.2.3
chk "refused: a manifest for another version (review 1 W6)" not release_linux_check_manifest "$B/kosmos-linux-x64.manifest.json" "$COMMIT" 1.2.4
for case_ in 'm.node.download_sha256 = "unchecked:abc"' 'm.app.dirty = true' 'm.connector.glibc_floor = "2.36"' 'm.platform = "darwin"' 'delete m.platform'; do
  Bx="$(mktemp -d "$T/build-bad.XXXXXX")"; newbuild "$Bx" 1.2.3 "$case_"
  chk "refused: $case_" not release_linux_check_manifest "$Bx/kosmos-linux-x64.manifest.json" "$COMMIT" 1.2.3
done
chk "refused: a connector other than the checked one" not release_linux_check_manifest "$B/kosmos-linux-x64.manifest.json" "$(printf 'd%.0s' $(seq 1 40))" 1.2.3

# ---- release_linux_publish ----
S="$(newsite publish)"; B="$T/build-pub"; newbuild "$B" 1.2.3
CUT_LINUX=yes; LINUX_POINTER_FILE=latest-linux-staging.json
SETUP_SHA="$(printf 'e%.0s' $(seq 1 64))"
chk "publish succeeds" release_linux_publish "$B" "$S" 1.2.3 "$SETUP_SHA" /dev/null
for f in kosmos-1.2.3-linux-x64.tar.gz kosmos-1.2.3-linux-x64.tar.gz.sha256 kosmos-1.2.3-linux-x64.manifest.json kosmos-1.2.3-linux-x64.manifest.json.sig latest-linux-staging.json; do
  chk "published: $f" [ -f "$S/dist/$f" ]
done
chk "the versioned .sha256 names the versioned file and verifies" sh -c "cd '$S/dist' && shasum -a 256 -c --status kosmos-1.2.3-linux-x64.tar.gz.sha256"
ptr="$(node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write([p.version,p.versioned,p.manifest,p.setup_sha256,p.sha256].join(" "))' "$S/dist/latest-linux-staging.json")"
want_sha="$(awk '{print $1}' "$B/kosmos-linux-x64.tar.gz.sha256")"
chk "the pointer has the shape engine/update.js reads (version, versioned, sha256, setup)" \
  [ "$ptr" = "1.2.3 kosmos-1.2.3-linux-x64.tar.gz kosmos-1.2.3-linux-x64.manifest.json $SETUP_SHA $want_sha" ]
chk "CONTROL: the prod pointer was not written by a staging cut" [ ! -f "$S/dist/latest-linux.json" ]
# Immutability: the same version with other bytes is refused, and the pointer is left as it was.
B2="$T/build-pub2"; newbuild "$B2" 1.2.3; printf 'extra\n' >> "$B2/kosmos-linux-x64.tar.gz"
( cd "$B2" && shasum -a 256 kosmos-linux-x64.tar.gz > kosmos-linux-x64.tar.gz.sha256 )
before="$(cat "$S/dist/latest-linux-staging.json")"
chk "republishing 1.2.3 with other bytes is refused" not release_linux_publish "$B2" "$S" 1.2.3 "$SETUP_SHA" /dev/null 2>/dev/null
chk "and the pointer is unchanged" [ "$(cat "$S/dist/latest-linux-staging.json")" = "$before" ]
chk "CONTROL: republishing the SAME bytes is allowed" release_linux_publish "$B" "$S" 1.2.3 "$SETUP_SHA" /dev/null >/dev/null
# Review 1 (nit): the same tarball with a different manifest is refused too.
B3="$T/build-pub3"; mkdir -p "$B3"; cp "$B"/kosmos-linux-x64.tar.gz "$B"/kosmos-linux-x64.tar.gz.sha256 "$B3/"
node -e 'const f=process.argv[1];const m=JSON.parse(require("fs").readFileSync(f,"utf8"));m.built={at:"later"};require("fs").writeFileSync(process.argv[2],JSON.stringify(m))' "$B/kosmos-linux-x64.manifest.json" "$B3/kosmos-linux-x64.manifest.json"
chk "republishing 1.2.3 with another manifest is refused" not release_linux_publish "$B3" "$S" 1.2.3 "$SETUP_SHA" /dev/null 2>/dev/null
# A signer that refuses publishes no pointer.
S="$(newsite signfail)"; B="$T/build-sf"; newbuild "$B" 1.2.4; newsite signctl >/dev/null
chk "CONTROL: the same call without the refusal publishes" env STUB_SIGN_FAIL=0 bash -c ". '$T/tools/lib/release-linux.sh'; LINUX_POINTER_FILE=latest-linux.json; release_linux_publish '$B' '$T/site-signctl' 1.2.4 '$SETUP_SHA' /dev/null" >/dev/null 2>&1
chk "a signer refusal stops the publish" not env STUB_SIGN_FAIL=1 bash -c ". '$T/tools/lib/release-linux.sh'; LINUX_POINTER_FILE=latest-linux.json; release_linux_publish '$B' '$S' 1.2.4 '$SETUP_SHA' /dev/null" 2>/dev/null
chk "and no pointer was written" [ ! -f "$S/dist/latest-linux.json" ]
chk "and no tarball was published" [ ! -f "$S/dist/kosmos-1.2.4-linux-x64.tar.gz" ]

# ---- release_linux_site_paths ----
LINUX_POINTER_FILE=latest-linux.json
chk "the site commit takes the pointer, manifest and signature" \
  [ "$(release_linux_site_paths 1.2.3)" = "dist/latest-linux.json dist/kosmos-1.2.3-linux-x64.manifest.json dist/kosmos-1.2.3-linux-x64.manifest.json.sig" ]

# ---- release_site_restore's Linux arms ----
S="$(newsite restore)"; B="$T/build-rs"; newbuild "$B" 1.2.5
LINUX_POINTER_FILE=latest-linux-staging.json; release_linux_publish "$B" "$S" 1.2.5 "$SETUP_SHA" /dev/null >/dev/null
release_site_restore "$S" 1.2.5 0 1 "" 1 0 >/dev/null
chk "an aborted first Linux cut leaves no untracked Linux pointer" [ ! -f "$S/dist/latest-linux-staging.json" ]
chk "nor its versioned tarball" [ ! -f "$S/dist/kosmos-1.2.5-linux-x64.tar.gz" ]
chk "nor its manifest" [ ! -f "$S/dist/kosmos-1.2.5-linux-x64.manifest.json" ]
# A tracked Linux pointer the aborted cut changed is put back.
printf '{"version":"1.2.4"}\n' > "$S/dist/latest-linux.json"; git -C "$S" add dist/latest-linux.json; git -C "$S" commit -q -m served
printf '{"version":"1.2.6"}\n' > "$S/dist/latest-linux.json"
release_site_restore "$S" 1.2.6 1 1 "" 1 >/dev/null
chk "a tracked Linux pointer is put back to what is served" [ "$(cat "$S/dist/latest-linux.json")" = '{"version":"1.2.4"}' ]
# Review 1 (W3): a served Linux tarball (the Linux pair existed before the cut) is kept even when the Mac pair did not.
printf 't\n' > "$S/dist/kosmos-1.2.6-linux-x64.tar.gz"
release_site_restore "$S" 1.2.6 0 1 "" 1 1 >/dev/null
chk "a Linux tarball that was there before the cut survives an abort (linux_had=1)" [ -f "$S/dist/kosmos-1.2.6-linux-x64.tar.gz" ]
release_site_restore "$S" 1.2.6 0 1 "" 1 >/dev/null
chk "and a caller that does not pass linux_had never removes it" [ -f "$S/dist/kosmos-1.2.6-linux-x64.tar.gz" ]
release_site_restore "$S" 1.2.6 0 1 "" 1 0 >/dev/null
chk "CONTROL: one this cut created (linux_had=0) is removed" [ ! -f "$S/dist/kosmos-1.2.6-linux-x64.tar.gz" ]
# CONTROL: a served (tracked) versioned manifest is never removed.
printf 'm\n' > "$S/dist/kosmos-1.2.4-linux-x64.manifest.json"; git -C "$S" add dist/kosmos-1.2.4-linux-x64.manifest.json; git -C "$S" commit -q -m m
release_site_restore "$S" 1.2.4 0 1 "" 1 0 >/dev/null
chk "CONTROL: a tracked versioned Linux manifest is kept" [ -f "$S/dist/kosmos-1.2.4-linux-x64.manifest.json" ]

# ---- release.sh wires the lib (review 1 W5): each call is present and refuses on failure ----
# A structural check, because a whole cut cannot run here: removing or un-gating any call reds one line below.
RS="$HERE/tools/release.sh"
wired() { grep -qF -- "$1" "$RS"; }
chk "release.sh sources the lib" wired '. "$REPO/tools/lib/release-linux.sh"'
chk "1d-linux decides, and exits on refusal" wired 'release_linux_decide "$SITE" "$CUT_CHANNEL" || exit 1'
chk "1d-linux checks the Linux connector against relay main" wired 'tools/build-tunnel-release-linux.sh || exit 1'
chk "step 4 builds the Linux bundle" wired 'bash tools/build-kosmos-linux.sh dist ) || {'
chk "step 4 checks the manifest against the connector and V" wired 'release_linux_check_manifest "$REPO/dist/kosmos-linux-x64.manifest.json" "$LINUX_CONNECTOR_COMMIT" "$V" || exit 1'
chk "the publish exits on failure" wired 'release_linux_publish "$REPO/dist" "$SITE" "$V" "$KM_SETUP_SHA" "$KOSMOS_MANIFEST_KEY" || exit 1'
chk "the site commit takes the Linux paths" wired '_site_paths="$_site_paths $(release_linux_site_paths "$V")"'
chk "step 6 refuses a Linux bundle that is not V" wired 'THE LINUX BUNDLE IS NOT $V"; exit 1'
chk "step 8 refuses an export without the Linux pair" wired 'shasum -a 256 --status -c "kosmos-$V-linux-x64.tar.gz.sha256"'
chk "step 8 refuses a committed Linux pointer that names other bytes" wired 'does not name the Linux tarball the export carries'
chk "the abort trap passes the Linux pair record" wired '"$_staging_ptr_had" "$_linux_pair_had";'
# The post-commit cleanup's line is identical to the /setup-staging one above it, so it is checked as the line after
# its own loop head, not by text alone.
linux_cleanup() { grep -A1 -F 'for _p in $(release_linux_site_paths "$V"); do' "$RS" | grep -qF 'ls-files --error-unmatch "$_p" >/dev/null 2>&1 || rm -f "$SITE/$_p"'; }
chk "after the site commit, the untracked Linux paths are removed so the next pull is not refused" linux_cleanup

# ---- publish-staging-pointer.sh refuses to move the Mac staging pointer alone (review 2 W2) ----
S="$(newsite psp)"; printf '{}\n' > "$S/dist/latest-linux-staging.json"
out="$(bash "$HERE/tools/publish-staging-pointer.sh" "$S" 9.9.9 2>&1; echo "rc=$?")"
chk "publish-staging-pointer refuses while a Linux staging pointer exists" [ "${out##*rc=}" = 1 ]
case "$out" in *lockstep*) PASS=$((PASS+1)) ;; *) FAIL=$((FAIL+1)); echo "FAIL: publish-staging-pointer refused for another reason: $out" >&2 ;; esac
rm -f "$S/dist/latest-linux-staging.json"
out="$(bash "$HERE/tools/publish-staging-pointer.sh" "$S" 9.9.9 2>&1; echo "rc=$?")"
case "$out" in *lockstep*) FAIL=$((FAIL+1)); echo "FAIL: CONTROL: it refused on lockstep with no Linux pointer" >&2 ;; *) PASS=$((PASS+1)) ;; esac

echo "test-release-linux-7281: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
