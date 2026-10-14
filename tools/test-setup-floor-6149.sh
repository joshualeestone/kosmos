#!/usr/bin/env bash
# test-setup-floor-6149.sh - kosmos#6149 point 1: no Mac pointer (so no /setup or /setup-staging) may name a build
# older than the setup floor (0.7.45), once 0.7.49 (#4455, the read-only app) is out. The library, then the real
# promote and publish scripts against a temp site (each refused below the floor with nothing written; a control at
# 0.7.49 gets past the floor). deploy-site.sh's call is pinned by its own line below (it needs live hosts to run).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
unset KOSMOS_SETUP_FLOOR   # the real floor, whatever the caller exported
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
out="$(KOSMOS_SETUP_FLOOR=0.0.0 bash -c '. "$1"; kosmos_setup_floor_ok t 0.6.30' _ "$HERE/lib/setup-floor.sh" 2>&1)"; rc=$?
[ "$rc" = 0 ] && pass "a lowered floor (test fixtures) lets 0.6.30 through" || bad "lowered floor still refused 0.6.30"
case "$out" in *"LOWERED"*) pass "a lowered floor says so";; *) bad "a lowered floor was silent: $out";; esac

# promote-channel.sh (mac): a staging pointer below the floor is refused, and prod's latest.json is untouched.
site() { rm -rf "$T/site"; mkdir -p "$T/site/dist"; printf '%s' '{"version":"0.7.40","sha256":"aa"}' > "$T/site/dist/latest.json"; }
site; printf '%s' '{"version":"0.7.44","sha256":"bb","artifact":"kosmos-0.7.44-arm64.tar.gz"}' > "$T/site/dist/latest-staging.json"
before="$(cat "$T/site/dist/latest.json")"
out="$(bash "$HERE/promote-channel.sh" "$T/site" 2>&1)"; rc=$?
[ "$rc" != 0 ] && pass "promote-channel refuses 0.7.44 (rc $rc)" || bad "promote-channel accepted 0.7.44"
case "$out" in *"setup floor"*) pass "promote-channel's refusal is the floor's";; *) bad "promote-channel refused for another reason: $out";; esac
[ "$(cat "$T/site/dist/latest.json")" = "$before" ] && pass "prod's latest.json is untouched" || bad "latest.json changed"
# CONTROL: 0.7.49 gets past the floor (it may stop later for its own reasons, never the floor's).
site; printf '%s' '{"version":"0.7.49","sha256":"bb","artifact":"kosmos-0.7.49-arm64.tar.gz"}' > "$T/site/dist/latest-staging.json"
out="$(bash "$HERE/promote-channel.sh" "$T/site" 2>&1)"
case "$out" in *"setup floor"*) bad "CONTROL: promote-channel's floor refused 0.7.49: $out";; *) pass "CONTROL: promote-channel's floor lets 0.7.49 by";; esac

# publish-staging-pointer.sh: refused below the floor before any write.
site; out="$(bash "$HERE/publish-staging-pointer.sh" "$T/site" 0.7.44 2>&1)"; rc=$?
[ "$rc" != 0 ] && pass "publish-staging refuses 0.7.44 (rc $rc)" || bad "publish-staging accepted 0.7.44"
case "$out" in *"setup floor"*) pass "publish-staging's refusal is the floor's";; *) bad "publish-staging refused for another reason: $out";; esac
[ ! -e "$T/site/dist/latest-staging.json" ] && pass "no staging pointer was written" || bad "a staging pointer was written"
site; out="$(bash "$HERE/publish-staging-pointer.sh" "$T/site" 0.7.49 2>&1)"
case "$out" in *"setup floor"*) bad "CONTROL: publish-staging's floor refused 0.7.49: $out";; *) pass "CONTROL: publish-staging's floor lets 0.7.49 by";; esac

# deploy-site.sh: both committed Mac pointers go through the floor before anything is served.
n="$(grep -c 'kosmos_setup_floor_ok "the committed dist/latest' "$HERE/deploy-site.sh")"
[ "$n" = 2 ] && pass "deploy-site checks both committed Mac pointers" || bad "deploy-site floor calls: $n (want 2)"

[ "$fail" = 0 ] && echo "setup-floor: all arms passed" || { echo "setup-floor: FAILED"; exit 1; }
