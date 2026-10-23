#!/usr/bin/env bash
# test-promote-named-7005.sh - kosmos#7005: promote-channel.sh --version <V> promotes a NAMED build.
#
# Without it, the promote copies whatever latest-staging.json names NOW, so a prod GO pending on one
# build froze staging (a staging cut would have replaced the approved build). With --version, the
# pointer and installer come from the site commit whose latest-staging.json names V (the staging
# cut's own commit). Run against a fixture git site holding two committed staging cuts, 9.9.8 then
# 9.9.9, so staging names 9.9.9 while the promote names 9.9.8. Every refusal has a control.
#
#   bash tools/test-promote-named-7005.sh
set -uo pipefail
# The fixture versions are below the setup floor, so it is lowered here (as tools/test-setup-staging-5032.sh does);
# the stand-in installers carry KOSMOS_READONLY_APP. tools/test-setup-floor-6149.sh tests the floor.
export KOSMOS_SETUP_FLOOR_TEST=1 KOSMOS_SETUP_FLOOR_LOWER=0.0.0
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/promote-named-7005.XXXXXXXX")"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/tmp"; export TMPDIR="$T/tmp"   # the promote's temp files land here, so the leftover check reads only this test's
fail=0
pass() { printf 'PASS  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fail=1; }
has()  { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

STUB="$T/stub-gate.sh"; printf '#!/usr/bin/env bash\nexit 0\n' > "$STUB"; chmod +x "$STUB"
# The experience gate records the version it was asked to expect.
EXPECT_LOG="$T/expect.log"
XGATE="$T/stub-expect-gate.sh"; printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$KOSMOS_GATE_EXPECT_VERSION" >> "%s"\nexit 0\n' "$EXPECT_LOG" > "$XGATE"; chmod +x "$XGATE"
export KOSMOS_PROMOTE_GATE_CMD="bash $XGATE" KOSMOS_PROMOTE_AGENT_GATE_CMD="bash $STUB" KOSMOS_PROMOTE_PLUS_GATE_CMD="bash $STUB" KOSMOS_PROMOTE_TUNNEL_GATE_CMD="bash $STUB"
export KOSMOS_PLUS_VERIFY_DIR="$T/plus-verify"
WR="$HERE/lib/write-latest-pointer.js"

cut() {   # <site> <version> [installer-text] [setup_sha256 to name instead of the installer's own]: one committed staging cut
  local s="$1" v="$2" inst="${3:-INSTALLER-$2 KOSMOS_READONLY_APP}" art="kosmos-$2-arm64.tar.gz" sha named
  printf 'ARTIFACT-BYTES-%s\n' "$v" > "$s/dist/$art"; ( cd "$s/dist" && shasum -a 256 "$art" > "$art.sha256" )
  sha="$(awk '{print $1}' "$s/dist/$art.sha256")"
  printf '{"files":[]}\n' > "$s/dist/kosmos-$v-arm64.manifest.json"
  printf '%s\n' "$inst" > "$s/setup-staging"; ( cd "$s" && shasum -a 256 setup-staging | sed 's/setup-staging$/setup/' > setup-staging.sha256 )
  named="${4:-$(shasum -a 256 < "$s/setup-staging" | awk '{print $1}')}"
  KM_LJ_VERSION="$v" KM_LJ_SHA="$sha" KM_LJ_ARTIFACT="$art" KM_LJ_MANIFEST="kosmos-$v-arm64.manifest.json" KM_LJ_SETUP_SHA="$named" \
    node "$WR" "$s/dist/latest-staging.json"
  git -C "$s" add dist/latest-staging.json "dist/kosmos-$v-arm64.manifest.json" setup-staging setup-staging.sha256
  git -C "$s" commit -qm "$v: the staging pointer (latest-staging.json), installer and versions entry"
}
newsite() {   # prod serves 1.0.0 with the prod installer; staging cuts 9.9.8 then 9.9.9 are committed
  local d; d="$(mktemp -d "$T/site.XXXXXX")"; mkdir -p "$d/dist"
  git -C "$d" init -q; git -C "$d" config user.email t@t; git -C "$d" config user.name t
  echo '{"version":"1.0.0"}' > "$d/dist/latest.json"
  printf 'PROD-INSTALLER KOSMOS_READONLY_APP\n' > "$d/setup"; ( cd "$d" && shasum -a 256 setup > setup.sha256 )
  git -C "$d" add dist/latest.json setup setup.sha256; git -C "$d" commit -qm init
  cut "$d" 9.9.8; cut "$d" 9.9.9
  printf '%s' "$d"
}
field() { node -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]]||""))}catch{}' "$1" "$2"; }
untouched() {   # <site>: the prod pointer and /setup are as newsite left them
  [ "$(cat "$1/dist/latest.json")" = '{"version":"1.0.0"}' ] && [ "$(cat "$1/setup")" = "PROD-INSTALLER KOSMOS_READONLY_APP" ]
}

# ---- the named build is promoted while staging names a later one ----
S="$(newsite)"
[ "$(field "$S/dist/latest-staging.json" version)" = 9.9.9 ] && pass "fixture: staging names 9.9.9" || bad "fixture: staging is not 9.9.9"
: > "$EXPECT_LOG"
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 2>&1)"; rc=$?
[ "$rc" = 0 ] && pass "named: exit 0" || bad "named exit (rc=$rc, out=$out)"
[ "$(field "$S/dist/latest.json" version)" = 9.9.8 ] && [ "$(field "$S/dist/latest.json" artifact)" = kosmos-9.9.8-arm64.tar.gz ] \
  && [ "$(field "$S/dist/latest.json" sha256)" = "$(awk '{print $1}' "$S/dist/kosmos-9.9.8-arm64.tar.gz.sha256")" ] \
  && pass "named: latest.json names 9.9.8 and its bytes" || bad "named: latest.json is $(cat "$S/dist/latest.json")"
[ "$(cat "$S/setup")" = "INSTALLER-9.9.8 KOSMOS_READONLY_APP" ] && pass "named: /setup is 9.9.8's installer, read from its commit (not the working tree's 9.9.9 one)" || bad "named: /setup is '$(cat "$S/setup")'"
( cd "$S" && [ "$(awk '{print $1}' setup.sha256)" = "$(shasum -a 256 < setup | awk '{print $1}')" ] ) && pass "named: /setup.sha256 names the promoted installer" || bad "named: setup.sha256 does not describe setup"
cmp -s "$S/dist/kosmos-arm64.tar.gz" "$S/dist/kosmos-9.9.8-arm64.tar.gz" && pass "named: the prod alias holds 9.9.8's bytes" || bad "named: the alias is not 9.9.8"
[ "$(field "$S/dist/latest-staging.json" version)" = 9.9.9 ] && [ "$(cat "$S/setup-staging")" = "INSTALLER-9.9.9 KOSMOS_READONLY_APP" ] \
  && pass "named: staging still names 9.9.9, and setup-staging is untouched" || bad "named: staging was changed"
[ "$(cat "$EXPECT_LOG")" = 9.9.8 ] && pass "named: the experience gate was asked to expect 9.9.8" || bad "named: the gate expected '$(cat "$EXPECT_LOG")'"
has "$out" "committed in" && pass "named: says which commit it read" || bad "named: does not name the commit (out=$out)"
ls -d "$TMPDIR"/promote-channel-named.* >/dev/null 2>&1 && bad "named: left a temp folder behind" || pass "named: no temp folder left behind"

# CONTROL: without --version the default path is unchanged, and promotes what staging names now.
S="$(newsite)"
out="$(bash "$HERE/promote-channel.sh" "$S" 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(field "$S/dist/latest.json" version)" = 9.9.9 ] && [ "$(cat "$S/setup")" = "INSTALLER-9.9.9 KOSMOS_READONLY_APP" ] \
  && pass "default: CONTROL without --version, 9.9.9 (what staging names) is promoted" || bad "default (rc=$rc, latest.json: $(cat "$S/dist/latest.json"), out=$out)"

# ---- the live staging state does not matter to a named promote ----
# A setup-staging edited in the working tree refuses the default promote; it is not what a named one reads.
S="$(newsite)"; printf 'EDITED KOSMOS_READONLY_APP\n' > "$S/setup-staging"
out="$(bash "$HERE/promote-channel.sh" "$S" 2>&1)"; rc=$?
[ "$rc" = 1 ] && untouched "$S" && pass "default: CONTROL an edited setup-staging refuses the default promote" || bad "default edited setup-staging (rc=$rc, out=$out)"
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$S/setup")" = "INSTALLER-9.9.8 KOSMOS_READONLY_APP" ] && pass "named: an edited working-tree setup-staging is not read" || bad "named with an edited setup-staging (rc=$rc, out=$out)"
# A staging publish while the gates run refuses the default promote; the named build cannot move.
MOVE="$T/stub-moving-gate.sh"
printf '#!/usr/bin/env bash\nprintf "{\\"version\\":\\"9.9.10\\"}\\n" > "$MOVE_SITE/dist/latest-staging.json"\nexit 0\n' > "$MOVE"; chmod +x "$MOVE"
S="$(newsite)"
out="$(MOVE_SITE="$S" KOSMOS_PROMOTE_GATE_CMD="bash $MOVE" bash "$HERE/promote-channel.sh" "$S" 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "changed while the promote ran" && untouched "$S" && pass "default: CONTROL a staging publish during the gates refuses" || bad "default moved-during-gates (rc=$rc, out=$out)"
S="$(newsite)"
out="$(MOVE_SITE="$S" KOSMOS_PROMOTE_GATE_CMD="bash $MOVE" bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(field "$S/dist/latest.json" version)" = 9.9.8 ] && pass "named: a staging publish during the gates does not change what is promoted" || bad "named moved-during-gates (rc=$rc, out=$out)"

# ---- refusals: each leaves the prod pointer and /setup untouched ----
refused() {   # label site expected-phrase args...
  local label="$1" site="$2" phrase="$3" out rc; shift 3
  out="$(bash "$HERE/promote-channel.sh" "$site" "$@" 2>&1)"; rc=$?
  if [ "$rc" = 1 ] && untouched "$site" && has "$out" "$phrase"; then pass "named: refuses $label, nothing written"
  else bad "named $label (rc=$rc, latest.json: $(cat "$site/dist/latest.json"), out=$out)"; fi
}
refused "a version no commit names" "$(newsite)" "no commit on" --version 9.9.7
S="$(newsite)"; rm -f "$S/dist/kosmos-9.9.8-arm64.tar.gz"
refused "a named build whose artifact is not on disk" "$S" "which is not in" --version 9.9.8
S="$(newsite)"; printf 'OTHER\n' > "$S/dist/kosmos-9.9.8-arm64.tar.gz"
refused "a named build whose artifact does not verify" "$S" "does not verify" --version 9.9.8
S="$(newsite)"; cut "$S" 9.9.6 "INSTALLER-9.9.6 KOSMOS_READONLY_APP" "$(printf 'ANOTHER-CUT\n' | shasum -a 256 | awk '{print $1}')"
refused "a commit whose installer is not the one its pointer names" "$S" "but the staging pointer names installer" --version 9.9.6
S="$(newsite)"; cut "$S" 9.9.5; git -C "$S" rm -q setup-staging setup-staging.sha256; git -C "$S" commit -q --amend -m "9.9.5 without its installer"
refused "a commit whose pointer names an installer it does not carry" "$S" "has no setup-staging pair" --version 9.9.5
refused "a version that is not a version" "$(newsite)" "must be a version" --version ../9.9.8
refused "--version for the Windows family" "$(newsite)" "for the Mac promote only" --version 9.9.8 --family win
# CONTROL for the version check: the = form parses as the spaced one.
S="$(newsite)"; out="$(bash "$HERE/promote-channel.sh" "$S" --version=9.9.8 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(field "$S/dist/latest.json" version)" = 9.9.8 ] && pass "named: CONTROL --version=9.9.8 promotes as --version 9.9.8 does" || bad "named --version= form (rc=$rc, out=$out)"

echo ""
if [ "$fail" = 0 ]; then echo "test-promote-named-7005: ALL PASS"; else echo "test-promote-named-7005: FAILURES above"; exit 1; fi
