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
chk "the carry runs after the Mac carries and refuses" wired 'deploy_linux_carry "$SITE" "$H" "$HOST" || exit 1'
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
