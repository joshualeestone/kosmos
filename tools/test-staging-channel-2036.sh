#!/usr/bin/env bash
# test-staging-channel-2036.sh - the #2036 staging-channel WRITE + PROMOTE tools.
# Runs publish-staging-pointer.sh and promote-channel.sh against a fixture site dist
# (a versioned artifact + its verified sidecar), with the experience gate stubbed via
# KOSMOS_PROMOTE_GATE_CMD so all three gate arms (usable / broken / cannot-tell) are
# exercised without a live board. Asserts the same-bytes invariant refusals and that a
# promote is a pointer copy that lands the exact bytes staging verified.
#
#   bash tools/test-staging-channel-2036.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PUBLISH="$HERE/publish-staging-pointer.sh"
PROMOTE="$HERE/promote-channel.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/staging-chan-test.XXXXXXXX")"
trap 'rm -rf "$T"' EXIT
fail=0
pass() { printf 'PASS  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fail=1; }
has()  { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

V=9.9.9
ART="kosmos-$V-arm64.tar.gz"

# A fresh site whose dist/ holds one versioned artifact + a verified sidecar.
make_site() {
  local s; s="$(mktemp -d "$T/site.XXXXXX")"; mkdir -p "$s/dist"
  printf 'ARTIFACT-BYTES-%s\n' "$V" > "$s/dist/$ART"
  ( cd "$s/dist" && shasum -a 256 "$ART" > "$ART.sha256" )
  printf '%s' "$s"
}
jget() { node -e 'try{process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]]||""))}catch{}' "$1" "$2" 2>/dev/null; }
# A stub gate that exits with $GATE_RC_WANT, so promote's three arms run with no board.
STUB="$T/stub-gate.sh"; printf '#!/usr/bin/env bash\nexit "${GATE_RC_WANT:-0}"\n' > "$STUB"; chmod +x "$STUB"
GATE="bash $STUB"

# ---- publish-staging-pointer ----
S="$(make_site)"
out="$(bash "$PUBLISH" "$S" 2>&1)"; rc=$?
[ "$rc" = 0 ] && pass "publish: exit 0 on a good artifact" || bad "publish exit 0 (rc=$rc, out=$out)"
[ -f "$S/dist/latest-staging.json" ] && pass "publish: wrote latest-staging.json" || bad "publish did not write latest-staging.json"
[ ! -f "$S/dist/latest.json" ] && pass "publish: did NOT touch the prod pointer latest.json" || bad "publish wrote latest.json (must not)"
[ "$(jget "$S/dist/latest-staging.json" version)" = "$V" ] && pass "publish: pointer names the right version" || bad "publish version wrong"
[ "$(jget "$S/dist/latest-staging.json" artifact)" = "$ART" ] && pass "publish: pointer names the right artifact" || bad "publish artifact wrong"
EXP_SHA="$(awk '{print $1}' "$S/dist/$ART.sha256")"
[ "$(jget "$S/dist/latest-staging.json" sha256)" = "$EXP_SHA" ] && pass "publish: pointer sha matches the verified sidecar" || bad "publish sha mismatch"

# publish refuses a missing artifact (empty dist)
S2="$(mktemp -d "$T/site.XXXXXX")"; mkdir -p "$S2/dist"
out="$(bash "$PUBLISH" "$S2" 9.9.9 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "does not exist" && pass "publish: refuses a missing artifact" || bad "publish missing-artifact (rc=$rc, out=$out)"

# publish refuses when the sidecar does not verify (corrupt the artifact after the sidecar)
S3="$(make_site)"; printf 'TAMPERED\n' >> "$S3/dist/$ART"
out="$(bash "$PUBLISH" "$S3" 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "does not verify in place" && pass "publish: refuses bytes that do not verify against the sidecar" || bad "publish unverified (rc=$rc, out=$out)"

# publish derives the version from the single artifact (no version arg) - already used above (S)
[ "$(jget "$S/dist/latest-staging.json" manifest)" = "kosmos-$V-arm64.manifest.json" ] && pass "publish: derived version + manifest name" || bad "publish manifest name wrong"

# ---- promote-channel ----
# gate 0 -> promote: latest.json created, names the SAME artifact + sha as staging
Sp="$(make_site)"; bash "$PUBLISH" "$Sp" >/dev/null 2>&1
out="$(KOSMOS_PROMOTE_GATE_CMD="$GATE" GATE_RC_WANT=0 bash "$PROMOTE" "$Sp" 2>&1)"; rc=$?
[ "$rc" = 0 ] && pass "promote: gate 0 -> exit 0" || bad "promote gate0 exit (rc=$rc, out=$out)"
[ -f "$Sp/dist/latest.json" ] && pass "promote: wrote the prod pointer latest.json" || bad "promote did not write latest.json"
[ "$(jget "$Sp/dist/latest.json" artifact)" = "$ART" ] && [ "$(jget "$Sp/dist/latest.json" sha256)" = "$(jget "$Sp/dist/latest-staging.json" sha256)" ] && pass "promote: latest.json names the SAME bytes as staging (pointer copy, no rebuild)" || bad "promote did not match staging"

# gate 1 -> refuse, latest.json unchanged; and --force still refuses a provably-broken board
Sb="$(make_site)"; bash "$PUBLISH" "$Sb" >/dev/null 2>&1
out="$(KOSMOS_PROMOTE_GATE_CMD="$GATE" GATE_RC_WANT=1 bash "$PROMOTE" "$Sb" 2>&1)"; rc=$?
[ "$rc" = 1 ] && [ ! -f "$Sb/dist/latest.json" ] && pass "promote: gate 1 (broken) -> refuse, prod pointer untouched" || bad "promote gate1 (rc=$rc, latest exists: $([ -f "$Sb/dist/latest.json" ] && echo y||echo n))"
out="$(KOSMOS_PROMOTE_GATE_CMD="$GATE" GATE_RC_WANT=1 bash "$PROMOTE" "$Sb" --force 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "does not override" && [ ! -f "$Sb/dist/latest.json" ] && pass "promote: --force does NOT override a provably-broken board (exit 1)" || bad "promote gate1 --force (rc=$rc, out=$out)"

# gate 2 -> HOLD by default; gate 2 + --force -> promote with a warning
Sh="$(make_site)"; bash "$PUBLISH" "$Sh" >/dev/null 2>&1
out="$(KOSMOS_PROMOTE_GATE_CMD="$GATE" GATE_RC_WANT=2 bash "$PROMOTE" "$Sh" 2>&1)"; rc=$?
[ "$rc" = 2 ] && [ ! -f "$Sh/dist/latest.json" ] && pass "promote: gate 2 (cannot-tell) -> HOLD (exit 2), prod pointer untouched" || bad "promote gate2 hold (rc=$rc)"
out="$(KOSMOS_PROMOTE_GATE_CMD="$GATE" GATE_RC_WANT=2 bash "$PROMOTE" "$Sh" --force 2>&1)"; rc=$?
[ "$rc" = 0 ] && has "$out" "NOT automatically verified" && [ -f "$Sh/dist/latest.json" ] && pass "promote: gate 2 + --force -> promote with a hand-verified warning" || bad "promote gate2 --force (rc=$rc, out=$out)"

# same-bytes invariant: a staging pointer whose sha does not match the served artifact is refused BEFORE the gate
Sm="$(make_site)"; bash "$PUBLISH" "$Sm" >/dev/null 2>&1
# rewrite the staging pointer's sha to a wrong value
node -e 'const f=process.argv[1],fs=require("node:fs");const j=JSON.parse(fs.readFileSync(f,"utf8"));j.sha256="deadbeef";fs.writeFileSync(f,JSON.stringify(j)+"\n")' "$Sm/dist/latest-staging.json"
out="$(KOSMOS_PROMOTE_GATE_CMD="$GATE" GATE_RC_WANT=0 bash "$PROMOTE" "$Sm" 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "does not describe the bytes on disk" && [ ! -f "$Sm/dist/latest.json" ] && pass "promote: refuses when the staging sha != the served bytes (same-bytes invariant, before the gate)" || bad "promote sha-mismatch (rc=$rc, out=$out)"

# same-bytes invariant: a staging pointer naming a missing artifact is refused
Sx="$(make_site)"; bash "$PUBLISH" "$Sx" >/dev/null 2>&1; rm -f "$Sx/dist/$ART" "$Sx/dist/$ART.sha256"
out="$(KOSMOS_PROMOTE_GATE_CMD="$GATE" GATE_RC_WANT=0 bash "$PROMOTE" "$Sx" 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "missing artifact" && pass "promote: refuses when the staged artifact is gone" || bad "promote missing-artifact (rc=$rc, out=$out)"

echo ""
if [ "$fail" = 0 ]; then echo "test-staging-channel-2036: ALL PASS"; else echo "test-staging-channel-2036: FAILURES above"; exit 1; fi
