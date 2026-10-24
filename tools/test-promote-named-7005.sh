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

mkcut() {   # <site> <version> [installer-text] [setup_sha256 to name instead of the installer's own, or "none"]: one committed staging cut
  local s="$1" v="$2" inst="${3:-INSTALLER-$2 KOSMOS_READONLY_APP}" art="kosmos-$2-arm64.tar.gz" sha named
  printf 'ARTIFACT-BYTES-%s\n' "$v" > "$s/dist/$art"; ( cd "$s/dist" && shasum -a 256 "$art" > "$art.sha256" )
  sha="$(awk '{print $1}' "$s/dist/$art.sha256")"
  printf '{"files":[]}\n' > "$s/dist/kosmos-$v-arm64.manifest.json"
  printf '%s\n' "$inst" > "$s/setup-staging"; ( cd "$s" && shasum -a 256 setup-staging | sed 's/setup-staging$/setup/' > setup-staging.sha256 )
  named="${4:-$(shasum -a 256 < "$s/setup-staging" | awk '{print $1}')}"; [ "$named" = none ] && named=""
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
  mkcut "$d" 9.9.8; mkcut "$d" 9.9.9
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
has "$out" "manifest kosmos-9.9.8-arm64.manifest.json from dist/ (sha256 $(shasum -a 256 < "$S/dist/kosmos-9.9.8-arm64.manifest.json" | awk '{print $1}'))" && pass "named: records the manifest bytes it checked" || bad "named: manifest sha not recorded (out=$out)"
ls -d "$TMPDIR"/promote-channel-named.* >/dev/null 2>&1 && bad "named: left a temp folder behind" || pass "named: no temp folder left behind"
mkdir "$TMPDIR/promote-channel-named.control"   # CONTROL: the same glob sees a folder that is there
ls -d "$TMPDIR"/promote-channel-named.* >/dev/null 2>&1 && pass "named: CONTROL the leftover check sees a planted folder" || bad "named: the leftover check cannot see a folder"
rmdir "$TMPDIR/promote-channel-named.control"

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
refused "a version no commit names" "$(newsite)" "has a latest-staging.json naming 9.9.7 - refusing; nothing was written. (Pull the site, or check the version.)" --version 9.9.7
S="$(newsite)"; rm -f "$S/dist/kosmos-9.9.8-arm64.tar.gz"
refused "a named build whose artifact is not on disk" "$S" "the pointer committed in" --version 9.9.8
S="$(newsite)"; printf 'OTHER\n' > "$S/dist/kosmos-9.9.8-arm64.tar.gz"
refused "a named build whose artifact does not verify" "$S" "does not verify" --version 9.9.8
S="$(newsite)"; mkcut "$S" 9.9.6 "INSTALLER-9.9.6 KOSMOS_READONLY_APP" "$(printf 'ANOTHER-CUT\n' | shasum -a 256 | awk '{print $1}')"
refused "a commit whose installer is not the one its pointer names" "$S" "nothing was written. (The installer committed beside the latest-staging.json committed in" --version 9.9.6
printf '%s\n' "$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.6 2>&1)" | grep -q 'is not the one it names\.)$' && pass "named: that refusal ends on its own hint, nothing after it" || bad "named installer-mismatch hint has a tail"
S="$(newsite)"; mkcut "$S" 9.9.5; git -C "$S" rm -q setup-staging setup-staging.sha256; git -C "$S" commit -q --amend -m "9.9.5 without its installer"
refused "a commit whose pointer names an installer it does not carry" "$S" "has no setup-staging pair" --version 9.9.5
refused "a version that is not a version" "$(newsite)" "must be a version" --version ../9.9.8
refused "--version for the Windows family" "$(newsite)" "for the Mac promote only" --version 9.9.8 --family win
# CONTROL for the version check: the = form parses as the spaced one.
S="$(newsite)"; out="$(bash "$HERE/promote-channel.sh" "$S" --version=9.9.8 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(field "$S/dist/latest.json" version)" = 9.9.8 ] && pass "named: CONTROL --version=9.9.8 promotes as --version 9.9.8 does" || bad "named --version= form (rc=$rc, out=$out)"

# ---- several commits name V: the staging cut's own commit is the one used ----
republish() {   # <site> <version> [setup_sha256 or ""] [sha256 override]: a hand republish of V's pointer, committed, setup-staging untouched
  local s="$1" v="$2" art="kosmos-$2-arm64.tar.gz"
  KM_LJ_VERSION="$v" KM_LJ_SHA="${4:-$(awk '{print $1}' "$s/dist/$art.sha256")}" KM_LJ_ARTIFACT="$art" KM_LJ_MANIFEST="kosmos-$v-arm64.manifest.json" KM_LJ_SETUP_SHA="${3:-}" \
    node "$WR" "$s/dist/latest-staging.json"
  git -C "$s" commit -qm "$v: staging pointer republished by hand" -- dist/latest-staging.json
}
# A staging rollback to 9.9.8 after 9.9.9: its commit names 9.9.8 and NO installer, and sits beside 9.9.9's setup-staging.
S="$(newsite)"; republish "$S" 9.9.8
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$S/setup")" = "INSTALLER-9.9.8 KOSMOS_READONLY_APP" ] && pass "named: a later republish naming no installer does not hide the cut's own installer" || bad "named after an installer-less republish (rc=$rc, setup: $(cat "$S/setup"), out=$out)"
has "$out" "a later commit naming it, points at the same build" && pass "named: says a later commit names V, and that it points at the same build" || bad "named same-build NOTE (out=$out)"
# The same build under a later commit that names ANOTHER installer (its tree's setup-staging does not match it): said.
S="$(newsite)"; republish "$S" 9.9.8 "$(printf 'OTHER-INSTALLER\n' | shasum -a 256 | awk '{print $1}')"
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$S/setup")" = "INSTALLER-9.9.8 KOSMOS_READONLY_APP" ] && has "$out" "points at the same build but names installer" \
  && pass "named: a later commit naming another installer for the same build is said, not hidden" || bad "named installer-differs NOTE (rc=$rc, out=$out)"
# A later commit naming V whose pointer differs in another field: the NOTE says so and how to use it.
S="$(newsite)"; node -e 'const f=process.argv[1];const p=JSON.parse(require("fs").readFileSync(f,"utf8"));p.version="9.9.8";p.sha256=require("fs").readFileSync(process.argv[2],"utf8").split(" ")[0];p.artifact="kosmos-9.9.8-arm64.tar.gz";p.manifest="kosmos-9.9.8-arm64.manifest.json";delete p.setup_sha256;p.extra="corrected";require("fs").writeFileSync(f,JSON.stringify(p)+"\n")' "$S/dist/latest-staging.json" "$S/dist/kosmos-9.9.8-arm64.tar.gz.sha256"
git -C "$S" commit -qm "9.9.8 republished with another field" -- dist/latest-staging.json
refused "a later commit naming V whose pointer differs, without --commit" "$S" "(9.9.8's cut) and" --version 9.9.8
cl="$(git -C "$S" log --format=%H -1)"
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 --commit "${cl:0:10}" 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(field "$S/dist/latest.json" extra)" = corrected ] && pass "named: --commit promotes the later pointer when it is the right one" || bad "named --commit later pointer (rc=$rc, out=$out)"
# The same republish keeping 9.9.8's installer name, but committed beside 9.9.9's setup-staging: the cut's commit still wins.
S="$(newsite)"; republish "$S" 9.9.8 "$(printf 'INSTALLER-9.9.8 KOSMOS_READONLY_APP\n' | shasum -a 256 | awk '{print $1}')"
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$S/setup")" = "INSTALLER-9.9.8 KOSMOS_READONLY_APP" ] && pass "named: a later republish beside another cut's setup-staging does not refuse the cut's own pair" || bad "named after a paired-name republish (rc=$rc, out=$out)"
# Commits that name V with different bytes: which build V is cannot be told, so it refuses.
S="$(newsite)"; republish "$S" 9.9.8 "" "$(printf '%064d' 7)"
refused "commits naming V with different bytes" "$S" "disagree on its build" --version 9.9.8
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 2>&1)"
has "$out" "sha256 000000000000 in" && has "$out" "name the build that was approved with --sha" && pass "named: that refusal lists the builds and names the way out (--sha)" || bad "named disagreement message (out=$out)"
# --sha names the approved build: the cut's 9.9.8 promotes, and the other build cannot be picked by a wrong prefix.
real98="$(awk '{print $1}' "$S/dist/kosmos-9.9.8-arm64.tar.gz.sha256")"
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 --sha "${real98:0:8}" 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(field "$S/dist/latest.json" sha256)" = "$real98" ] && [ "$(cat "$S/setup")" = "INSTALLER-9.9.8 KOSMOS_READONLY_APP" ] \
  && pass "named: --sha picks the approved build among commits that disagree" || bad "named --sha (rc=$rc, out=$out)"
S="$(newsite)"; refused "--sha naming no build of V" "$S" "with a sha256 starting deadbeef - refusing; nothing was written. (Check the version, and the --sha or --commit given.)" --version 9.9.8 --sha deadbeef
# Two builds of V whose sha256 share the prefix given: it asks for more of the sha, not for --sha.
S="$(newsite)"; real98="$(awk '{print $1}' "$S/dist/kosmos-9.9.8-arm64.tar.gz.sha256")"
republish "$S" 9.9.8 "" "${real98:0:8}$(printf '%056d' 0)"
refused "a --sha prefix two builds share" "$S" "More than one build's sha256 starts with ${real98:0:8}: give more of" --version 9.9.8 --sha "${real98:0:8}"
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 --sha "${real98:0:12}" 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(field "$S/dist/latest.json" sha256)" = "$real98" ] && pass "named: CONTROL more of the sha picks the build" || bad "named longer --sha (rc=$rc, out=$out)"
# A site folder that is not a git checkout: said as such, not as "pull the site".
N="$T/not-a-repo"; mkdir -p "$N/dist"; echo '{"version":"1.0.0"}' > "$N/dist/latest.json"
out="$(bash "$HERE/promote-channel.sh" "$N" --version 9.9.8 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "is not a git checkout with a HEAD" && pass "named: a site that is not a git checkout is refused as such" || bad "named not-a-repo (rc=$rc, out=$out)"
refused "--sha shorter than 8 characters" "$(newsite)" "8 to 64 lowercase hex" --version 9.9.8 --sha abc
out="$(bash "$HERE/promote-channel.sh" "$(newsite)" --sha "${real98:0:8}" 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "--sha goes with --version" && pass "default: --sha alone is refused" || bad "--sha alone (rc=$rc, out=$out)"
S="$(newsite)"; KM_LJ_VERSION=9.9.8 KM_LJ_SHA="$(awk '{print $1}' "$S/dist/kosmos-9.9.8-arm64.tar.gz.sha256")" KM_LJ_ARTIFACT=kosmos-9.9.8-arm64.tar.gz KM_LJ_MANIFEST=kosmos-9.9.8-arm64.other.json \
  node "$WR" "$S/dist/latest-staging.json"; git -C "$S" commit -qm "9.9.8 republished naming another manifest" -- dist/latest-staging.json
refused "commits naming V with the same bytes but another manifest" "$S" "which --sha cannot separate: name the commit whose pointer is right with --commit" --version 9.9.8
c98="$(git -C "$S" log --format=%H -1 --grep='^9\.9\.8: the staging pointer')"
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 --commit "${c98:0:10}" 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(field "$S/dist/latest.json" manifest)" = kosmos-9.9.8-arm64.manifest.json ] && pass "named: --commit picks the commit when builds differ only in their manifest" || bad "named --commit (rc=$rc, out=$out)"
refused "--commit naming no commit that names V" "$(newsite)" "in a commit starting 0000000" --version 9.9.8 --commit 0000000
refused "a malformed --commit" "$(newsite)" "7 to 40 lowercase hex" --version 9.9.8 --commit xyz
out="$(bash "$HERE/promote-channel.sh" "$(newsite)" --commit 0000000 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "--commit goes with --version" && pass "default: --commit alone is refused" || bad "--commit alone (rc=$rc, out=$out)"

# ---- a named pointer that names no installer: /setup is left, and the hand fix names the commit ----
S="$(newsite)"; mkcut "$S" 9.9.10 "INSTALLER-9.9.10 KOSMOS_READONLY_APP" none
mkcut "$S" 9.9.11
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.10 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(field "$S/dist/latest.json" version)" = 9.9.10 ] && [ "$(cat "$S/setup")" = "PROD-INSTALLER KOSMOS_READONLY_APP" ] \
  && pass "named: a pointer naming no installer promotes and leaves /setup as it is" || bad "named no-installer (rc=$rc, out=$out)"
c10="$(git -C "$S" log --format=%H -1 --grep='^9\.9\.10: the staging pointer')"   # the cut's own commit (a -G search would also find 9.9.11's, which removed the 9.9.10 line)
want="If 9.9.10 was cut with the installer committed beside the latest-staging.json committed in ${c10:0:10}, run git show ${c10}:setup-staging > setup && git show ${c10}:setup-staging.sha256 > setup.sha256 (in $S) and commit them with latest.json."
has "$out" "$want" && pass "named: the hand fix it prints reads the named commit, word for word" || bad "named no-installer hand fix (want: $want, out=$out)"
# CONTROL: the default promote of the same kind of pointer prints the default hand fix, unchanged.
S="$(newsite)"; mkcut "$S" 9.9.10 "INSTALLER-9.9.10 KOSMOS_READONLY_APP" none
out="$(bash "$HERE/promote-channel.sh" "$S" 2>&1)"; rc=$?
[ "$rc" = 0 ] && has "$out" "If 9.9.10 was cut with setup-staging, copy setup-staging (+ .sha256) onto setup (+ .sha256) by hand and commit them with latest.json." \
  && pass "default: CONTROL the hand fix for a pointer naming no installer is the old sentence" || bad "default no-installer hand fix (rc=$rc, out=$out)"

# A republish of a V cut with no installer is the chosen commit, beside a LATER cut's setup-staging: that installer is not
# offered as V's.
S="$(newsite)"; mkcut "$S" 9.9.10 "INSTALLER-9.9.10 KOSMOS_READONLY_APP" none; mkcut "$S" 9.9.11; republish "$S" 9.9.10
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.10 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$S/setup")" = "PROD-INSTALLER KOSMOS_READONLY_APP" ] && ! has "$out" "git show" && has "$out" "may belong to another cut" \
  && pass "named: beside a republish, a later cut's setup-staging is not offered as V's installer" || bad "named republish hand fix (rc=$rc, out=$out)"

# ---- the gates still decide: a cannot-tell experience gate HOLDS a named promote ----
HOLD="$T/stub-hold-gate.sh"; printf '#!/usr/bin/env bash
exit 2
' > "$HOLD"; chmod +x "$HOLD"
S="$(newsite)"; out="$(KOSMOS_PROMOTE_GATE_CMD="bash $HOLD" bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 2>&1)"; rc=$?
[ "$rc" = 2 ] && untouched "$S" && pass "named: a cannot-tell experience gate holds (exit 2), nothing written" || bad "named hold (rc=$rc, out=$out)"
has "$out" "Run this against a board on 9.9.8, or verify 9.9.8 by hand and pass --force with --sha" && pass "named: the HOLD says to use a board on V, or --force with --sha" || bad "named HOLD sentence (out=$out)"
S="$(newsite)"; s98="$(awk '{print $1}' "$S/dist/kosmos-9.9.8-arm64.tar.gz.sha256")"
out="$(KOSMOS_PROMOTE_GATE_CMD="bash $HOLD" bash "$HERE/promote-channel.sh" "$S" 16999 --version 9.9.8 --sha "${s98:0:12}" --force 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(field "$S/dist/latest.json" version)" = 9.9.8 ] && pass "named: CONTROL --force (with --sha) after a hand check promotes past cannot-tell" || bad "named hold --force (rc=$rc, out=$out)"
has "$out" "run the check it could not on a board that runs 9.9.8: not the board the gate checked (:16999), which has moved on" && pass "named: after a forced cannot-tell it sends the check to a board on 9.9.8, not the moved one" || bad "named post-force advice (out=$out)"
refused "--force without --sha" "$(newsite)" "--version with --force needs --sha" --version 9.9.8 --force
# CONTROL: the default promote's post-force advice, with a port, names the port once (it used to print it twice).
S="$(newsite)"; out="$(KOSMOS_PROMOTE_GATE_CMD="bash $HOLD" bash "$HERE/promote-channel.sh" "$S" 16999 --force 2>&1)"; rc=$?
[ "$rc" = 0 ] && has "$out" "once the board the gate checked (:16999) reports 9.9.9, run the check it could not" && pass "default: CONTROL the post-force advice names the board's port once" || bad "default post-force advice (rc=$rc, out=$out)"
# A re-cut of V while the gates run replaces its bytes in dist/: refused before anything is written.
RECUT="$T/stub-recut-gate.sh"
printf '#!/usr/bin/env bash\nprintf "RE-CUT-BYTES\\n" > "$RECUT_SITE/dist/kosmos-9.9.8-arm64.tar.gz"; ( cd "$RECUT_SITE/dist" && shasum -a 256 kosmos-9.9.8-arm64.tar.gz > kosmos-9.9.8-arm64.tar.gz.sha256 )\nexit 0\n' > "$RECUT"; chmod +x "$RECUT"
S="$(newsite)"; out="$(RECUT_SITE="$S" KOSMOS_PROMOTE_GATE_CMD="bash $RECUT" bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 2>&1)"; rc=$?
[ "$rc" = 1 ] && untouched "$S" && has "$out" "is no longer the bytes checked above" && pass "named: V re-cut while the gates ran is refused, nothing written" || bad "named re-cut during gates (rc=$rc, latest.json: $(cat "$S/dist/latest.json"), out=$out)"

# ---- the agent-spawn gate on a board not shown to run V speaks for another build: cannot-tell, not a refusal ----
AFAIL="$T/stub-agent-fail.sh"; printf '#!/usr/bin/env bash\nexit 1\n' > "$AFAIL"; chmod +x "$AFAIL"
# (Without --force the experience gate's HOLD stops the promote before this gate runs; the --force path is where it matters.)
# The experience gate's own #5084 line when it READ the board on another version (the real script, pinned below).
HOLD_OTHER="$T/stub-hold-other.sh"; printf '#!/usr/bin/env bash\necho "cannot-tell: the board on :16180 runs 9.9.9, not 9.9.8: this check would test another release, not the one being promoted."\nexit 2\n' > "$HOLD_OTHER"; chmod +x "$HOLD_OTHER"
grep -qF 'say "cannot-tell: the board on :$PORT runs $BOARD_VERSION, not $KOSMOS_GATE_EXPECT_VERSION: this check would test another release' "$HERE/staging-experience-check.sh" \
  && pass "pin: the experience gate still prints the line the named promote reads" || bad "pin: staging-experience-check.sh no longer prints 'the board on :PORT runs W, not V'"
S="$(newsite)"; s98="$(awk '{print $1}' "$S/dist/kosmos-9.9.8-arm64.tar.gz.sha256")"
out="$(KOSMOS_PROMOTE_GATE_CMD="bash $HOLD_OTHER" KOSMOS_PROMOTE_AGENT_GATE_CMD="bash $AFAIL" bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 --sha "${s98:0:12}" --force 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(field "$S/dist/latest.json" version)" = 9.9.8 ] && has "$out" "on a board running 9.9.9, not 9.9.8, so it says nothing about 9.9.8" \
  && pass "named: an agent-spawn FAIL on a board READ as another version is cannot-tell, which a hand check of V can --force" || bad "named agent fail on another version (rc=$rc, out=$out)"
# PARTIAL (exit 3) is downgraded the same way on a board READ as another version, and stands on an unread one.
APART="$T/stub-agent-partial.sh"; printf '#!/usr/bin/env bash\nexit 3\n' > "$APART"; chmod +x "$APART"
S="$(newsite)"; out="$(KOSMOS_PROMOTE_GATE_CMD="bash $HOLD_OTHER" KOSMOS_PROMOTE_AGENT_GATE_CMD="bash $APART" bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 --sha "${s98:0:12}" --force 2>&1)"; rc=$?
[ "$rc" = 0 ] && has "$out" "answered 3 on a board running 9.9.9, not 9.9.8" && pass "named: an agent-spawn PARTIAL on a board READ as another version is cannot-tell too" || bad "named agent partial on another version (rc=$rc, out=$out)"
S="$(newsite)"; out="$(KOSMOS_PROMOTE_GATE_CMD="bash $HOLD" KOSMOS_PROMOTE_AGENT_GATE_CMD="bash $APART" bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 --sha "${s98:0:12}" --force 2>&1)"; rc=$?
[ "$rc" = 0 ] && has "$out" "agent-spawn gate PARTIAL (exit 3, Claude online / OpenAI-Codex arm failed) and --force was given" && ! has "$out" "says nothing about" && pass "named: CONTROL a PARTIAL on a board of unread version stands as PARTIAL" || bad "named agent partial unread (rc=$rc, out=$out)"
# A board whose version the gate could NOT read may be V itself: there an agent FAIL still refuses, as in default mode.
S="$(newsite)"; out="$(KOSMOS_PROMOTE_GATE_CMD="bash $HOLD" KOSMOS_PROMOTE_AGENT_GATE_CMD="bash $AFAIL" bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 --sha "${s98:0:12}" --force 2>&1)"; rc=$?
[ "$rc" = 1 ] && untouched "$S" && has "$out" "agent-spawn gate FAILED (exit 1)" && ! has "$out" "says nothing about" && pass "named: an agent FAIL on a board of unread version still refuses (it may be V)" || bad "named agent fail unread version (rc=$rc, out=$out)"
S="$(newsite)"; out="$(KOSMOS_PROMOTE_GATE_CMD="bash $HOLD" KOSMOS_PROMOTE_AGENT_GATE_CMD="bash $AFAIL" bash "$HERE/promote-channel.sh" "$S" --force 2>&1)"; rc=$?
[ "$rc" = 1 ] && untouched "$S" && has "$out" "agent-spawn gate FAILED (exit 1)" && pass "default: CONTROL the same agent FAIL still refuses the default promote" || bad "default agent fail (rc=$rc, out=$out)"
S="$(newsite)"; out="$(KOSMOS_PROMOTE_AGENT_GATE_CMD="bash $AFAIL" bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 2>&1)"; rc=$?
[ "$rc" = 1 ] && untouched "$S" && has "$out" "agent-spawn gate FAILED (exit 1)" && pass "named: CONTROL with the board shown to run V, an agent FAIL refuses" || bad "named agent fail on V's board (rc=$rc, out=$out)"

# ---- a version older than prod's is a rollback, and needs --allow-older ----
S="$(newsite)"; bash "$HERE/promote-channel.sh" "$S" >/dev/null 2>&1   # prod now serves 9.9.9
[ "$(field "$S/dist/latest.json" version)" = 9.9.9 ] && pass "rollback fixture: prod serves 9.9.9" || bad "rollback fixture: prod is $(cat "$S/dist/latest.json")"
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 2>&1)"; rc=$?
[ "$rc" = 1 ] && [ "$(field "$S/dist/latest.json" version)" = 9.9.9 ] && has "$out" "older than 9.9.9" && pass "named: an older version is refused without --allow-older, nothing written" || bad "named older (rc=$rc, out=$out)"
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 --allow-older 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(field "$S/dist/latest.json" version)" = 9.9.8 ] && has "$out" "rolling prod back" && pass "named: CONTROL --allow-older rolls prod back to it" || bad "named --allow-older (rc=$rc, out=$out)"
# 9.9.10 against 9.9.9 compares as numbers, not as text (as text 9.9.10 < 9.9.9).
S="$(newsite)"; bash "$HERE/promote-channel.sh" "$S" >/dev/null 2>&1
[ "$(field "$S/dist/latest.json" version)" = 9.9.9 ] && pass "numeric fixture: prod serves 9.9.9 before 9.9.10 is named" || bad "numeric fixture: prod is $(cat "$S/dist/latest.json")"
mkcut "$S" 9.9.10
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.10 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(field "$S/dist/latest.json" version)" = 9.9.10 ] && pass "named: CONTROL 9.9.10 is newer than 9.9.9 (compared by number)" || bad "named 9.9.10 vs 9.9.9 (rc=$rc, out=$out)"
out="$(bash "$HERE/promote-channel.sh" "$(newsite)" --allow-older 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "goes with --version" && pass "default: --allow-older alone is refused" || bad "--allow-older alone (rc=$rc, out=$out)"

# The baseline is origin's latest.json: a checkout behind origin (here it still names 1.0.0) does not hide a rollback.
O2="$T/origin2.git"; git init -q --bare "$O2"
S="$(newsite)"; git -C "$S" remote add origin "$O2"
echo '{"version":"9.9.9"}' > "$S/dist/latest.json"; git -C "$S" commit -qm "prod 9.9.9" -- dist/latest.json; git -C "$S" push -q origin HEAD:main
git -C "$S" reset -q --hard HEAD~1   # the checkout is now one commit behind origin, whose latest.json names 9.9.9
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "this checkout's dist/latest.json is not origin's" && [ "$(cat "$S/dist/latest.json")" = '{"version":"1.0.0"}' ] \
  && pass "named: a checkout whose latest.json is behind origin's is refused (one baseline for every prod read)" || bad "named behind-origin baseline (rc=$rc, out=$out)"
git -C "$S" reset -q --hard origin/main   # CONTROL: once the checkout is origin's, the guard reads 9.9.9 and sees the rollback
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "older than 9.9.9 (latest.json on the site's origin/main)" && pass "named: CONTROL in step with origin, the rollback guard reads origin's 9.9.9" || bad "named in-step baseline (rc=$rc, out=$out)"

# A prod pointer that is there but names no version cannot be compared either (only no pointer at all is a first promote).
S="$(newsite)"; echo '{}' > "$S/dist/latest.json"; git -C "$S" commit -qm empty -- dist/latest.json
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 2>&1)"; rc=$?
[ "$rc" = 1 ] && [ "$(cat "$S/dist/latest.json")" = '{}' ] && has "$out" "cannot be compared with '(no version)'" \
  && pass "named: a prod pointer that names no version refuses as cannot-compare, nothing written" || bad "named versionless prod (rc=$rc, out=$out)"

# A prod pointer whose version is not numbers cannot be compared: that counts as older, never as newer.
S="$(newsite)"; echo '{"version":"abc"}' > "$S/dist/latest.json"; git -C "$S" commit -qm odd -- dist/latest.json
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "9.9.8 cannot be compared with 'abc'" && ! has "$out" "older than" && pass "named: a prod version that is not numbers refuses, saying it cannot be compared (not that it is older)" || bad "named vs non-numeric prod (rc=$rc, out=$out)"
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 --allow-older 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(field "$S/dist/latest.json" version)" = 9.9.8 ] && pass "named: CONTROL --allow-older replaces a version that cannot be compared" || bad "named non-numeric --allow-older (rc=$rc, out=$out)"

# ---- only a published commit: with an origin, the named commit must be on origin/main ----
O="$T/origin.git"; git init -q --bare "$O"
S="$(newsite)"; git -C "$S" remote add origin "$O"; git -C "$S" push -q origin HEAD:main
mkcut "$S" 9.9.12   # committed here, never pushed
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.12 2>&1)"; rc=$?
[ "$rc" = 1 ] && untouched "$S" && has "$out" "not on the site's origin/main, so staging never served them" && pass "named: refuses a commit the site never published, nothing written" || bad "named unpublished (rc=$rc, out=$out)"
git -C "$S" push -q origin HEAD:main
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.12 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(field "$S/dist/latest.json" version)" = 9.9.12 ] && ! has "$out" "no origin remote" && pass "named: CONTROL once pushed, the same commit promotes" || bad "named published (rc=$rc, out=$out)"
S="$(newsite)"; git -C "$S" remote add origin "$T/no-such-origin.git"
# (The pointer-freeze guard fetches origin first and refuses on its own; offline, it lets this check be the one that answers.)
KOSMOS_POINTER_FREEZE_OFFLINE=1 refused "a site whose origin cannot be fetched" "$S" "could not fetch the site to check which commits naming 9.9.8 were published" --version 9.9.8
# A local, never-pushed re-cut of V with other bytes is not a candidate: the published one promotes, no disagreement.
O3="$T/origin3.git"; git init -q --bare "$O3"
S="$(newsite)"; git -C "$S" remote add origin "$O3"; git -C "$S" push -q origin HEAD:main
republish "$S" 9.9.8 "" "$(printf '%064d' 5)"   # committed here only
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(field "$S/dist/latest.json" sha256)" = "$(awk '{print $1}' "$S/dist/kosmos-9.9.8-arm64.tar.gz.sha256")" ] && ! has "$out" "disagree" \
  && pass "named: a never-pushed commit naming V with other bytes is ignored, not a disagreement" || bad "named unpushed re-cut (rc=$rc, out=$out)"
has "$out" "NOTE ignoring commits naming 9.9.8 that are not on the site's origin/main" && pass "named: ...and says it ignored it" || bad "named unpushed NOTE (out=$out)"
# With an unpublished commit naming V present, a --sha that matches nothing still points at the --sha, not at it.
S="$(newsite)"; O4="$T/origin4.git"; git init -q --bare "$O4"; git -C "$S" remote add origin "$O4"; git -C "$S" push -q origin HEAD:main
republish "$S" 9.9.8 "" "$(printf '%064d' 6)"
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 --sha deadbeef 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "(Check the version, and the --sha or --commit given.)" && ! has "$out" "never served them" && pass "named: a --sha matching nothing is blamed, not an unrelated unpublished commit" || bad "named --sha with unpublished (rc=$rc, out=$out)"
# Prod already serving V as other bytes: a replacement, allowed and said.
S="$(newsite)"; printf '{"version":"9.9.8","sha256":"%064d"}\n' 3 > "$S/dist/latest.json"; git -C "$S" commit -qm "prod 9.9.8 as other bytes" -- dist/latest.json
out="$(bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 2>&1)"; rc=$?
[ "$rc" = 0 ] && has "$out" "prod already serves 9.9.8 as other bytes (sha256 000000000000)" && pass "named: replacing prod's own version with other bytes is allowed and said" || bad "named same-version replacement (rc=$rc, out=$out)"
has "$(bash "$HERE/promote-channel.sh" "$(newsite)" --version 9.9.8 2>&1)" "prod already serves" && bad "named: the replacement NOTE fired on an upgrade" || pass "named: CONTROL no replacement NOTE on an ordinary upgrade"
has "$(bash "$HERE/promote-channel.sh" "$(newsite)" --version 9.9.8 2>&1)" "has no origin remote" && pass "named: a site with no origin says it cannot check publication" || bad "named no-origin note missing"

# ---- the first Kosmos+ sign-in gate is handed the named pointer, not the live staging one ----
PLUS="$T/stub-plus-gate.sh"; printf '#!/usr/bin/env bash\ngrep -o "\\"version\\":\\"[^\\"]*\\"" "$1" > "%s"\nexit 0\n' "$T/plus.log" > "$PLUS"; chmod +x "$PLUS"
S="$(newsite)"; out="$(KOSMOS_PROMOTE_PLUS_GATE_CMD="bash $PLUS" bash "$HERE/promote-channel.sh" "$S" --version 9.9.8 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$T/plus.log")" = '"version":"9.9.8"' ] && pass "named: the Kosmos+ gate reads the named pointer (9.9.8), not staging's 9.9.9" || bad "named plus gate (rc=$rc, saw '$(cat "$T/plus.log" 2>/dev/null)', out=$out)"
S="$(newsite)"; out="$(KOSMOS_PROMOTE_PLUS_GATE_CMD="bash $PLUS" bash "$HERE/promote-channel.sh" "$S" 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$T/plus.log")" = '"version":"9.9.9"' ] && pass "default: CONTROL the Kosmos+ gate reads staging's 9.9.9" || bad "default plus gate (rc=$rc, saw '$(cat "$T/plus.log" 2>/dev/null)')"

# ---- the port the usage line advertises reaches the gate in named mode ----
PGATE="$T/stub-port-gate.sh"; printf '#!/usr/bin/env bash\nprintf "%%s %%s\\n" "$KOSMOS_GATE_EXPECT_VERSION" "$1" > "%s"\nexit 0\n' "$T/port.log" > "$PGATE"; chmod +x "$PGATE"
S="$(newsite)"; out="$(KOSMOS_PROMOTE_GATE_CMD="bash $PGATE" bash "$HERE/promote-channel.sh" "$S" 16999 --version 9.9.8 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$T/port.log")" = "9.9.8 16999" ] && pass "named: <site> <port> --version: the gate gets the port and expects V" || bad "named with a port (rc=$rc, gate saw '$(cat "$T/port.log" 2>/dev/null)', out=$out)"

echo ""
if [ "$fail" = 0 ]; then echo "test-promote-named-7005: ALL PASS"; else echo "test-promote-named-7005: FAILURES above"; exit 1; fi
