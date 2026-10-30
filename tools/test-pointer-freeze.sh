#!/usr/bin/env bash
# kosmos#6620: tools/pointer-freeze.sh (the incident "stop the pointer" pin) and the writers that honour its marker.
# A fake site git repo holds a known-good build (GOOD) and a later bad one (BAD); a fake curl serves the host's dist/
# from a folder. Every refusal is checked to have changed nothing, and every writer's refusal has a control (the same
# run with no marker does not say FROZEN), so a refusal for another reason cannot pass as this one.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/test-pointer-freeze.XXXXXX")"
trap 'rm -rf "$T"' EXIT
fail=0
pass() { printf 'PASS  %s\n' "$*"; }
bad() { printf 'FAIL  %s\n' "$*"; fail=1; }
has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }

GOOD=0.7.50; BAD=0.7.51; LOW=0.7.40
HOSTDIR="$T/host"; mkdir -p "$HOSTDIR/dist"
# The fake curl: serves http://fake.test/<path> from $HOSTDIR/<path>; -o FILE writes there, else stdout; 22 when absent.
cat > "$T/curl" <<'EOF'
#!/bin/sh
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -H) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
f="$FAKE_HOSTDIR/${url#http://fake.test/}"
[ -f "$f" ] || exit 22
if [ -n "$out" ]; then cp "$f" "$out"; else cat "$f"; fi
EOF
chmod +x "$T/curl"
export FAKE_HOSTDIR="$HOSTDIR"

ptr() { printf '{"version":"%s","sha256":"%s","artifact":"kosmos-%s-arm64.tar.gz","manifest":"kosmos-%s-arm64.manifest.json"}\n' "$1" "$2" "$1" "$1"; }
sha_of() { shasum -a 256 "$1" | awk '{print $1}'; }

# A site whose history holds LOW, then GOOD (with its installer), then BAD (with a different installer); the host
# serves GOOD's and BAD's artifacts.
make_site() {
  local s v
  s="$(mktemp -d "$T/site.XXXXXX")"; mkdir -p "$s/dist"
  git init -q --initial-branch=main "$s"; git -C "$s" config user.email t@t; git -C "$s" config user.name t
  for v in $LOW $GOOD $BAD; do
    printf 'ARTIFACT-%s\n' "$v" > "$HOSTDIR/dist/kosmos-$v-arm64.tar.gz"
    printf '{"manifest":1,"version":"%s"}\n' "$v" > "$HOSTDIR/dist/kosmos-$v-arm64.manifest.json"; printf 'SIG\n' > "$HOSTDIR/dist/kosmos-$v-arm64.manifest.json.sig"
    cp "$HOSTDIR/dist/kosmos-$v-arm64.manifest.json" "$HOSTDIR/dist/kosmos-$v-arm64.manifest.json.sig" "$s/dist/"   # tracked, as on the real site
    ptr "$v" "$(sha_of "$HOSTDIR/dist/kosmos-$v-arm64.tar.gz")" > "$s/dist/latest.json"
    cp "$s/dist/latest.json" "$s/dist/latest-staging.json"
    printf 'installer for %s KOSMOS_READONLY_APP\n' "$v" > "$s/setup"
    ( cd "$s" && shasum -a 256 setup > setup.sha256 ); cp "$s/setup" "$s/setup-staging"; cp "$s/setup.sha256" "$s/setup-staging.sha256"
    git -C "$s" add -A && git -C "$s" commit -q -m "release $v"
  done
  # Its origin: a bare repo, as the real site's GitHub remote. The freeze is pushed there.
  git init -q --bare --initial-branch=main "$s.origin.git" && git -C "$s" remote add origin "$s.origin.git" && git -C "$s" push -q origin main
  git -C "$s" fetch -q origin && git -C "$s" branch -q --set-upstream-to=origin/main main
  printf '%s' "$s"
}
on_origin() { git -C "$1" fetch -q origin && git -C "$1" cat-file -e "origin/main:dist/POINTER_FROZEN" 2>/dev/null; }
# Never the real site: an empty path (a failed mktemp) would let KOSMOS_SITE fall back to $HOME's checkout, so refuse
# it, and run with HOME sandboxed as well.
pf() { [ -n "$1" ] && [ -d "$1" ] || { echo "pf: no fake site given; refusing"; return 1; }
  HOME="$T/home" KOSMOS_SITE="$1" KOSMOS_SITE_URL=http://fake.test POINTER_FREEZE_CURL_CMD="$T/curl" bash "$HERE/pointer-freeze.sh" "${@:2}" 2>&1; }
ver() { sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$1"; }
unchanged() { [ -z "$(git -C "$1" status --porcelain)" ] && [ "$(git -C "$1" rev-parse HEAD)" = "$2" ]; }

# ---- on: pins both Mac pointers and the installer pair to GOOD, writes the marker, commits ----------------------
S="$(make_site)"
out="$(pf "$S" on --mac $GOOD --because "release $BAD is suspect")"; rc=$?
{ [ $rc = 0 ] && [ "$(ver "$S/dist/latest.json")" = $GOOD ] && [ "$(ver "$S/dist/latest-staging.json")" = $GOOD ]; } \
  && pass "on: both Mac pointers name $GOOD" || bad "on: pointers (rc=$rc) out=$out"
{ grep -q "installer for $GOOD" "$S/setup" && grep -q "installer for $GOOD" "$S/setup-staging" && cmp -s "$S/setup.sha256" "$S/setup-staging.sha256"; } \
  && pass "on: the installer pair that stood with $GOOD is restored, prod and staging" || bad "on: installer pair: $(cat "$S/setup")"
{ [ "$(sed -n 's/^mac=//p' "$S/dist/POINTER_FROZEN")" = $GOOD ] && grep -q "^because=release $BAD is suspect$" "$S/dist/POINTER_FROZEN" && grep -Eq '^at=20[0-9-]+T' "$S/dist/POINTER_FROZEN"; } \
  && pass "on: the marker records the version, the reason and the time" || bad "on: marker: $(cat "$S/dist/POINTER_FROZEN" 2>&1)"
{ [ -z "$(git -C "$S" status --porcelain)" ] && git -C "$S" ls-files --error-unmatch dist/POINTER_FROZEN >/dev/null 2>&1; } \
  && pass "on: everything is committed, the marker tracked" || bad "on: not committed: $(git -C "$S" status --porcelain)"
{ on_origin "$S" && [ "$(git -C "$S" rev-parse HEAD)" = "$(git -C "$S" rev-parse origin/main)" ]; } \
  && pass "on: the freeze is PUSHED to origin/main, and the checkout followed it" || bad "on: not on origin/main"
[ -z "$(git -C "$S" diff --cached --name-only)" ] && pass "on: nothing is left staged in the shared index" || bad "on: staged: $(git -C "$S" diff --cached --name-only)"
has "$out" "tools/deploy-site.sh --promote" && has "$out" "NOT deployed" && pass "on: says it did not deploy, and the command that does" || bad "on: next step: $out"

# ---- on again, off, status ----------------------------------------------------------------------------------------
H1="$(git -C "$S" rev-parse HEAD)"
out="$(pf "$S" on --mac $GOOD --because again)"; rc=$?
{ [ $rc = 0 ] && has "$out" "already frozen at $GOOD" && unchanged "$S" "$H1"; } && pass "on at the same version: nothing changes" || bad "on same (rc=$rc) out=$out"
out="$(pf "$S" on --mac $LOW --because other)"; rc=$?
{ [ $rc = 1 ] && has "$out" "run off first" && unchanged "$S" "$H1"; } && pass "on at another version while frozen: refused, nothing changes" || bad "on other (rc=$rc) out=$out"
has "$(pf "$S" status)" "FROZEN at $GOOD" && pass "status: says frozen and at what" || bad "status frozen: $(pf "$S" status)"
out="$(pf "$S" off)"; rc=$?
{ [ $rc = 0 ] && [ ! -e "$S/dist/POINTER_FROZEN" ] && [ -z "$(git -C "$S" status --porcelain)" ] && [ "$(ver "$S/dist/latest.json")" = $GOOD ] && ! on_origin "$S"; } \
  && pass "off: the marker is removed on origin/main and here; the pointers stay" || bad "off (rc=$rc) out=$out"
has "$(pf "$S" off)" "not frozen" && pass "off when not frozen: says so" || bad "off twice"

# ---- a stale checkout: another machine pushed since; the freeze goes on the fresh tip and keeps that commit --------
S="$(make_site)"; O="$T/other"; git clone -q "$S.origin.git" "$O"; git -C "$O" config user.email t@t; git -C "$O" config user.name t
printf '<p>a page edit pushed from another machine</p>\n' > "$O/page.html"; git -C "$O" add page.html && git -C "$O" commit -q -m "page edit" && git -C "$O" push -q origin main
out="$(pf "$S" on --mac $GOOD --because "stale checkout arm")"; rc=$?
{ [ $rc = 0 ] && on_origin "$S" && git -C "$S" cat-file -e origin/main:page.html; } \
  && pass "on from a stale checkout: built on the fresh origin/main, the other machine's commit kept" || bad "stale (rc=$rc) out=$out"
git -C "$O" pull -q --ff-only; [ -e "$O/dist/POINTER_FROZEN" ] && pass "the other machine sees the freeze after a pull" || bad "other machine: no marker"
out="$(pf "$O" status)"; has "$out" "FROZEN at $GOOD" && pass "status reads origin/main" || bad "status: $out"
# A push that cannot happen: nothing is frozen and the checkout is as it was, so on can simply run again.
S="$(make_site)"; H0="$(git -C "$S" rev-parse HEAD)"; git -C "$S" remote set-url origin "$T/no-such-origin.git"
out="$(pf "$S" on --mac $GOOD --because x)"; rc=$?
{ [ $rc = 1 ] && unchanged "$S" "$H0" && [ ! -e "$S/dist/POINTER_FROZEN" ]; } && pass "no reachable origin: refused, the checkout untouched" || bad "no origin (rc=$rc) out=$out st=$(git -C "$S" status --porcelain)"

# ---- a writer on a checkout that has not pulled a freeze pushed elsewhere still refuses (it asks origin first) -------
S="$(make_site)"; O2="$T/stale"; git clone -q "$S.origin.git" "$O2"
pf "$S" on --mac $GOOD --because "pushed elsewhere" >/dev/null
[ ! -e "$O2/dist/POINTER_FROZEN" ] || bad "PRECONDITION: the stale clone already has the marker"
sbefore="$(cat "$O2/dist/latest-staging.json")"
out="$(HOME="$T/home" bash "$HERE/publish-staging-pointer.sh" "$O2" 9.9.9 2>&1)"; rc=$?
{ [ $rc != 0 ] && has "$out" "FROZEN at $GOOD" && [ "$(cat "$O2/dist/latest-staging.json")" = "$sbefore" ]; } \
  && pass "a stale checkout's writer refuses a freeze it has not pulled, changing nothing" || bad "stale writer (rc=$rc) out=$out"
# ---- a writer whose site origin cannot be fetched refuses (fails closed); KOSMOS_POINTER_FREEZE_OFFLINE=1 decides here
S="$(make_site)"; git -C "$S" remote set-url origin "$T/gone.git"; sb2="$(cat "$S/dist/latest-staging.json")"
out="$(HOME="$T/home" bash "$HERE/publish-staging-pointer.sh" "$S" 9.9.9 2>&1)"; rc=$?
{ [ $rc != 0 ] && has "$out" "could not fetch the site origin to check the pointer freeze" && [ "$(cat "$S/dist/latest-staging.json")" = "$sb2" ]; } \
  && pass "a writer that cannot reach the site origin refuses, changing nothing" || bad "fail closed (rc=$rc) out=$out"
# The decision itself, from the lib every writer sources: the return code is the freeze answer and nothing else.
( . "$HERE/lib/pointer-freeze.sh"; pointer_freeze_refuse "$S" a-writer 2>/dev/null ); lrc=$?
[ "$lrc" = 1 ] && pass "the lib refuses (rc 1) when the site origin cannot be fetched" || bad "the lib passed a site whose origin it could not fetch (rc=$lrc)"
( . "$HERE/lib/pointer-freeze.sh"; KOSMOS_POINTER_FREEZE_OFFLINE=1 pointer_freeze_refuse "$S" a-writer 2>/dev/null ); lrc=$?
[ "$lrc" = 0 ] && pass "CONTROL: the lib with KOSMOS_POINTER_FREEZE_OFFLINE=1 decides on the (unfrozen) checkout: rc 0" || bad "offline lib (rc=$lrc)"
out="$(HOME="$T/home" KOSMOS_POINTER_FREEZE_OFFLINE=1 bash "$HERE/publish-staging-pointer.sh" "$S" 9.9.9 2>&1)"
{ has "$out" "KOSMOS_POINTER_FREEZE_OFFLINE=1, so deciding on this checkout" && ! has "$out" "FROZEN"; } \
  && pass "CONTROL: with KOSMOS_POINTER_FREEZE_OFFLINE=1 it decides on the checkout (not frozen here)" || bad "offline (out=$out)"

# ---- on from a checkout that is not on main: pushed, and this checkout left exactly as it was -------------------
S="$(make_site)"; git -C "$S" checkout -q -b some-branch
out="$(pf "$S" on --mac $GOOD --because "not on main")"; rc=$?
{ [ $rc = 0 ] && on_origin "$S" && [ -z "$(git -C "$S" status --porcelain)" ] && [ ! -e "$S/dist/POINTER_FROZEN" ] && has "$out" "not on main"; } \
  && pass "on from a checkout not on main: pushed, and the checkout is untouched" || bad "not on main (rc=$rc) out=$out st=$(git -C "$S" status --porcelain)"

# ---- on again at the same version verifies the pin still holds on origin/main ------------------------------------
S="$(make_site)"; pf "$S" on --mac $GOOD --because "first" >/dev/null
O3="$T/hand"; git clone -q "$S.origin.git" "$O3"; git -C "$O3" config user.email t@t; git -C "$O3" config user.name t
ptr "$BAD" x > "$O3/dist/latest.json"; git -C "$O3" commit -q -am "a pointer pushed by hand on top of the freeze" && git -C "$O3" push -q origin main
out="$(pf "$S" on --mac $GOOD --because "again")"; rc=$?
{ [ $rc = 1 ] && has "$out" "no longer names that build"; } && pass "on again at the frozen version, with a pointer moved on top: refused, not reported fine" || bad "rerun verify (rc=$rc) out=$out"
S="$(make_site)"; pf "$S" on --mac $GOOD --because "first" >/dev/null
out="$(pf "$S" on --mac $GOOD --because "again")"; rc=$?
{ [ $rc = 0 ] && has "$out" "still name that build"; } && pass "CONTROL: on again with the pin intact: nothing to do, and says the pointers still hold" || bad "rerun intact (rc=$rc) out=$out"

# ---- --sha256 given out of band must match the pointer the history holds ------------------------------------------
S="$(make_site)"; H0="$(git -C "$S" rev-parse HEAD)"
out="$(pf "$S" on --mac $GOOD --because x --sha256 0000000000000000000000000000000000000000000000000000000000000000)"; rc=$?
{ [ $rc = 1 ] && has "$out" "not the --sha256 given" && unchanged "$S" "$H0" && ! on_origin "$S"; } && pass "--sha256 that the pointer does not match: refused, nothing frozen" || bad "sha256 mismatch (rc=$rc) out=$out"
out="$(pf "$S" on --mac $GOOD --because x --sha256 "$(sha_of "$HOSTDIR/dist/kosmos-$GOOD-arm64.tar.gz")")"; rc=$?
{ [ $rc = 0 ] && on_origin "$S"; } && pass "CONTROL: --sha256 that matches: frozen" || bad "sha256 match (rc=$rc) out=$out"
# release.sh's re-check just before its own vercel deploy cannot be reached without a real cut: pinned structurally
# instead (present, asks origin/main, refuses on a marker, and sits before `vercel deploy --prod`). Weaker than a run.
RS="$HERE/release.sh"; rl_check=$(grep -n 'origin/main:dist/POINTER_FROZEN' "$RS" | tail -1 | cut -d: -f1); rl_vercel=$(grep -n 'vercel deploy --prod --yes' "$RS" | tail -1 | cut -d: -f1)
{ [ -n "$rl_check" ] && [ -n "$rl_vercel" ] && [ "$rl_check" -lt "$rl_vercel" ] && sed -n "${rl_check},${rl_vercel}p" "$RS" | grep -q 'exit 1'; } \
  && pass "release.sh: the late freeze re-check is there, refuses, and comes before vercel deploy (structural)" || bad "release.sh late re-check missing or after vercel (check=$rl_check vercel=$rl_vercel)"

# ---- refusals before anything is written ------------------------------------------------------------------------
S="$(make_site)"; H0="$(git -C "$S" rev-parse HEAD)"
out="$(pf "$S" on --mac 0.7.99 --because x)"; rc=$?
{ [ $rc = 1 ] && has "$out" "no commit" && unchanged "$S" "$H0"; } && pass "refused: a version no commit names" || bad "unknown version (rc=$rc) out=$out"
out="$(pf "$S" on --mac $LOW --because x)"; rc=$?
{ [ $rc = 1 ] && has "$out" "setup floor" && unchanged "$S" "$H0"; } && pass "refused: below the setup floor" || bad "below floor (rc=$rc) out=$out"
out="$(pf "$S" on --mac $GOOD)"; rc=$?
{ [ $rc = 1 ] && has "$out" "--because is required" && unchanged "$S" "$H0"; } && pass "refused: no reason given" || bad "no because (rc=$rc) out=$out"
mv "$HOSTDIR/dist/kosmos-$GOOD-arm64.tar.gz" "$T/held-aside"
out="$(pf "$S" on --mac $GOOD --because x)"; rc=$?
mv "$T/held-aside" "$HOSTDIR/dist/kosmos-$GOOD-arm64.tar.gz"
{ [ $rc = 1 ] && has "$out" "does not serve" && unchanged "$S" "$H0"; } && pass "refused: the host no longer serves the artifact" || bad "not served (rc=$rc) out=$out"
printf 'TAMPERED\n' > "$T/good"; cp "$HOSTDIR/dist/kosmos-$GOOD-arm64.tar.gz" "$T/good.orig"; cp "$T/good" "$HOSTDIR/dist/kosmos-$GOOD-arm64.tar.gz"
out="$(pf "$S" on --mac $GOOD --because x)"; rc=$?
cp "$T/good.orig" "$HOSTDIR/dist/kosmos-$GOOD-arm64.tar.gz"
{ [ $rc = 1 ] && has "$out" "not the pointer's" && unchanged "$S" "$H0"; } && pass "refused: the served artifact's sha256 is not the pointer's" || bad "sha mismatch (rc=$rc) out=$out"
# An installer that does not match its own setup.sha256 (a setup from another release committed with the pointer).
S2="$(make_site)"; G2=$(git -C "$S2" log --format=%H -- dist/latest.json | sed -n 2p)
git -C "$S2" checkout -q "$G2" -- setup && printf 'tampered installer\n' > "$S2/setup" && git -C "$S2" commit -q -m "x" -- setup
ptr "$GOOD" "$(sha_of "$HOSTDIR/dist/kosmos-$GOOD-arm64.tar.gz")" > "$S2/dist/latest.json"; git -C "$S2" commit -q -m "re-point at good, setup mismatched" -- dist/latest.json; git -C "$S2" push -q origin main
out="$(pf "$S2" on --mac $GOOD --because x)"; rc=$?
{ [ $rc = 1 ] && has "$out" "does not match its own setup.sha256"; } && pass "refused: the installer does not match its own setup.sha256" || bad "setup pair mismatch (rc=$rc) out=$out"
mv "$HOSTDIR/dist/kosmos-$GOOD-arm64.manifest.json.sig" "$T/sig-aside"
out="$(pf "$S" on --mac $GOOD --because x)"; rc=$?
mv "$T/sig-aside" "$HOSTDIR/dist/kosmos-$GOOD-arm64.manifest.json.sig"
{ [ $rc = 1 ] && has "$out" "manifest.json.sig" && unchanged "$S" "$H0"; } && pass "refused: the pinned version's manifest signature is not served" || bad "no sig (rc=$rc) out=$out"
# A cut that died (or still runs) here leaves its pointer files dirty: on still freezes, and leaves those files alone.
printf 'a cut left this\n' >> "$S/dist/latest-staging.json"; DIRTY="$(cat "$S/dist/latest-staging.json")"
out="$(pf "$S" on --mac $GOOD --because "while a cut is dirty here")"; rc=$?
{ [ $rc = 0 ] && on_origin "$S" && [ "$(cat "$S/dist/latest-staging.json")" = "$DIRTY" ]; } \
  && pass "on with a cut's dirty pointer file in the checkout: frozen on origin/main, the dirty file left as it was" || bad "dirty (rc=$rc) out=$out"
has "$out" "could not fast-forward" && pass "  and it says the checkout could not follow, and how to" || bad "dirty: no fast-forward note: $out"
# A trailing option with no value is refused, never a hang (bash 3.2's shift 2 on one argument shifts nothing).
S="$(make_site)"
out="$(KOSMOS_SITE="$S" KOSMOS_SITE_URL=http://fake.test POINTER_FREEZE_CURL_CMD="$T/curl" perl -e 'alarm 20; exec @ARGV' bash "$HERE/pointer-freeze.sh" on --because x --mac 2>&1)"; rc=$?
{ [ $rc = 1 ] && has "$out" "--mac needs a value"; } && pass "a trailing --mac with no value is refused at once" || bad "trailing option (rc=$rc) out=$out"
# The marker records the pinned pointer's sha256 (deploy-site compares it), and the deploy line fits what is live.
S="$(make_site)"; ptr "$GOOD" "$(sha_of "$HOSTDIR/dist/kosmos-$GOOD-arm64.tar.gz")" > "$HOSTDIR/dist/latest.json"
out="$(pf "$S" on --mac $GOOD --because "staging only")"; rc=$?
[ "$(git -C "$S" show origin/main:dist/POINTER_FROZEN | sed -n 's/^sha256=//p')" = "$(sha_of "$HOSTDIR/dist/kosmos-$GOOD-arm64.tar.gz")" ] \
  && pass "the marker records the pinned pointer's sha256" || bad "marker sha: $(git -C "$S" show origin/main:dist/POINTER_FROZEN)"
{ has "$out" "Prod already serves exactly this pointer" && has "$out" "deploy-site.sh --publish"; } && pass "prod already serving exactly the pinned pointer: the printed deploy is --publish" || bad "publish hint: $out"
# A re-cut under the same version (live names $GOOD with other bytes): --promote, because --publish would refuse.
ptr "$GOOD" "1111111111111111111111111111111111111111111111111111111111111111" > "$HOSTDIR/dist/latest.json"
out="$(pf "$(make_site)" on --mac $GOOD --because "re-cut live")"
{ has "$out" "deploy-site.sh --promote" && ! has "$out" "already serves exactly"; } && pass "live is a re-cut under the pinned version: the printed deploy is --promote" || bad "re-cut hint: $out"
ptr "$BAD" x > "$HOSTDIR/dist/latest.json"
out="$(pf "$(make_site)" on --mac $GOOD --because "prod bad")"
has "$out" "deploy-site.sh --promote" && pass "CONTROL: prod on another version: the printed deploy is --promote" || bad "promote hint: $out"
rm -f "$HOSTDIR/dist/latest.json"

# ---- every pointer writer refuses while frozen; CONTROL: without the marker it does not say FROZEN ---------------
S="$(make_site)"
pf "$S" on --mac $GOOD --because "writer arms" >/dev/null
SB="$T/home"; mkdir -p "$SB" "$T/tmp"
# release.sh runs from a copy in a folder that is NOT a git repo, with only its libs and package.json: if the freeze
# check ever stopped refusing (or for the no-marker control), the cut dies at step 1 there and can never start for
# real, whichever checkout this test runs from.
RSANDBOX="$T/release-sandbox"; mkdir -p "$RSANDBOX/tools/lib"
cp "$HERE/release.sh" "$RSANDBOX/tools/"; cp "$HERE"/lib/*.sh "$RSANDBOX/tools/lib/"; cp "$HERE/../package.json" "$RSANDBOX/"
git -C "$RSANDBOX" rev-parse --git-dir >/dev/null 2>&1 && { echo "FAIL  the release sandbox is inside a git repo; refusing to run release.sh"; exit 1; }
CURV="$(sed -n 's/.*"version":[[:space:]]*"\([0-9.]*\)".*/\1/p' "$HERE/../package.json" | head -1)"
_p=$(( 10#${CURV##*.} + 1 )); NEXTV="${CURV%.*}.$(printf '%02d' "$_p")"   # 10#: a 0.5.09 patch is not octal
printf 'zip' > "$T/kosmos-9.9.9-win-x64.zip"
run_writer() {  # <site> <name> : sets WRC and out (not in a subshell, so both reach the caller)
  local site="$1" w="$2"
  case "$w" in
    # TMPDIR too, not only HOME: release.sh does `rm -rf "$TMPDIR/kosmos-cut-home"` before step 1, so the
    # caller's TMPDIR would lose a real cut's home and CI's #4273 leak check reds on what is left behind.
    # KOSMOS_HARNESS_IGNORE_CUT=1: inside a REAL cut (release.sh step 3 runs this file) the sandboxed release.sh would
    # otherwise refuse as "a second cut" at its live-cut guard, before it makes its cut-only home, and the home check
    # below reds the cut that is running it (0.7.64, 10-22). The freeze refusal under test comes before that guard.
    # KOSMOS_RUN_MARKER_DIR pins its markers and machine claim to the sandbox even if a cut ever exports that path.
    # KOSMOS_CUT_NO_WHATS_NEW=1: the sandbox has no What's New tools, and since kosmos#7349 their check runs before the
    # cut home is made (it comes after the freeze refusal under test; tools/test-whats-new-early-7349.sh covers it).
    release) HOME="$SB" TMPDIR="$T/tmp" KOSMOS_SITE="$site" KOSMOS_HARNESS_IGNORE_CUT=1 KOSMOS_CUT_NO_WHATS_NEW=1 KOSMOS_RUN_MARKER_DIR="$SB/.cache/kosmos-run-markers" bash "$RSANDBOX/tools/release.sh" "$NEXTV" > "$T/w.out" 2>&1; WRC=$? ;;   # the next patch: past the version-jump guard
    promote-channel) HOME="$SB" KOSMOS_SITE="$site" bash "$HERE/promote-channel.sh" > "$T/w.out" 2>&1; WRC=$? ;;
    publish-staging-pointer) HOME="$SB" bash "$HERE/publish-staging-pointer.sh" "$site" 9.9.9 > "$T/w.out" 2>&1; WRC=$? ;;
    publish-kosmos-windows) HOME="$SB" KOSMOS_SITE="$site" bash "$HERE/publish-kosmos-windows.sh" "$T/kosmos-9.9.9-win-x64.zip" > "$T/w.out" 2>&1; WRC=$? ;;
  esac
  out="$(cat "$T/w.out")"
}
C="$(make_site)"
for w in release promote-channel publish-staging-pointer publish-kosmos-windows; do
  before="$(git -C "$S" rev-parse HEAD) $(cat "$S/dist/latest.json" "$S/dist/latest-staging.json" | shasum -a 256)"
  run_writer "$S" "$w"
  after="$(git -C "$S" rev-parse HEAD) $(cat "$S/dist/latest.json" "$S/dist/latest-staging.json" | shasum -a 256)"
  { [ "$WRC" != 0 ] && has "$out" "$w.sh: the release pointers are FROZEN at $GOOD" && [ "$before" = "$after" ]; } \
    && pass "$w.sh refuses while frozen, changing nothing" || bad "$w.sh while frozen (rc=$WRC): $(printf '%s' "$out" | tail -3)"
  run_writer "$C" "$w"
  has "$out" "FROZEN" && bad "CONTROL: $w.sh says FROZEN with no marker: $(printf '%s' "$out" | tail -2)" || pass "CONTROL: $w.sh with no marker does not refuse for a freeze"
done
# the release arm made its cut-only home: it must be the sandbox's, or the TMPDIR above stopped reaching release.sh
[ -d "$T/tmp/kosmos-cut-home" ] && pass "release.sh made its cut-only home inside the test's TMPDIR, not the caller's" \
  || bad "release.sh made no cut-only home under $T/tmp (TMPDIR not passed, or the arm now stops before it)"

# ---- on again at the frozen version after a release file moved on top: not "nothing changed" --------------------
SM="$(make_site)"; out="$(pf "$SM" on --mac $GOOD --because "moved arm")"; rc=$?
[ $rc = 0 ] || bad "moved arm: on (rc=$rc) out=$out"
printf 'installer by hand KOSMOS_READONLY_APP\n' > "$SM/setup-staging"; ( cd "$SM" && shasum -a 256 setup-staging > setup-staging.sha256 )
git -C "$SM" commit -q -m "an installer by hand on top of the freeze" -- setup-staging setup-staging.sha256 && git -C "$SM" push -q origin main
out="$(pf "$SM" on --mac $GOOD --because again)"; rc=$?
{ [ $rc = 1 ] && has "$out" "changed since the freeze commit" && has "$out" "setup-staging" && ! has "$out" "nothing changed"; } \
  && pass "on at the frozen version, with an installer moved on top: says so (a deploy would refuse), not nothing changed" || bad "on moved (rc=$rc) out=$out"

# ---- the lib under dash, run as well as parsed ---------------------------------------------
# deploy-site.sh (#!/bin/sh) sources the lib, and test:shell's `sh -n` is macOS bash in POSIX mode and sees syntax only.
LIBF="$HERE/lib/pointer-freeze.sh"
if command -v dash >/dev/null 2>&1; then
  D="$T/dash-site"; mkdir -p "$D/dist"; git -C "$D" init -q
  out="$(dash -c '. "$1"; pointer_freeze_refuse "$2" dashtool' x "$LIBF" "$D" 2>&1)"; rc=$?
  [ "$rc" = 0 ] && [ -z "$out" ] && pass "dash: the lib loads and an unfrozen site is let through, silently" || bad "dash unfrozen: rc=$rc out=$out"
  printf 'mac=1.2.3\nbecause=dash arm\n' > "$D/dist/POINTER_FROZEN"
  out="$(dash -c '. "$1"; pointer_freeze_refuse "$2" dashtool' x "$LIBF" "$D" 2>&1)"; rc=$?
  [ "$rc" = 1 ] && has "$out" "dashtool: the release pointers are FROZEN at 1.2.3 (dash arm)" && pass "dash: a frozen site is refused, with the version and reason read from the marker" || bad "dash frozen: rc=$rc out=$out"
  # The time limit: a git that never answers is stopped at the limit (143, SIGTERM), its children with it. The stub
  # answers the lib's `config core.sshCommand` lookup at once: that is a local read, outside the limit.
  mkdir -p "$T/hangbin"; printf '#!/bin/sh\ncase "$*" in *" config "*) exit 1 ;; esac\nsleep 30 & echo $! > "$HANG_PID"; wait\n' > "$T/hangbin/git"; chmod +x "$T/hangbin/git"
  export HANG_PID="$T/hang.pid"; s0=$(date +%s); rc=0; PATH="$T/hangbin:$PATH" dash -c '. "$1"; pointer_freeze_git 2 "$2" fetch -q origin main' x "$LIBF" "$D" || rc=$?
  el=$(( $(date +%s) - s0 ))
  [ "$rc" = 143 ] && [ "$el" -lt 10 ] && pass "dash: a git that never answers is stopped at the limit (rc=143 after ${el}s)" || bad "dash time limit: rc=$rc after ${el}s"
  hp="$(cat "$HANG_PID" 2>/dev/null)"; sleep 1
  if [ -z "$hp" ]; then bad "dash time limit: the stub never started its child, so this arm proves nothing"
  elif kill -0 "$hp" 2>/dev/null; then bad "dash time limit: git's child $hp outlived the limit (the whole process group was not stopped)"; kill "$hp" 2>/dev/null
  else pass "dash: git's child process was stopped with it (the whole group)"; fi
else
  echo "SKIP  dash is not installed, so the lib was not run under it"
fi

echo ""
if [ "$fail" = 0 ]; then echo "test-pointer-freeze: ALL PASS"; else echo "test-pointer-freeze: FAILURES above"; exit 1; fi
