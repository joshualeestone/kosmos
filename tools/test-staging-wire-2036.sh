#!/usr/bin/env bash
# test-staging-wire-2036.sh -- kosmos#2036, the SHELL side of wiring the staging channel
# into the cut. Covers the channel selectors (release.sh, setup.sh) and the abort-time
# cleanup of an uncommitted staging pointer (release_site_restore). The update.js consume
# selector is proven in engine/update.test.js; the pointer/promote tools in
# test-staging-channel-2036.sh. Every arm asserts a POSTCONDITION and the default-PROD path
# is proven UNCHANGED (the safety property the whole card rests on).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
PASS=0; FAIL=0
ok(){ echo "PASS  $1"; PASS=$((PASS+1)); }
no(){ echo "FAIL  $1"; FAIL=$((FAIL+1)); }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

# --- release.sh: the channel -> pointer-file case block, extracted and evaluated ----------
# (Unit-testing the mapping without running a whole cut. The block is the source of truth for
#  which pointer a cut writes.)
channel_pointer() {  # $1 = KOSMOS_CUT_CHANNEL value ('' = unset)
  local KOSMOS_CUT_CHANNEL="$1" CUT_CHANNEL POINTER_FILE
  CUT_CHANNEL="${KOSMOS_CUT_CHANNEL:-prod}"
  case "$CUT_CHANNEL" in
    staging) POINTER_FILE="latest-staging.json" ;;
    prod)    POINTER_FILE="latest.json" ;;
    *) echo "REFUSE"; return 1 ;;
  esac
  echo "$POINTER_FILE"
}
[ "$(channel_pointer '')" = latest.json ] && ok "release channel: DEFAULT is prod -> latest.json (prod path unchanged)" || no "release channel: default is not latest.json"
[ "$(channel_pointer prod)" = latest.json ] && ok "release channel: prod -> latest.json" || no "release channel: prod wrong"
[ "$(channel_pointer staging)" = latest-staging.json ] && ok "release channel: staging -> latest-staging.json" || no "release channel: staging wrong"
out="$(channel_pointer bogus 2>&1)"; [ "$out" = REFUSE ] && ok "release channel: an invalid channel refuses" || no "release channel: invalid not refused ($out)"
# Guard the extracted copy against drift from the real release.sh.
grep -q 'CUT_CHANNEL="${KOSMOS_CUT_CHANNEL:-prod}"' "$REPO/tools/release.sh" && ok "release channel: release.sh still defaults to prod (extract matches source)" || no "release channel: release.sh default drifted from this test's copy"

# --- setup.sh: the _PTR_FILE selector, extracted and evaluated ----------------------------
ptr_file() {  # $1 = KOSMOS_UPDATE_CHANNEL value ('' = unset)
  local KOSMOS_UPDATE_CHANNEL="$1" _PTR_FILE="latest.json"
  [ "${KOSMOS_UPDATE_CHANNEL:-}" = staging ] && _PTR_FILE="latest-staging.json"
  echo "$_PTR_FILE"
}
[ "$(ptr_file '')" = latest.json ] && ok "setup channel: DEFAULT is latest.json (a bare curl|sh install is unchanged)" || no "setup channel: default wrong"
[ "$(ptr_file staging)" = latest-staging.json ] && ok "setup channel: staging -> latest-staging.json" || no "setup channel: staging wrong"
[ "$(ptr_file whatever)" = latest.json ] && ok "setup channel: a non-staging value is prod" || no "setup channel: non-staging wrong"
grep -q '\[ "${KOSMOS_UPDATE_CHANNEL:-}" = staging \] && _PTR_FILE="latest-staging.json"' "$REPO/install/setup.sh" && ok "setup channel: setup.sh carries the selector (extract matches source)" || no "setup channel: setup.sh selector drifted"

# --- release_site_restore: abort-time cleanup of the staging pointer ----------------------
. "$REPO/tools/lib/release-freeze.sh"
mk_site() {  # a throwaway git site with a committed dist/ baseline
  local d="$1"; rm -rf "$d"; mkdir -p "$d/dist"
  git -C "$d" init -q; git -C "$d" config user.email t@t; git -C "$d" config user.name t
  printf '{"version":"0.0.1"}\n' > "$d/dist/latest.json"
  git -C "$d" add -A; git -C "$d" commit -q -m base
}

# (a) staging cut created an UNTRACKED latest-staging.json, then aborted (staging_ptr_had=0):
#     it must be REMOVED (it was never committed, never served).
S="$T/a"; mk_site "$S"
printf '{"version":"9.9.9"}\n' > "$S/dist/latest-staging.json"   # this cut created it, untracked
release_site_restore "$S" "9.9.9" 0 1 "" 0 >/dev/null 2>&1
[ ! -f "$S/dist/latest-staging.json" ] && ok "restore: an untracked staging pointer this cut created is removed on abort" || no "restore: untracked staging pointer lingered"
[ -f "$S/dist/latest.json" ] && ok "restore: prod latest.json is left intact" || no "restore: prod latest.json was touched"

# (b) staging cut CHANGED a TRACKED latest-staging.json, then aborted: it must be RESTORED
#     to the committed value (prior staging pointer), not left at the new version.
S="$T/b"; mk_site "$S"
printf '{"version":"0.0.1"}\n' > "$S/dist/latest-staging.json"; git -C "$S" add -A; git -C "$S" commit -q -m "staging base"
printf '{"version":"9.9.9"}\n' > "$S/dist/latest-staging.json"   # this cut advanced it
release_site_restore "$S" "9.9.9" 0 1 "" 0 >/dev/null 2>&1
grep -q '0.0.1' "$S/dist/latest-staging.json" && ok "restore: a tracked staging pointer is checked back to its committed value" || no "restore: tracked staging pointer not restored"

# (c) a PROD cut (staging_ptr_had defaults to 1) must NOT touch a pre-existing untracked
#     latest-staging.json -- it is not this cut's to remove.
S="$T/c"; mk_site "$S"
printf '{"version":"5.5.5"}\n' > "$S/dist/latest-staging.json"   # somebody else's, pre-existing
release_site_restore "$S" "9.9.9" 0 1 ""   >/dev/null 2>&1        # 5-arg (pre-#2036) caller: staging_ptr_had defaults 1
[ -f "$S/dist/latest-staging.json" ] && ok "restore: a 5-arg (prod/legacy) caller leaves latest-staging.json untouched" || no "restore: legacy caller removed a staging pointer it should not"

echo "----"
echo "test-staging-wire-2036: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
