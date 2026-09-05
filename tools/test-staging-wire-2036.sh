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

# --- verify-served.sh: honors KOSMOS_VERIFY_POINTER (default prod) -------------------------
# The step-9 integration: release.sh passes KOSMOS_VERIFY_POINTER=$POINTER_FILE, and
# verify-served.sh MUST read it. (This guards the exact gap where release.sh set the var but
# verify-served.sh hardcoded latest.json -- a staging cut could then never pass step 9.)
verify_pointer() {  # $1 = KOSMOS_VERIFY_POINTER value ('' = unset)
  local KOSMOS_VERIFY_POINTER="$1" POINTER
  POINTER="${KOSMOS_VERIFY_POINTER:-latest.json}"
  echo "$POINTER"
}
[ "$(verify_pointer '')" = latest.json ] && ok "verify-served pointer: DEFAULT is latest.json (prod checks unchanged)" || no "verify-served pointer: default wrong"
[ "$(verify_pointer latest-staging.json)" = latest-staging.json ] && ok "verify-served pointer: honors the staging pointer" || no "verify-served pointer: override ignored"
grep -q 'POINTER="${KOSMOS_VERIFY_POINTER:-latest.json}"' "$REPO/tools/verify-served.sh" && ok "verify-served pointer: verify-served.sh READS KOSMOS_VERIFY_POINTER" || no "verify-served pointer: verify-served.sh does not read the var (step-9 staging verify broken)"
grep -q 'curl -fsS -H .Cache-Control: no-cache. "\$HOST/dist/\$POINTER"' "$REPO/tools/verify-served.sh" && ok "verify-served pointer: the polled fetch USES \$POINTER" || no "verify-served pointer: the fetch does not use \$POINTER"
grep -q 'KOSMOS_VERIFY_POINTER=' "$REPO/tools/release.sh" && ok "verify-served pointer: release.sh passes KOSMOS_VERIFY_POINTER to the step-9 check" || no "verify-served pointer: release.sh no longer passes the var"

# --- the prod alias (kosmos-arm64.tar.gz) is a PROD concept ------------------------------
# A staging cut must NOT overwrite the shared unversioned alias (it is prod-reachable); the
# alias moves only on a prod cut or a promote. (The behavioral promote-refresh is asserted in
# test-staging-channel-2036.sh; here we guard the release.sh gate + the promote refresh exist.)
grep -q 'staging cut: prod alias kosmos-arm64.tar.gz left untouched' "$REPO/tools/release.sh" \
  && ok "prod alias: a staging cut leaves the prod alias untouched (release.sh gates it on a prod cut)" \
  || no "prod alias: release.sh does not gate the alias publish -- a staging cut would leak staging bytes into the prod alias"
grep -q 'refresh the unversioned prod alias' "$REPO/tools/promote-channel.sh" \
  && ok "prod alias: promote-channel.sh refreshes the alias to the promoted bytes" \
  || no "prod alias: promote-channel.sh does not refresh the alias (it would go stale after a promote)"

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

# --- step 6 ("what we are about to publish says $V") must read the VERSIONED artifact, not the
#     unversioned alias. On a staging cut the alias is left at the prior PROD version (#2036), so
#     reading it makes step 6 refuse a correct staging build (the #2036 step-6 gap, found by a full
#     staging cut). It must read kosmos-$V-arm64.tar.gz, which carries $V's bytes for both channels.
grep -q 'tar -xzOf "\$SITE/dist/kosmos-\$V-arm64.tar.gz" app/package.json' "$REPO/tools/release.sh" \
  && ok "step 6: the publish-version check reads the VERSIONED artifact (channel-correct)" \
  || no "step 6: the publish-version check does not read the versioned artifact (a staging cut refuses a correct build)"
grep -q 'tar -xzOf "\$SITE/dist/kosmos-arm64.tar.gz" app/package.json' "$REPO/tools/release.sh" \
  && no "step 6: still reads the unversioned alias (the #2036 staging step-6 bug is back)" \
  || ok "step 6: no longer reads the unversioned prod alias"

# --- the staging fresh-install hand-off command must put KOSMOS_UPDATE_CHANNEL on the sh (RIGHT
#     of the pipe), never on curl. An env prefix binds to the LEFT of a pipe, so
#     `KOSMOS_UPDATE_CHANNEL=staging curl ... | sh` sets the var for curl and the setup script (in
#     sh) never sees it -> it installs PROD, not staging. This bit a live fresh-machine test.
grep -q 'KOSMOS_UPDATE_CHANNEL=staging curl' "$REPO/tools/release.sh" \
  && no "staging hand-off: the fresh-install command sets the channel var on curl (LEFT of pipe) - setup installs PROD" \
  || ok "staging hand-off: no channel-var-on-curl (the pipe-precedence bug is absent)"
grep -qE 'curl -fsSL .*/setup \| KOSMOS_UPDATE_CHANNEL=staging sh' "$REPO/tools/release.sh" \
  && ok "staging hand-off: the fresh-install command puts the channel var on the sh (right of the pipe)" \
  || no "staging hand-off: the fresh-install command does not set the channel var on the sh"

# --- setup.sh: the #2066 source-channel write (data root + token), extracted and evaluated ----
# The install records which channel pointer it fetched from into <store.ROOT>/source-channel, so
# the board (server.js sourceChannelNow, #2089) can paint a STAGING badge. Assert the token AND
# that the file lands where the read side looks (store.ROOT = AGENT_WORKFORCE_DATA/AgentWorkforce,
# mirroring engine/store.js dataRootFor). A missing file reads prod, so a staging install that
# writes nothing masquerades as prod -- that is the failure this guards.
source_channel_write() {  # $1 = KOSMOS_UPDATE_CHANNEL, $2 = AGENT_WORKFORCE_DATA sandbox root
  local KOSMOS_UPDATE_CHANNEL="$1" AGENT_WORKFORCE_DATA="$2" _PTR_FILE="latest.json" _wf_data_root _source_channel
  [ "${KOSMOS_UPDATE_CHANNEL:-}" = staging ] && _PTR_FILE="latest-staging.json"
  if [ -n "${AGENT_WORKFORCE_DATA:-}" ]; then _wf_data_root="$AGENT_WORKFORCE_DATA/AgentWorkforce"; else _wf_data_root="$HOME/Library/Application Support/AgentWorkforce"; fi
  if [ "$_PTR_FILE" = "latest-staging.json" ]; then _source_channel=staging; else _source_channel=prod; fi
  mkdir -p "$_wf_data_root" 2>/dev/null && printf '%s\n' "$_source_channel" > "$_wf_data_root/source-channel"
}
scS="$T/sc-staging"; source_channel_write staging "$scS"
[ "$(cat "$scS/AgentWorkforce/source-channel" 2>/dev/null)" = staging ] && ok "source-channel: a STAGING install writes 'staging' to <store.ROOT>/source-channel" || no "source-channel: staging install did not write 'staging'"
scP="$T/sc-prod"; source_channel_write '' "$scP"
[ "$(cat "$scP/AgentWorkforce/source-channel" 2>/dev/null)" = prod ] && ok "source-channel: a DEFAULT (prod) install writes 'prod' (an unrecorded install must not masquerade as staging)" || no "source-channel: default install did not write 'prod'"
scW="$T/sc-whatever"; source_channel_write whatever "$scW"
[ "$(cat "$scW/AgentWorkforce/source-channel" 2>/dev/null)" = prod ] && ok "source-channel: a non-staging channel value records prod" || no "source-channel: non-staging value not prod"
# the write path must match the READ path: the file lands at AGENT_WORKFORCE_DATA/AgentWorkforce/source-channel
[ -f "$scS/AgentWorkforce/source-channel" ] && ok "source-channel: the file lands at <AGENT_WORKFORCE_DATA>/AgentWorkforce/source-channel (matches store.ROOT the server reads)" || no "source-channel: file not at the store.ROOT the read side uses"
# Guard the extracted copy against drift from the real setup.sh (red-capable: removing the write fails these).
grep -qF 'printf '"'"'%s\n'"'"' "$_source_channel" > "$_wf_data_root/source-channel"' "$REPO/install/setup.sh" && ok "source-channel: setup.sh carries the write (extract matches source)" || no "source-channel: setup.sh no longer writes source-channel (the STAGING badge would never light)"
grep -qF 'if [ "$_PTR_FILE" = "latest-staging.json" ]; then _source_channel=staging; else _source_channel=prod; fi' "$REPO/install/setup.sh" && ok "source-channel: setup.sh keys the token on _PTR_FILE (the same selector the pointer fetch uses)" || no "source-channel: setup.sh token selector drifted"
grep -qF '_wf_data_root="$AGENT_WORKFORCE_DATA/AgentWorkforce"' "$REPO/install/setup.sh" && ok "source-channel: setup.sh honors AGENT_WORKFORCE_DATA (mirrors dataRootFor, so tests + sandbox seed the real path)" || no "source-channel: setup.sh data-root override drifted from dataRootFor"
# Cross-check: the read side (server.js, #2089) reads the same filename this writes.
grep -qF "'source-channel'" "$REPO/server.js" && ok "source-channel: server.js read side reads the same 'source-channel' filename this writes" || no "source-channel: read side (server.js) does not name source-channel -- the two halves would not meet"

echo "----"
echo "test-staging-wire-2036: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
