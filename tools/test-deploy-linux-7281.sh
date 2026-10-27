#!/bin/bash
# test-deploy-linux-7281.sh -- kosmos#7281 slice C3. Unit-tests tools/lib/deploy-linux.sh (a site deploy carries the
# Linux build each committed Linux pointer names) against a fake site and a file:// "host", and checks deploy-site.sh
# wires it. A whole deploy publishes to Vercel and is not driven here.
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
. "$HERE/tools/lib/deploy-linux.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/deploy-linux-7281.XXXXXX")"
trap 'rm -rf "$T"' EXIT

PASS=0; FAIL=0
chk() { local desc="$1"; shift; if "$@"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "FAIL: $desc" >&2; fi; }
not() { ! "$@"; }
sha() { shasum -a 256 "$1" | awk '{print $1}'; }

# A served host (a folder reached as file://) holding <v>'s Linux build and its .sha256.
newhost() {   # <name> <version>
  local h="$T/host-$1"; mkdir -p "$h/dist"
  printf 'linux build %s\n' "$2" > "$h/dist/kosmos-$2-linux-x64.tar.gz"
  ( cd "$h/dist" && shasum -a 256 "kosmos-$2-linux-x64.tar.gz" > "kosmos-$2-linux-x64.tar.gz.sha256" )
  printf 'file://%s\n' "$h"
}
# A site checkout whose commit has a Linux pointer (<file>) naming <v> with <sha>.
newsite() {   # <name> <pointer-file> <version> <sha>
  local s="$T/site-$1"
  git init -q -b main "$s"; git -C "$s" config user.email t@t; git -C "$s" config user.name t
  mkdir -p "$s/dist"
  printf '{"version":"%s","sha256":"%s","artifact":"kosmos-%s-linux-x64.tar.gz","manifest":"kosmos-%s-linux-x64.manifest.json","versioned":"kosmos-%s-linux-x64.tar.gz"}\n' "$3" "$4" "$3" "$3" "$3" > "$s/dist/$2"
  git -C "$s" add "dist/$2"; git -C "$s" commit -q -m p
  printf '%s\n' "$s"
}
carry() { ( deploy_linux_carry "$@" >/dev/null 2>&1; echo "rc=$? arts=$DEPLOY_LINUX_ARTS" ); }

H1="$(newhost a 1.7.0)"; SHA="$(sha "${H1#file://}/dist/kosmos-1.7.0-linux-x64.tar.gz")"

# ---- the carry ----
S="$(newsite fetch latest-linux.json 1.7.0 "$SHA")"
chk "absent locally: fetched from the host and checked against the pointer" [ "$(carry "$S" HEAD "$H1")" = "rc=0 arts=kosmos-1.7.0-linux-x64.tar.gz" ]
deploy_linux_carry "$S" HEAD "$H1" >/dev/null 2>&1
chk "the fetched tarball is the pointer's bytes" [ "$(sha "$S/dist/kosmos-1.7.0-linux-x64.tar.gz")" = "$SHA" ]
chk "and its .sha256 verifies in place" sh -c "cd '$S/dist' && shasum -a 256 -c --status kosmos-1.7.0-linux-x64.tar.gz.sha256"
chk "CONTROL: a local copy with the pointer's bytes is carried without a fetch" [ "$(carry "$S" HEAD "file:///nonexistent")" = "rc=0 arts=kosmos-1.7.0-linux-x64.tar.gz" ]
printf 'other bytes\n' > "$S/dist/kosmos-1.7.0-linux-x64.tar.gz"
chk "a local copy with other bytes is refused (the glob would ship it unchecked)" [ "$(carry "$S" HEAD "$H1")" = "rc=1 arts=" ]
S="$(newsite missing latest-linux.json 1.7.0 "$SHA")"
chk "neither local nor served: refused (every Linux install would 404)" [ "$(carry "$S" HEAD "file:///nonexistent")" = "rc=1 arts=" ]
chk "and nothing was left behind" [ -z "$(ls -A "$S/dist" | grep -v '^latest-linux.json$')" ]
S="$(newsite wrongsha latest-linux.json 1.7.0 "$(printf 'a%.0s' $(seq 1 64))")"
chk "a served build that is not the pointer's is refused" [ "$(carry "$S" HEAD "$H1")" = "rc=1 arts=" ]
chk "and the fetched bytes were discarded" [ ! -f "$S/dist/kosmos-1.7.0-linux-x64.tar.gz" ]
H2="$(newhost liar 1.7.0)"; printf '%s  kosmos-1.7.0-linux-x64.tar.gz\n' "$(printf 'b%.0s' $(seq 1 64))" > "${H2#file://}/dist/kosmos-1.7.0-linux-x64.tar.gz.sha256"
S="$(newsite liar latest-linux.json 1.7.0 "$SHA")"
chk "a served .sha256 that disagrees with the pointer is refused" [ "$(carry "$S" HEAD "$H2")" = "rc=1 arts=" ]
S="$(newsite badname latest-linux.json 1.7.0 "$SHA")"; node -e 'const f=process.argv[1];const p=JSON.parse(require("fs").readFileSync(f,"utf8"));p.versioned="../evil.tar.gz";require("fs").writeFileSync(f,JSON.stringify(p))' "$S/dist/latest-linux.json"; git -C "$S" commit -qam bad
chk "a pointer naming anything but kosmos-<v>-linux-x64.tar.gz is refused" [ "$(carry "$S" HEAD "$H1")" = "rc=1 arts=" ]
# A host whose .sha256 is right but whose tarball is not (a corrupt or half-uploaded file).
H3="$(newhost corrupt 1.7.0)"; printf '%s  kosmos-1.7.0-linux-x64.tar.gz\n' "$SHA" > "${H3#file://}/dist/kosmos-1.7.0-linux-x64.tar.gz.sha256"; printf 'corrupt\n' > "${H3#file://}/dist/kosmos-1.7.0-linux-x64.tar.gz"
S="$(newsite corrupt latest-linux.json 1.7.0 "$SHA")"
chk "served bytes that do not hash to the pointer are refused, even under a matching .sha256" [ "$(carry "$S" HEAD "$H3")" = "rc=1 arts=" ]
# A pointer naming another family's tarball, with bytes that would otherwise check out.
H4="$(newhost family 1.7.0)"; cp "${H1#file://}/dist/kosmos-1.7.0-linux-x64.tar.gz" "${H4#file://}/dist/kosmos-1.7.0-arm64.tar.gz"
printf '%s  kosmos-1.7.0-arm64.tar.gz\n' "$SHA" > "${H4#file://}/dist/kosmos-1.7.0-arm64.tar.gz.sha256"
S="$(newsite family latest-linux.json 1.7.0 "$SHA")"; node -e 'const f=process.argv[1];const p=JSON.parse(require("fs").readFileSync(f,"utf8"));p.versioned="kosmos-1.7.0-arm64.tar.gz";require("fs").writeFileSync(f,JSON.stringify(p))' "$S/dist/latest-linux.json"; git -C "$S" commit -qam fam
chk "a Linux pointer naming the Mac tarball is refused" [ "$(carry "$S" HEAD "$H4")" = "rc=1 arts=" ]
E="$T/site-none"; git init -q -b main "$E"; git -C "$E" config user.email t@t; git -C "$E" config user.name t; mkdir -p "$E/dist"; printf x > "$E/dist/.keep"; git -C "$E" add dist/.keep; git -C "$E" commit -q -m e
chk "CONTROL: no Linux pointer committed: nothing carried, no refusal" [ "$(carry "$E" HEAD "file:///nonexistent")" = "rc=0 arts=" ]
# Both pointers on one build: carried once.
S="$(newsite both latest-linux.json 1.7.0 "$SHA")"; cp "$S/dist/latest-linux.json" "$S/dist/latest-linux-staging.json"; git -C "$S" add dist/latest-linux-staging.json; git -C "$S" commit -q -m s
chk "prod and staging on one build: carried once" [ "$(carry "$S" HEAD "$H1")" = "rc=0 arts=kosmos-1.7.0-linux-x64.tar.gz" ]
chk "deploy_linux_pointers lists both" [ "$(deploy_linux_pointers "$S" HEAD | tr '\n' ' ')" = "latest-linux.json latest-linux-staging.json " ]
# The COMMITTED pointer decides, not the working tree.
S="$(newsite committed latest-linux.json 1.7.0 "$SHA")"; printf '{"version":"9.9.9"}\n' > "$S/dist/latest-linux.json"
chk "an uncommitted edit to the pointer does not change what is carried" [ "$(carry "$S" HEAD "$H1")" = "rc=0 arts=kosmos-1.7.0-linux-x64.tar.gz" ]

# ---- review 1 ----
# BLOCKER: the setup floor, RUN on a real Linux pointer (it used to read kosmos-0.7.80-linux-x64.tar.gz as 0.7.80-linux).
. "$HERE/tools/lib/setup-floor.sh"
LP='{"version":"0.7.80","sha256":"'"$SHA"'","artifact":"kosmos-0.7.80-linux-x64.tar.gz","manifest":"kosmos-0.7.80-linux-x64.manifest.json","versioned":"kosmos-0.7.80-linux-x64.tar.gz"}'
chk "the setup floor accepts a Linux pointer" kosmos_setup_floor_pointer_ok "a Linux pointer" "$LP"
chk "CONTROL: and a Mac one" kosmos_setup_floor_pointer_ok "a Mac pointer" '{"version":"0.7.80","sha256":"'"$SHA"'","artifact":"kosmos-0.7.80-arm64.tar.gz","manifest":"kosmos-0.7.80-arm64.manifest.json"}'
chk "and still refuses an artifact for another version" not kosmos_setup_floor_pointer_ok "a mismatched pointer" '{"version":"0.7.80","artifact":"kosmos-0.7.79-linux-x64.tar.gz"}' 2>/dev/null
# Review 2: names the greedy parse refused must stay refused.
chk "an rc build under a clean version is refused" not kosmos_setup_floor_pointer_ok "rc" '{"version":"0.7.80","artifact":"kosmos-0.7.80-rc-arm64.tar.gz"}' 2>/dev/null
chk "extra text after the arch is refused" not kosmos_setup_floor_pointer_ok "evil" '{"version":"0.7.80","artifact":"kosmos-0.7.80-arm64-evil.tar.gz"}' 2>/dev/null
chk "an unknown arch is refused" not kosmos_setup_floor_pointer_ok "arch" '{"version":"0.7.80","artifact":"kosmos-0.7.80-sparc.tar.gz"}' 2>/dev/null
# Review 3: a Windows-shaped Linux pointer (artifact = the unversioned alias, versioned = the build) is checked on its build.
chk "a Linux pointer whose artifact is the alias passes on its versioned name" kosmos_setup_floor_pointer_ok "alias" '{"version":"0.7.80","artifact":"kosmos-linux-x64.tar.gz","versioned":"kosmos-0.7.80-linux-x64.tar.gz"}'
chk "and its versioned name is still held to the version" not kosmos_setup_floor_pointer_ok "alias-wrong" '{"version":"0.7.80","artifact":"kosmos-linux-x64.tar.gz","versioned":"kosmos-0.7.79-linux-x64.tar.gz"}' 2>/dev/null
# W2: a host that cannot be reached is "try again later" (75), not "not served" (1).
S="$(newsite transient latest-linux.json 1.7.0 "$SHA")"
out="$(FETCH_ATTEMPTS=1 FETCH_RETRY_DELAY=0 deploy_linux_carry "$S" HEAD "http://127.0.0.1:1" >/dev/null 2>&1; echo "rc=$?")"
chk "an unreachable host returns 75 (autodeploy retries), not 1" [ "$out" = "rc=75" ]
# Review 2: a transfer cut off after its 200 is not a 200 (a stand-in curl prints the status and exits 18).
FB="$T/fakebin"; mkdir -p "$FB"; printf '#!/bin/sh\nprintf 200\nexit 18\n' > "$FB/curl"; chmod +x "$FB/curl"
out="$(PATH="$FB:$PATH" FETCH_ATTEMPTS=2 FETCH_RETRY_DELAY=0 _deploy_linux_get "https://example.invalid/x" "$T/cut")"
chk "a cut-off transfer reads 000, not 200" [ "$out" = 000 ]
# Review 2: a live pointer that answers with no readable version cannot pass the backwards check by default.
H6="$(newhost garbled 1.7.0)"; printf '<html>rewrite</html>\n' > "${H6#file://}/dist/latest-linux.json"
S="$(newsite garbled latest-linux.json 1.7.0 "$SHA")"
out="$(deploy_linux_carry "$S" HEAD "$H6" >/dev/null 2>&1; echo "rc=$?")"
chk "a live pointer with no version is 'try again later' (75), not a pass" [ "$out" = "rc=75" ]
# W3: a refused fetch leaves no temp in the shared dist/ and nothing in deploy-site's in-flight slots.
S="$(newsite litter latest-linux.json 1.7.0 "$(printf 'c%.0s' $(seq 1 64))")"
( deploy_linux_carry "$S" HEAD "$H1" >/dev/null 2>&1; echo "A=${_FETCH_TMP_A:-} S=${_FETCH_TMP_S:-}" ) > "$T/slots"
chk "no temp is left in dist/ after a refusal" [ -z "$(ls -A "$S/dist" | grep '^\.')" ]
chk "and the in-flight slots are cleared" [ "$(cat "$T/slots")" = "A= S=" ]
# W4: never move a Linux pointer backwards from what live serves.
H5="$(newhost newer 1.7.0)"; printf '{"version":"1.8.0"}\n' > "${H5#file://}/dist/latest-linux.json"
S="$(newsite stale latest-linux.json 1.7.0 "$SHA")"
chk "a committed Linux pointer older than live is refused" [ "$(carry "$S" HEAD "$H5")" = "rc=1 arts=" ]
chk "a deliberate rollback names its version and passes" [ "$(KOSMOS_LINUX_ROLLBACK=1.7.0 carry "$S" HEAD "$H5")" = "rc=0 arts=kosmos-1.7.0-linux-x64.tar.gz" ]
printf '{"version":"1.6.0"}\n' > "${H5#file://}/dist/latest-linux.json"
chk "CONTROL: moving forward from live passes" [ "$(carry "$S" HEAD "$H5")" = "rc=0 arts=kosmos-1.7.0-linux-x64.tar.gz" ]
# The mode through node, not stat (BSD stat -f and GNU stat -c differ; the Linux shard runs this too).
chk "a fetched tarball is served mode 644" [ "$(node -e 'process.stdout.write((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$S/dist/kosmos-1.7.0-linux-x64.tar.gz")" = 644 ]

# ---- the export check ----
X="$T/export"; mkdir -p "$X/dist"; DEPLOY_LINUX_ARTS="kosmos-1.7.0-linux-x64.tar.gz"
cp "${H1#file://}/dist/kosmos-1.7.0-linux-x64.tar.gz" "${H1#file://}/dist/kosmos-1.7.0-linux-x64.tar.gz.sha256" "$X/dist/"
chk "CONTROL: an export carrying the pair passes" deploy_linux_export_ok "$X"
rm -f "$X/dist/kosmos-1.7.0-linux-x64.tar.gz.sha256"
chk "an export without the .sha256 is refused" not deploy_linux_export_ok "$X" 2>/dev/null
cp "${H1#file://}/dist/kosmos-1.7.0-linux-x64.tar.gz.sha256" "$X/dist/"; rm -f "$X/dist/kosmos-1.7.0-linux-x64.tar.gz"
chk "an export without the tarball is refused" not deploy_linux_export_ok "$X" 2>/dev/null
DEPLOY_LINUX_ARTS=""
chk "CONTROL: nothing carried, nothing to check" deploy_linux_export_ok "$X"

# ---- deploy-site.sh wires it ----
DS="$HERE/tools/deploy-site.sh"
wired() { grep -qF -- "$1" "$DS"; }
chk "the lib is sourced" wired '. "$REPO/tools/lib/deploy-linux.sh" || {'
chk "the committed Linux pointers meet the setup floor" wired 'kosmos_setup_floor_pointer_ok "the committed dist/$_lp"'
chk "the carry runs after the Mac carries; 75 stays 75, anything else exits 1 (literal codes, #6826)" wired 'deploy_linux_carry "$SITE" "$H" "$HOST" || { [ $? = 75 ] && exit 75; exit 1; }'
chk "the export check refuses" wired 'deploy_linux_export_ok "$EXPORT" || { rm -rf "$EXPORT"; exit 1; }'
chk "the live-pointer snapshot watches the Linux pointers" wired 'latest-win-staging.json latest-linux.json latest-linux-staging.json; do'
order() {
  local c e x
  c="$(grep -nF 'deploy_linux_carry "$SITE"' "$DS" | cut -d: -f1)"; x="$(grep -nF 'site_deploy_export "$SITE" "$EXPORT"' "$DS" | cut -d: -f1)"
  e="$(grep -nF 'deploy_linux_export_ok "$EXPORT"' "$DS" | cut -d: -f1)"
  [ -n "$c" ] && [ -n "$x" ] && [ -n "$e" ] && [ "$c" -lt "$x" ] && [ "$x" -lt "$e" ]
}
chk "the carry precedes the export, the check follows it" order

echo "test-deploy-linux-7281: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
