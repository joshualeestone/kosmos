#!/usr/bin/env bash
# test-setup-floor-6149.sh - kosmos#6149 point 1: no Mac pointer (so no /setup or /setup-staging) may name a build
# older than the setup floor (0.7.45), once 0.7.49 (#4455, the read-only app) is out. The library, then the real
# promote and publish scripts against a temp site (each refused below the floor with nothing written; a control at
# 0.7.49 gets past the floor), and the tree check a deploy runs on its export. deploy-site.sh itself is run for real
# by tools/test-deploy-site-promote.sh (its kosmos#6149 arms).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
unset KOSMOS_SETUP_FLOOR_TEST KOSMOS_SETUP_FLOOR_LOWER   # the real floor, whatever the caller exported
T="$(mktemp -d "${TMPDIR:-/tmp}/setup-floor-test.XXXXXXXX")"
trap 'rm -rf "$T"' EXIT
fail=0
pass() { printf 'PASS  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fail=1; }

. "$HERE/lib/setup-floor.sh"
for v in 0.7.45 0.7.49 0.7.100 0.8.0 1.0.0 0.7.45.1; do
  if kosmos_setup_floor_ok t "$v" 2>/dev/null; then pass "$v is at or above the floor"; else bad "$v was refused"; fi
done
for v in 0.7.44 0.7.4 0.6.99 0.0.1 0.7; do
  if kosmos_setup_floor_ok t "$v" 2>/dev/null; then bad "$v passed the floor"; else pass "$v is refused"; fi
done
for v in "" 0.7.49-rc1 v0.7.49 0.7..49 .7.49 0.7.49. garbage; do
  if kosmos_setup_floor_ok t "$v" 2>/dev/null; then bad "unreadable '$v' passed"; else pass "unreadable '$v' is refused"; fi
done
out="$(kosmos_setup_floor_ok "the staging pointer" 0.7.44 2>&1)"
case "$out" in *"0.7.44, older than 0.7.45"*) pass "the refusal names the version and the floor";; *) bad "refusal text: $out";; esac
lowered() { env "$@" bash -c '. "$1"; kosmos_setup_floor_ok t 0.6.30' _ "$HERE/lib/setup-floor.sh" 2>&1; }
out="$(lowered KOSMOS_SETUP_FLOOR_TEST=1 KOSMOS_SETUP_FLOOR_LOWER=0.0.0)"; rc=$?
[ "$rc" = 0 ] && pass "a lowered floor (both test variables) lets 0.6.30 through" || bad "lowered floor still refused 0.6.30"
case "$out" in *"LOWERED"*) pass "a lowered floor says so";; *) bad "a lowered floor was silent: $out";; esac
lowered KOSMOS_SETUP_FLOOR_LOWER=0.0.0 >/dev/null && bad "LOWER alone lowered the floor" || pass "KOSMOS_SETUP_FLOOR_LOWER alone keeps the real floor"
lowered KOSMOS_SETUP_FLOOR_TEST=1 >/dev/null && bad "TEST alone lowered the floor" || pass "KOSMOS_SETUP_FLOOR_TEST alone keeps the real floor"
lowered KOSMOS_SETUP_FLOOR_TEST=1 KOSMOS_SETUP_FLOOR_LOWER=abc >/dev/null && bad "a non-numeric LOWER lowered the floor" || pass "a non-numeric KOSMOS_SETUP_FLOOR_LOWER keeps the real floor"
out="$(KOSMOS_SETUP_FLOOR_TEST=1 KOSMOS_SETUP_FLOOR_LOWER=9.9.9 bash -c '. "$1"; echo "$KOSMOS_SETUP_FLOOR"' _ "$HERE/lib/setup-floor.sh")"
[ "$out" = 0.7.45 ] && pass "a LOWER at or above the real floor is ignored (it only ever lowers)" || bad "LOWER=9.9.9 set the floor to '$out'"

# The pointer check: the artifact name's version must be the pointer's, and both above the floor.
ptr() { printf '{"version":"%s","sha256":"bb","artifact":"%s"}' "$1" "$2"; }
kosmos_setup_floor_pointer_ok t "$(ptr 0.7.49 kosmos-0.7.49-arm64.tar.gz)" 2>/dev/null && pass "a 0.7.49 pointer naming its own tarball passes" || bad "a matching 0.7.49 pointer was refused"
kosmos_setup_floor_pointer_ok t "$(ptr 0.7.49 kosmos-0.7.40-arm64.tar.gz)" 2>/dev/null && bad "a 0.7.49 pointer naming a 0.7.40 tarball passed" || pass "a pointer whose tarball is older than its version is refused"
kosmos_setup_floor_pointer_ok t "$(ptr 0.7.44 kosmos-0.7.44-arm64.tar.gz)" 2>/dev/null && bad "a 0.7.44 pointer passed" || pass "a 0.7.44 pointer is refused"
kosmos_setup_floor_pointer_ok t '{"sha256":"bb"}' 2>/dev/null && bad "a pointer with no version passed" || pass "a pointer with no version is refused"
kosmos_setup_floor_pointer_ok t '{"version":"0.7.49","sha256":"bb"}' 2>/dev/null && bad "a pointer with no artifact passed" || pass "a pointer with no artifact is refused (fail closed)"
dup='{"version":"0.6.1","artifact":"kosmos-0.6.1-arm64.tar.gz","version":"0.7.49","artifact":"kosmos-0.7.49-arm64.tar.gz","sha256":"bb"}'
kosmos_setup_floor_pointer_ok t "$dup" 2>/dev/null && bad "a pointer with doubled keys passed" || pass "a pointer naming version and artifact twice is refused (readers of a doubled key disagree)"
for art in kosmos-arm64.tar.gz kosmos-0.7.49.tar.gz kosmos-0.7.49-.tar.gz not-a-build.zip; do
  kosmos_setup_floor_pointer_ok t "$(ptr 0.7.49 "$art")" 2>/dev/null && bad "artifact $art passed" || pass "a 0.7.49 pointer naming $art is refused (fail closed)"
done

# The tree a deploy publishes: pointers through the pointer check, installers must know the read-only app.
tree() { rm -rf "$T/tree"; mkdir -p "$T/tree/dist"; ptr 0.7.49 kosmos-0.7.49-arm64.tar.gz > "$T/tree/dist/latest.json"
  ptr 0.7.49 kosmos-0.7.49-arm64.tar.gz > "$T/tree/dist/latest-staging.json"
  printf 'x KOSMOS_READONLY_APP y\n' > "$T/tree/setup"; printf 'x KOSMOS_READONLY_APP y\n' > "$T/tree/setup-staging"; }
tree; kosmos_setup_floor_tree_ok t "$T/tree" 2>/dev/null && pass "CONTROL: a current tree passes" || bad "a current tree was refused"
tree; printf 'an old installer\n' > "$T/tree/setup"
kosmos_setup_floor_tree_ok t "$T/tree" 2>/dev/null && bad "an old /setup passed" || pass "a /setup that does not know the read-only app is refused"
tree; printf 'an old installer\n' > "$T/tree/setup-staging"
kosmos_setup_floor_tree_ok t "$T/tree" 2>/dev/null && bad "an old /setup-staging passed" || pass "a /setup-staging that does not know the read-only app is refused"
tree; ptr 0.7.44 kosmos-0.7.44-arm64.tar.gz > "$T/tree/dist/latest-staging.json"
kosmos_setup_floor_tree_ok t "$T/tree" 2>/dev/null && bad "a 0.7.44 staging pointer in the tree passed" || pass "a staging pointer below the floor in the tree is refused"
tree; rm -f "$T/tree/setup-staging" "$T/tree/dist/latest-staging.json"
kosmos_setup_floor_tree_ok t "$T/tree" 2>/dev/null && pass "a tree without the staging pair passes (nothing to check)" || bad "a tree without staging files was refused"

# promote-channel.sh (mac): a staging pointer below the floor is refused, and prod's latest.json is untouched.
site() { rm -rf "$T/site"; mkdir -p "$T/site/dist"; printf '%s' '{"version":"0.7.40","sha256":"aa"}' > "$T/site/dist/latest.json"; }
site; printf '%s' '{"version":"0.7.44","sha256":"bb","artifact":"kosmos-0.7.44-arm64.tar.gz"}' > "$T/site/dist/latest-staging.json"
before="$(cd "$T/site/dist" && ls -la && cat ./*)"
out="$(bash "$HERE/promote-channel.sh" "$T/site" 2>&1)"; rc=$?
[ "$rc" != 0 ] && pass "promote-channel refuses 0.7.44 (rc $rc)" || bad "promote-channel accepted 0.7.44"
case "$out" in *"setup floor"*) pass "promote-channel's refusal is the floor's";; *) bad "promote-channel refused for another reason: $out";; esac
[ "$(cd "$T/site/dist" && ls -la && cat ./*)" = "$before" ] && pass "nothing in dist/ changed (files and bytes)" || bad "dist/ changed"
# CONTROL: 0.7.49 gets past the floor (it may stop later for its own reasons, never the floor's).
site; printf '%s' '{"version":"0.7.49","sha256":"bb","artifact":"kosmos-0.7.49-arm64.tar.gz"}' > "$T/site/dist/latest-staging.json"
out="$(bash "$HERE/promote-channel.sh" "$T/site" 2>&1)"
case "$out" in *"setup floor"*) bad "CONTROL: promote-channel's floor refused 0.7.49: $out";;
  *"refusing to promote a missing artifact"*) pass "CONTROL: promote-channel gets past the floor to its next check (the missing artifact)";;
  *) bad "CONTROL: promote-channel stopped somewhere unexpected: $out";; esac

# promote-channel.sh checks the snapshot's own bytes: a doubled key is refused (JSON.parse would keep the last).
site; printf '%s' "$dup" > "$T/site/dist/latest-staging.json"
out="$(bash "$HERE/promote-channel.sh" "$T/site" 2>&1)"
case "$out" in *"names version or artifact more than once"*) pass "promote refuses a staging pointer with doubled keys";; *) bad "promote and doubled keys: $out";; esac

# promote-channel.sh: setup-staging, about to become /setup, must know the read-only app (checked before any write).
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
site; git init -q "$T/site"; printf 'an installer from before 0.7.45\n' > "$T/site/setup-staging"
( cd "$T/site" && shasum -a 256 setup-staging > setup-staging.sha256 )
sg="$(shasum -a 256 < "$T/site/setup-staging" | awk '{print $1}')"
printf 'a build\n' > "$T/site/dist/kosmos-0.7.49-arm64.tar.gz"   # promote's artifact checks come first
( cd "$T/site/dist" && shasum -a 256 kosmos-0.7.49-arm64.tar.gz > kosmos-0.7.49-arm64.tar.gz.sha256 )
asha="$(shasum -a 256 < "$T/site/dist/kosmos-0.7.49-arm64.tar.gz" | awk '{print $1}')"
printf '{"version":"0.7.49","sha256":"%s","artifact":"kosmos-0.7.49-arm64.tar.gz","setup_sha256":"%s"}' "$asha" "$sg" > "$T/site/dist/latest-staging.json"
git -C "$T/site" add -A && git -C "$T/site" commit -q -m site
before="$(cd "$T/site/dist" && ls -la && cat ./*)"
out="$(bash "$HERE/promote-channel.sh" "$T/site" 2>&1)"; rc=$?
case "$out" in *"setup-staging (about to become /setup) does not know KOSMOS_READONLY_APP"*) pass "promote refuses an old setup-staging before it becomes /setup (rc $rc)";; *) bad "promote and an old setup-staging: $out";; esac
[ "$(cd "$T/site/dist" && ls -la && cat ./*)" = "$before" ] && [ ! -e "$T/site/setup" ] && pass "that refusal wrote nothing" || bad "that refusal wrote something"
rm -rf "$T/site/.git"
# ...and with no installer named, prod keeps its /setup beside the promoted pointer: an old one is refused too.
site; printf 'an installer from before 0.7.45\n' > "$T/site/setup"
printf 'a build\n' > "$T/site/dist/kosmos-0.7.49-arm64.tar.gz"
( cd "$T/site/dist" && shasum -a 256 kosmos-0.7.49-arm64.tar.gz > kosmos-0.7.49-arm64.tar.gz.sha256 )
asha="$(shasum -a 256 < "$T/site/dist/kosmos-0.7.49-arm64.tar.gz" | awk '{print $1}')"
printf '{"version":"0.7.49","sha256":"%s","artifact":"kosmos-0.7.49-arm64.tar.gz"}' "$asha" > "$T/site/dist/latest-staging.json"
before="$(cd "$T/site/dist" && ls -la && cat ./*)"
out="$(bash "$HERE/promote-channel.sh" "$T/site" 2>&1)"
case "$out" in *"the /setup prod keeps serving does not know KOSMOS_READONLY_APP"*) pass "promote refuses an old /setup that prod would keep beside the new pointer";; *) bad "promote and a kept old /setup: $out";; esac
[ "$(cd "$T/site/dist" && ls -la && cat ./*)" = "$before" ] && pass "that refusal wrote nothing" || bad "that refusal wrote something"

# publish-staging-pointer.sh: refused below the floor before any write.
site; out="$(bash "$HERE/publish-staging-pointer.sh" "$T/site" 0.7.44 2>&1)"; rc=$?
[ "$rc" != 0 ] && pass "publish-staging refuses 0.7.44 (rc $rc)" || bad "publish-staging accepted 0.7.44"
case "$out" in *"setup floor"*) pass "publish-staging's refusal is the floor's";; *) bad "publish-staging refused for another reason: $out";; esac
[ ! -e "$T/site/dist/latest-staging.json" ] && pass "no staging pointer was written" || bad "a staging pointer was written"
site; out="$(bash "$HERE/publish-staging-pointer.sh" "$T/site" 0.7.49 2>&1)"
case "$out" in *"setup floor"*) bad "CONTROL: publish-staging's floor refused 0.7.49: $out";;
  *"does not exist - nothing to point at"*) pass "CONTROL: publish-staging gets past the floor to its next check (the missing tarball)";;
  *) bad "CONTROL: publish-staging stopped somewhere unexpected: $out";; esac

# Each publisher checks its export BEFORE its own vercel deploy: the first tree check sits above the first deploy line.
# (release.sh's cannot run in the suite; this is the arm that fails if it is moved below the deploy or deleted.)
for f in release.sh deploy-site.sh; do
  chk="$(grep -n 'kosmos_setup_floor_tree_ok "' "$HERE/$f" | head -1 | cut -d: -f1)"
  dep="$(grep -n 'vercel deploy --prod --yes' "$HERE/$f" | grep -v '^[0-9]*:[[:space:]]*#' | head -1 | cut -d: -f1)"
  if [ -n "$chk" ] && [ -n "$dep" ] && [ "$chk" -lt "$dep" ]; then pass "$f checks its export (line $chk) before its vercel deploy (line $dep)"
  else bad "$f: tree check line '${chk:-none}', deploy line '${dep:-none}'"; fi
done
# release.sh step 1a-floor's check: the pair a cut re-publishes UNTOUCHED, by channel.
site; printf 'old\n' > "$T/site/setup"; ptr 0.7.47 kosmos-0.7.47-arm64.tar.gz > "$T/site/dist/latest.json"
printf 'x KOSMOS_READONLY_APP\n' > "$T/site/setup-staging"; ptr 0.7.49 kosmos-0.7.49-arm64.tar.gz > "$T/site/dist/latest-staging.json"
kosmos_setup_floor_site_untouched_ok t "$T/site" staging 2>/dev/null && bad "a staging cut passed an old /setup it re-publishes" || pass "a staging cut refuses the old /setup it re-publishes untouched"
kosmos_setup_floor_site_untouched_ok t "$T/site" prod 2>/dev/null && pass "a prod cut, which REPLACES /setup, is not refused by it (the remedy)" || bad "a prod cut was refused by the /setup it replaces"
printf 'old\n' > "$T/site/setup-staging"
kosmos_setup_floor_site_untouched_ok t "$T/site" prod 2>/dev/null && bad "a prod cut passed an old /setup-staging it re-publishes" || pass "a prod cut refuses the old /setup-staging it re-publishes untouched"
kosmos_setup_floor_site_untouched_ok t "$T/site" nightly 2>/dev/null && bad "an unknown channel passed" || pass "an unknown channel is refused"
n="$(grep -c 'kosmos_setup_floor_site_untouched_ok "the site checkout" "\$SITE" "\$CUT_CHANNEL"' "$HERE/release.sh")"
[ "$n" = 1 ] && pass "release.sh runs it on its channel at step 1a-floor" || bad "release.sh 1a-floor calls: $n"
grep -q 'must never reach a cut -- refusing' "$HERE/release.sh" && pass "release.sh refuses the test knob in a cut" || bad "release.sh does not refuse the test knob"
i1="$(grep -n 'kosmos_setup_floor_installer_ok "this cut.s install/setup.sh"' "$HERE/release.sh" | head -1 | cut -d: -f1)"
s2="$(grep -n '^step "== 2\. ' "$HERE/release.sh" | head -1 | cut -d: -f1)"
{ [ -n "$i1" ] && [ -n "$s2" ] && [ "$i1" -lt "$s2" ]; } && pass "release.sh checks the cut's own installer (line $i1) before step 2" || bad "release.sh own-installer check line '${i1:-none}'"
grep -q KOSMOS_READONLY_APP "$HERE/../install/setup.sh" && pass "CONTROL: today's install/setup.sh passes that check" || bad "today's install/setup.sh lacks the marker"
a1="$(grep -n 'kosmos_setup_floor_ok "this \$CUT_CHANNEL cut" "\$V"' "$HERE/release.sh" | head -1 | cut -d: -f1)"
b2="$(grep -n '^step "== 2\. ' "$HERE/release.sh" | head -1 | cut -d: -f1)"
{ [ -n "$a1" ] && [ -n "$b2" ] && [ "$a1" -lt "$b2" ]; } && pass "release.sh checks the cut's own version (line $a1) before step 2 (line $b2), well before the build" || bad "release.sh own-version check line '${a1:-none}', step 2 line '${b2:-none}'"

# deploy-site.sh is run for real by tools/test-deploy-site-promote.sh (its kosmos#6149 arms: the real floor refuses
# a committed pointer below it with nothing deployed, and a pointer whose tarball is older than its version).

[ "$fail" = 0 ] && echo "setup-floor: all arms passed" || { echo "setup-floor: FAILED"; exit 1; }
