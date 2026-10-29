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

# 5. release.sh runs it before the bump (step 1d3), and sources the lib
grep -q '^service_keys_live_check "\$REPO" || exit 1$' tools/release.sh && ok "release.sh step 1d3 runs the check" || bad "release.sh does not run service_keys_live_check"
_bump="$(grep -n '^step "== 2\. the version' tools/release.sh | cut -d: -f1)"; _chk="$(grep -n '^service_keys_live_check' tools/release.sh | cut -d: -f1)"
[ -n "$_bump" ] && [ -n "$_chk" ] && [ "$_chk" -lt "$_bump" ] && ok "the check runs before the bump" || bad "the check is not before step 2 (check line '$_chk', bump line '$_bump')"
grep -q '^\. "\$REPO/tools/lib/service-keys-live.sh"' tools/release.sh && ok "release.sh sources the lib" || bad "release.sh does not source tools/lib/service-keys-live.sh"

[ "$FAILS" -eq 0 ] && echo "ALL PASS" || { echo "$FAILS FAILED"; exit 1; }
