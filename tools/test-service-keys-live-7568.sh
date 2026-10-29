#!/bin/bash
# service_keys_live_check (kosmos#7568): a cut refuses a service key set that does not list the coordinator key the
# live service answers with. A throwaway repo holding the real check and the real engine/servicekeys.js, keys made
# here, and /v1/meta served from a file:// URL, so no network.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tools/lib/service-keys-live.sh
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/service-keys-live.XXXXXX")"; trap 'rm -rf "${T:?}"' EXIT
export KOSMOS_COORDINATOR_RETRIES=0   # the file:// "unreadable" arms would otherwise sleep through retries

mkdir -p "$T/repo/engine" "$T/repo/tools"
cp tools/check-service-keys-live.js "$T/repo/tools/"
cp engine/servicekeys.js engine/manifest-verify.js "$T/repo/engine/"
# Two real Ed25519 keys: LIVE (the coordinator's) and OTHER. Each as the set spells it (SPKI base64) and as /v1/meta
# spells it (raw, base64url, no padding).
node -e '
const c = require("crypto");
for (const n of ["live", "other"]) {
  const der = c.generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" });
  console.log(n + "_spki=" + der.toString("base64"));
  console.log(n + "_raw=" + der.subarray(12).toString("base64url"));
}' > "$T/keys" || { echo "FAIL  could not make test keys"; exit 1; }
LIVE_SPKI="$(sed -n 's/^live_spki=//p' "$T/keys")"; LIVE_RAW="$(sed -n 's/^live_raw=//p' "$T/keys")"
OTHER_SPKI="$(sed -n 's/^other_spki=//p' "$T/keys")"
[ -n "$LIVE_SPKI" ] && [ -n "$LIVE_RAW" ] && [ -n "$OTHER_SPKI" ] || { echo "FAIL  empty test keys"; exit 1; }

set_of(){ # <pub>...: a set listing these keys
  local out="" k i=0
  for k in "$@"; do i=$((i+1)); out="$out${out:+,}{\"kid\":\"k$i\",\"pub\":\"$k\",\"role\":\"current\"}"; done
  printf '{"type":"kosmos-service-keys","service_keys":[%s],"seq":1,"issued":"2026-10-29"}' "$out" > "$T/repo/engine/service-keys.json"
}
coordinator(){ # <meta body> | none
  rm -rf "$T/coord"; mkdir -p "$T/coord/v1"
  [ "$1" = none ] || printf '%s' "$1" > "$T/coord/v1/meta"
}
run(){ KOSMOS_COORDINATOR_URL="file://$T/coord" service_keys_live_check "$T/repo" >"$T/out" 2>"$T/err"; }

# 1. no set ships: passes WITHOUT asking (CONTROL: the meta is absent, which would refuse if it were asked)
rm -f "$T/repo/engine/service-keys.json"; coordinator none
run && grep -q "nothing to check" "$T/out" && ok "no set ships: passes without asking the coordinator" || bad "no set was refused: $(cat "$T/err")"

# 2. THE CASE: a set that lacks the live key is refused, naming the key
set_of "$OTHER_SPKI"; coordinator "{\"build\":\"bfdf80be3\",\"coordinator_pubkey\":\"$LIVE_RAW\"}"
if run; then bad "a set without the live coordinator key passed"
else grep -q "NOT on the set" "$T/err" && grep -q "$LIVE_RAW" "$T/err" && ok "a set without the live key refuses, naming it" || bad "wrong refusal: $(cat "$T/err")"; fi

# 3. CONTROL for 2: the same meta passes once the set lists the key, alone or beside another (a rotation)
set_of "$LIVE_SPKI"; run && grep -q "is listed" "$T/out" && ok "a set listing the live key passes" || bad "a set with the live key was refused: $(cat "$T/err")"
set_of "$OTHER_SPKI" "$LIVE_SPKI"; run && ok "a set listing the live key beside another passes" || bad "two-key set refused: $(cat "$T/err")"

# 4. fails closed: unreadable meta, meta that is not JSON, meta with no key, a key that is not one, a set that is not JSON
set_of "$LIVE_SPKI"
coordinator none; run && bad "an unreadable /v1/meta was waved on" || { grep -q "UNKNOWN" "$T/err" && ok "an unreadable /v1/meta refuses" || bad "wrong refusal for no meta: $(cat "$T/err")"; }
coordinator '<html>gateway</html>'; run && bad "a non-JSON meta was waved on" || { grep -q "not with JSON" "$T/err" && ok "a non-JSON meta refuses" || bad "wrong refusal for non-JSON meta: $(cat "$T/err")"; }
coordinator '{"build":"bfdf80be3"}'; run && bad "a meta without coordinator_pubkey was waved on" || { grep -q "names no coordinator_pubkey" "$T/err" && ok "a meta without the key refuses" || bad "wrong refusal for keyless meta: $(cat "$T/err")"; }
coordinator '{"coordinator_pubkey":"not-a-key"}'; run && bad "a meta key that is not a key was waved on" || { grep -q "is not a key" "$T/err" && ok "a meta key that is not a key refuses" || bad "wrong refusal for a junk key: $(cat "$T/err")"; }
coordinator "{\"coordinator_pubkey\":\"$LIVE_RAW\"}"; printf 'not json' > "$T/repo/engine/service-keys.json"
run && bad "a set that is not JSON was waved on" || { grep -q "as JSON" "$T/err" && ok "a set that is not JSON refuses" || bad "wrong refusal for a junk set: $(cat "$T/err")"; }

# 4b. a .sig without its set refuses (it is not "no set"); a set listing no keys says so; a trailing / on the
# coordinator URL asks /v1/meta, not //v1/meta (CONTROL: the same meta at the bare URL passes above)
rm -f "$T/repo/engine/service-keys.json"; printf 'sig' > "$T/repo/engine/service-keys.json.sig"; coordinator none
run && bad "a .sig without its set passed" || { grep -q "without the set it signs" "$T/err" && ok "a .sig without its set refuses" || bad "wrong refusal for a lone .sig: $(cat "$T/err")"; }
rm -f "$T/repo/engine/service-keys.json.sig"
coordinator "{\"coordinator_pubkey\":\"$LIVE_RAW\"}"; set_of
run && bad "a set listing no keys passed" || { grep -q "lists no keys at all" "$T/err" && ok "a set listing no keys refuses, said as empty" || bad "wrong refusal for an empty set: $(cat "$T/err")"; }
set_of "$LIVE_SPKI"
KOSMOS_COORDINATOR_URL="file://$T/coord/" service_keys_live_check "$T/repo" >"$T/out" 2>"$T/err" && ok "a trailing / on the coordinator URL still reads /v1/meta" || bad "a trailing / refused: $(cat "$T/err")"

# 4c. the frozen-tree re-check, through the REAL freeze (tools/lib/release-freeze.sh): the checkout had no set when
# 1d3 asked, then a fast-forward brought one in that lacks the key. The frozen tree must refuse; a freeze of a commit
# that lists the key passes (the control, so the refusal is the set and not a frozen tree missing the check).
. tools/lib/release-freeze.sh
g(){ git -c user.name=t -c user.email=t@example.com -c commit.gpgsign=false "$@"; }
rm -f "$T/repo/engine/service-keys.json" "$T/repo/engine/service-keys.json.sig"
g init -q -b main "$T/repo" && g -C "$T/repo" add -A && g -C "$T/repo" commit -q -m "no set"
coordinator none   # so "asks nothing" is shown: asking would refuse
run && ok "1d3 on the checkout with no set asks nothing" || bad "the checkout with no set refused: $(cat "$T/err")"
PRINT_1D3="$(service_keys_fingerprint "$T/repo")"
[ "$PRINT_1D3" = absent ] && ok "the fingerprint of no set is 'absent'" || bad "fingerprint of no set: '$PRINT_1D3'"
coordinator "{\"coordinator_pubkey\":\"$LIVE_RAW\"}"
freeze_check(){ # <label> <fingerprint 1d3 saw>: commit the set now in the checkout, freeze that commit, re-check it
  local sha build rc
  g -C "$T/repo" add -A && g -C "$T/repo" commit -q --allow-empty -m "$1"; sha="$(git -C "$T/repo" rev-parse HEAD)"
  mkdir -p "$T/frozen"; build="$(release_freeze "$T/repo" "$sha" "$T/frozen")" || { echo "freeze failed" > "$T/err"; return 2; }
  KOSMOS_COORDINATOR_URL="file://$T/coord" service_keys_live_recheck "$build" "$2" >"$T/out" 2>"$T/err"; rc=$?
  release_thaw "$T/repo" "$build"; return "$rc"
}
set_of "$OTHER_SPKI"; freeze_check "a fast-forward brings in a set without the key" "$PRINT_1D3"; rc=$?
[ "$rc" = 1 ] && grep -q "differs from what step 1d3 saw" "$T/out" && grep -q "NOT on the set" "$T/err" && ok "a set the fast-forward brought in is asked about, and refused without the key" || bad "frozen set without the key: rc=$rc $(cat "$T/out" "$T/err")"
set_of "$OTHER_SPKI" "$LIVE_SPKI"; freeze_check "the set lists the key" "$PRINT_1D3"; rc=$?
[ "$rc" = 0 ] && grep -q "is listed" "$T/out" && ok "CONTROL: the frozen tree with the key passes" || bad "frozen set with the key: rc=$rc $(cat "$T/err")"
# The same set 1d3 checked is not asked about again (a blip after the bump must not abort the cut): CONTROL, the meta is
# absent, so asking would refuse. Then the set changes and the same fingerprint no longer passes it.
PRINT_SAME="$(service_keys_fingerprint "$T/repo")"; coordinator none
freeze_check "nothing changed" "$PRINT_SAME"; rc=$?
[ "$rc" = 0 ] && grep -q "the one step 1d3 checked" "$T/out" && ok "an unchanged set is not asked about again" || bad "unchanged set: rc=$rc $(cat "$T/out" "$T/err")"
set_of "$OTHER_SPKI"; freeze_check "the set changed after 1d3" "$PRINT_SAME"; rc=$?
[ "$rc" = 1 ] && grep -q "differs from what step 1d3 saw" "$T/out" && ok "a set changed after 1d3 is asked about again" || bad "changed set: rc=$rc $(cat "$T/out" "$T/err")"
freeze_check "no fingerprint from 1d3" ""; rc=$?
[ "$rc" = 1 ] && grep -q "unknown" "$T/out" && ok "an empty fingerprint never matches: it asks" || bad "empty fingerprint: rc=$rc $(cat "$T/out" "$T/err")"

# 4d. the Windows build ships the same set (kosmos_stage_service_keys) and asks the same question, beside its floor check
grep -q '^\. "\$REPO/tools/lib/service-keys-live.sh"$' tools/build-kosmos-windows.sh \
  && grep -q '^service_keys_live_check "\$REPO" || exit 1$' tools/build-kosmos-windows.sh \
  && ok "build-kosmos-windows.sh runs the check" || bad "build-kosmos-windows.sh does not run service_keys_live_check"

# 5. release.sh runs it before the bump (step 1d3) and again on the frozen tree, and sources the lib
grep -q '^service_keys_live_check "\$REPO" || exit 1$' tools/release.sh && ok "release.sh step 1d3 runs the check" || bad "release.sh does not run service_keys_live_check"
_bump="$(grep -n '^step "== 2\. the version' tools/release.sh | cut -d: -f1)"; _chk="$(grep -n '^service_keys_live_check "\$REPO"' tools/release.sh | cut -d: -f1)"
[ -n "$_bump" ] && [ -n "$_chk" ] && [ "$_chk" -lt "$_bump" ] && ok "the check runs before the bump" || bad "the check is not before step 2 (check line '$_chk', bump line '$_bump')"
# The frozen re-check: after REPO="$BUILD" (the freeze) and before step 4 builds anything.
_frz="$(grep -n '^REPO="\$BUILD"$' tools/release.sh | cut -d: -f1)"; _re="$(grep -n '^service_keys_live_recheck "\$BUILD" "\$_SK_PRINT" || { echo .*already committed.*; exit 1; }$' tools/release.sh | cut -d: -f1)"
_pr="$(grep -n '^_SK_PRINT="\$(service_keys_fingerprint "\$REPO")" || _SK_PRINT=""' tools/release.sh | cut -d: -f1)"
[ -n "$_pr" ] && [ -n "$_chk" ] && [ "$_pr" -eq $((_chk + 1)) ] && ok "1d3 records the set's fingerprint right after it checks" || bad "no fingerprint recorded after 1d3 (check '$_chk', print '$_pr')"
_b4="$(grep -n '^step "== 4\. build ==' tools/release.sh | cut -d: -f1)"
[ -n "$_frz" ] && [ -n "$_re" ] && [ -n "$_b4" ] && [ "$_re" -gt "$_frz" ] && [ "$_re" -lt "$_b4" ] && ok "the frozen tree is checked again, after the freeze and before the build" || bad "no frozen re-check between the freeze and step 4 (freeze '$_frz', check '$_re', build '$_b4')"
grep -q '^\. "\$REPO/tools/lib/service-keys-live.sh"' tools/release.sh && ok "release.sh sources the lib" || bad "release.sh does not source tools/lib/service-keys-live.sh"

[ "$FAILS" -eq 0 ] && echo "ALL PASS" || { echo "$FAILS FAILED"; exit 1; }
