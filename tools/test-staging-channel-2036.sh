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
MAN="kosmos-$V-arm64.manifest.json"

# A fresh site whose dist/ holds one versioned artifact, its verified sidecar, and the
# manifest the pointer advertises.
make_site() {
  local s; s="$(mktemp -d "$T/site.XXXXXX")"; mkdir -p "$s/dist"
  printf 'ARTIFACT-BYTES-%s\n' "$V" > "$s/dist/$ART"
  ( cd "$s/dist" && shasum -a 256 "$ART" > "$ART.sha256" )
  printf '{"files":[]}\n' > "$s/dist/$MAN"
  printf '%s' "$s"
}
jget() { node -e 'try{process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]]||""))}catch{}' "$1" "$2" 2>/dev/null; }
# A stub gate that echoes its received port (arg1) and exits with $GATE_RC_WANT, so promote's
# three arms run with no board AND a test can assert the [port] was forwarded to the gate.
STUB="$T/stub-gate.sh"; printf '#!/usr/bin/env bash\nprintf "gate-arg1:%%s\\n" "${1:-}"\nexit "${GATE_RC_WANT:-0}"\n' > "$STUB"; chmod +x "$STUB"
GATE="bash $STUB"
# #2036/#2129: promote now runs a SECOND gate (the agent-spawn gate) after the experience
# gate passes. Stub it too, defaulting to PASS (0) so every existing experience-gate case is
# unchanged; its own arms (1 refuse / 2 HOLD / 2+force) get dedicated cases below.
AGENT_STUB="$T/stub-agent-gate.sh"; printf '#!/usr/bin/env bash\nprintf "agent-gate-arg1:%%s\\n" "${1:-}"\nexit "${AGENT_RC_WANT:-0}"\n' > "$AGENT_STUB"; chmod +x "$AGENT_STUB"
export KOSMOS_PROMOTE_AGENT_GATE_CMD="bash $AGENT_STUB"
export AGENT_RC_WANT=0

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
[ "$rc" = 1 ] && has "$out" "nothing to point at" && pass "publish: refuses a missing artifact" || bad "publish missing-artifact (rc=$rc, out=$out)"

# publish refuses when the sidecar does not verify (corrupt the artifact after the sidecar)
S3="$(make_site)"; printf 'TAMPERED\n' >> "$S3/dist/$ART"
out="$(bash "$PUBLISH" "$S3" 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "does not verify in place" && pass "publish: refuses bytes that do not verify against the sidecar" || bad "publish unverified (rc=$rc, out=$out)"

# publish derives the version from the single artifact (no version arg) - already used above (S)
[ "$(jget "$S/dist/latest-staging.json" manifest)" = "kosmos-$V-arm64.manifest.json" ] && pass "publish: derived version + manifest name" || bad "publish manifest name wrong"

# publish refuses to advertise a manifest that is not on disk
S4="$(make_site)"; rm -f "$S4/dist/$MAN"
out="$(bash "$PUBLISH" "$S4" 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "refusing to advertise a missing manifest" && [ ! -f "$S4/dist/latest-staging.json" ] && pass "publish: refuses to advertise a missing manifest" || bad "publish missing-manifest (rc=$rc, out=$out)"

# ---- promote-channel ----
# gate 0 -> promote: latest.json created, names the SAME artifact + sha as staging
Sp="$(make_site)"; bash "$PUBLISH" "$Sp" >/dev/null 2>&1
out="$(KOSMOS_PROMOTE_GATE_CMD="$GATE" GATE_RC_WANT=0 bash "$PROMOTE" "$Sp" 2>&1)"; rc=$?
[ "$rc" = 0 ] && pass "promote: gate 0 -> exit 0" || bad "promote gate0 exit (rc=$rc, out=$out)"
[ -f "$Sp/dist/latest.json" ] && pass "promote: wrote the prod pointer latest.json" || bad "promote did not write latest.json"
[ "$(jget "$Sp/dist/latest.json" artifact)" = "$ART" ] && [ "$(jget "$Sp/dist/latest.json" sha256)" = "$(jget "$Sp/dist/latest-staging.json" sha256)" ] && pass "promote: latest.json names the SAME bytes as staging (pointer copy, no rebuild)" || bad "promote did not match staging"
# The atomic write (temp + rename) must leave no temp file behind.
leftovers="$(ls -a "$Sp/dist" | grep -c '\.latest.*\.[A-Za-z0-9]\{6\}$' || true)"
[ "$leftovers" = 0 ] && pass "publish+promote: no .latest* temp file left behind (atomic rename cleaned up)" || bad "atomic-write left $leftovers temp file(s) in dist"
# #2036: promote refreshes the unversioned prod alias (kosmos-arm64.tar.gz) to the promoted bytes.
# A staging cut leaves the alias at the prior prod bytes (release.sh gates its alias publish on a
# prod cut), so the promote is where the alias moves. The alias must be created, equal the promoted
# versioned artifact, and its sidecar must verify in place. Red-capable: without the refresh the
# alias is absent and all three fail.
[ -f "$Sp/dist/kosmos-arm64.tar.gz" ] && pass "promote: refreshed the prod alias kosmos-arm64.tar.gz" || bad "promote did not refresh the prod alias"
cmp -s "$Sp/dist/kosmos-arm64.tar.gz" "$Sp/dist/$ART" && pass "promote: the alias bytes equal the promoted versioned artifact" || bad "alias bytes differ from the versioned artifact"
( cd "$Sp/dist" && shasum -a 256 --status -c kosmos-arm64.tar.gz.sha256 ) && pass "promote: the refreshed alias .sha256 verifies in place" || bad "alias .sha256 does not verify"

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

# THE load-bearing guarantee: --force overrides ONLY the experience gate, NEVER the
# same-bytes invariant. Prove it decisively -- a byte-refusal (wrong pointer sha) with
# --force AND a PASSING gate (GATE_RC_WANT=0) must still refuse, because the byte-refusal
# precedes the gate. A future refactor that consulted --force before the byte-check would
# turn this red (it is the one thing a reviewer asked to be pinned, this being a prod path).
Smf="$(make_site)"; bash "$PUBLISH" "$Smf" >/dev/null 2>&1
node -e 'const f=process.argv[1],fs=require("node:fs");const j=JSON.parse(fs.readFileSync(f,"utf8"));j.sha256="deadbeef";fs.writeFileSync(f,JSON.stringify(j)+"\n")' "$Smf/dist/latest-staging.json"
out="$(KOSMOS_PROMOTE_GATE_CMD="$GATE" GATE_RC_WANT=0 bash "$PROMOTE" "$Smf" --force 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "does not describe the bytes on disk" && [ ! -f "$Smf/dist/latest.json" ] && pass "promote: --force does NOT override the same-bytes invariant (byte-refusal precedes the gate)" || bad "promote sha-mismatch --force (rc=$rc, out=$out)"

# same-bytes invariant: promote runs its OWN verify-in-place, so an artifact tampered AFTER
# publish (bytes changed, sidecar unchanged, pointer sha unchanged) is refused at promote time
# even though the staging pointer still matches the (now stale) sidecar's sha.
St="$(make_site)"; bash "$PUBLISH" "$St" >/dev/null 2>&1
printf 'TAMPERED-AFTER-PUBLISH\n' >> "$St/dist/$ART"
out="$(KOSMOS_PROMOTE_GATE_CMD="$GATE" GATE_RC_WANT=0 bash "$PROMOTE" "$St" 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "does not verify against its sidecar" && [ ! -f "$St/dist/latest.json" ] && pass "promote: refuses an artifact tampered after publish (verify-in-place at promote time)" || bad "promote tamper-after-publish (rc=$rc, out=$out)"

# same-bytes invariant: a staging pointer naming a missing artifact is refused
Sx="$(make_site)"; bash "$PUBLISH" "$Sx" >/dev/null 2>&1; rm -f "$Sx/dist/$ART" "$Sx/dist/$ART.sha256"
out="$(KOSMOS_PROMOTE_GATE_CMD="$GATE" GATE_RC_WANT=0 bash "$PROMOTE" "$Sx" 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "missing artifact" && [ ! -f "$Sx/dist/latest.json" ] && pass "promote: refuses when the staged artifact is gone" || bad "promote missing-artifact (rc=$rc, out=$out)"

# promote refuses when the advertised manifest has gone missing since publish
Smn="$(make_site)"; bash "$PUBLISH" "$Smn" >/dev/null 2>&1; rm -f "$Smn/dist/$MAN"
out="$(KOSMOS_PROMOTE_GATE_CMD="$GATE" GATE_RC_WANT=0 bash "$PROMOTE" "$Smn" 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "missing manifest" && [ ! -f "$Smn/dist/latest.json" ] && pass "promote: refuses a pointer whose manifest went missing" || bad "promote missing-manifest (rc=$rc, out=$out)"

# [port] is forwarded to the gate (its arg1), so an operator gives the fresh board's port
# rather than being pushed toward --force by a wrong-port HOLD.
Spt="$(make_site)"; bash "$PUBLISH" "$Spt" >/dev/null 2>&1
out="$(KOSMOS_PROMOTE_GATE_CMD="$GATE" GATE_RC_WANT=0 bash "$PROMOTE" "$Spt" 17999 2>&1)"; rc=$?
[ "$rc" = 0 ] && has "$out" "gate-arg1:17999" && has "$out" "(port 17999)" && [ -f "$Spt/dist/latest.json" ] && pass "promote: forwards [port] to the experience gate" || bad "promote port forward (rc=$rc, out=$out)"

# a non-numeric [port] is refused before anything runs
out="$(bash "$PROMOTE" "$Spt" notaport 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "expected a numeric" && pass "promote: refuses a non-numeric [port]" || bad "promote non-numeric port (rc=$rc, out=$out)"

# defense in depth: a staging pointer whose artifact/manifest is a path (not a bare filename)
# is refused before it is used as a filesystem path.
Spy="$(make_site)"; bash "$PUBLISH" "$Spy" >/dev/null 2>&1
node -e 'const f=process.argv[1],fs=require("node:fs");const j=JSON.parse(fs.readFileSync(f,"utf8"));j.artifact="../evil.tar.gz";fs.writeFileSync(f,JSON.stringify(j)+"\n")' "$Spy/dist/latest-staging.json"
out="$(KOSMOS_PROMOTE_GATE_CMD="$GATE" GATE_RC_WANT=0 bash "$PROMOTE" "$Spy" 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "not a bare filename" && [ ! -f "$Spy/dist/latest.json" ] && pass "promote: refuses a path-bearing artifact name in the pointer (basename guard)" || bad "promote pathy-artifact (rc=$rc, out=$out)"

# the shared pointer writer refuses a missing field rather than emitting a malformed pointer
out="$(KM_LJ_VERSION="" KM_LJ_SHA=x KM_LJ_ARTIFACT=a KM_LJ_MANIFEST=m node "$HERE/lib/write-latest-pointer.js" "$T/should-not-exist.json" 2>&1)"; rc=$?
[ "$rc" != 0 ] && [ ! -f "$T/should-not-exist.json" ] && has "$out" "missing field" && pass "write-latest-pointer: refuses an empty field" || bad "write-latest-pointer empty field (rc=$rc, out=$out)"

# ---- the SECOND (agent-spawn) gate, #2036/#2129 ----
# experience gate PASSES but the agent gate says WEDGED (1) -> refuse, latest.json NOT written.
Sa1="$(make_site)"; bash "$PUBLISH" "$Sa1" >/dev/null 2>&1
out="$(KOSMOS_PROMOTE_GATE_CMD="$GATE" GATE_RC_WANT=0 AGENT_RC_WANT=1 bash "$PROMOTE" "$Sa1" 2>&1)"; rc=$?
[ "$rc" = 1 ] && has "$out" "agent-spawn gate FAILED" && [ ! -f "$Sa1/dist/latest.json" ] && pass "promote: experience-ok but agent gate 1 (#2129) -> refuse, no promote" || bad "promote agent-gate-1 (rc=$rc, out=$out)"

# --force does NOT override a provably-broken agent gate (1), same as the experience gate.
out="$(KOSMOS_PROMOTE_GATE_CMD="$GATE" GATE_RC_WANT=0 AGENT_RC_WANT=1 bash "$PROMOTE" "$Sa1" --force 2>&1)"; rc=$?
[ "$rc" = 1 ] && [ ! -f "$Sa1/dist/latest.json" ] && pass "promote: agent gate 1 is NOT forceable" || bad "promote agent-gate-1-force (rc=$rc, out=$out)"

# agent gate cannot-tell (2) -> HOLD (exit 2), no promote; --force promotes on a hand check.
Sa2="$(make_site)"; bash "$PUBLISH" "$Sa2" >/dev/null 2>&1
out="$(KOSMOS_PROMOTE_GATE_CMD="$GATE" GATE_RC_WANT=0 AGENT_RC_WANT=2 bash "$PROMOTE" "$Sa2" 2>&1)"; rc=$?
[ "$rc" = 2 ] && [ ! -f "$Sa2/dist/latest.json" ] && pass "promote: agent gate 2 (cannot-tell) -> HOLD, no promote" || bad "promote agent-gate-2 (rc=$rc, out=$out)"
out="$(KOSMOS_PROMOTE_GATE_CMD="$GATE" GATE_RC_WANT=0 AGENT_RC_WANT=2 bash "$PROMOTE" "$Sa2" --force 2>&1)"; rc=$?
[ "$rc" = 0 ] && [ -f "$Sa2/dist/latest.json" ] && pass "promote: agent gate 2 + --force -> promote on hand check" || bad "promote agent-gate-2-force (rc=$rc, out=$out)"

# BOTH gates pass -> promote (the ordinary path, asserted explicitly with the agent gate present).
Sa0="$(make_site)"; bash "$PUBLISH" "$Sa0" >/dev/null 2>&1
out="$(KOSMOS_PROMOTE_GATE_CMD="$GATE" GATE_RC_WANT=0 AGENT_RC_WANT=0 bash "$PROMOTE" "$Sa0" 2>&1)"; rc=$?
[ "$rc" = 0 ] && has "$out" "agent-spawn gate PASSED" && [ -f "$Sa0/dist/latest.json" ] && pass "promote: both gates pass -> promote" || bad "promote both-gates (rc=$rc, out=$out)"

# the [port] is forwarded to the SECOND (agent) gate too, not only the experience gate.
Sap="$(make_site)"; bash "$PUBLISH" "$Sap" >/dev/null 2>&1
out="$(KOSMOS_PROMOTE_GATE_CMD="$GATE" GATE_RC_WANT=0 AGENT_RC_WANT=0 bash "$PROMOTE" "$Sap" 17777 2>&1)"; rc=$?
[ "$rc" = 0 ] && has "$out" "agent-gate-arg1:17777" && pass "promote: forwards [port] to the agent gate too" || bad "promote agent-gate port-forward (rc=$rc, out=$out)"

echo ""
if [ "$fail" = 0 ]; then echo "test-staging-channel-2036: ALL PASS"; else echo "test-staging-channel-2036: FAILURES above"; exit 1; fi
