#!/bin/bash
# connector_provenance (#621): the commit comes from the binary's sidecars,
# and every way the sidecars can lie or be absent is a refusal, each named.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tools/lib/connector-provenance.sh
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/connector-provenance.XXXXXX")"; trap 'rm -rf "$T"' EXIT
B="$T/kosmos-tunnel"; printf 'MACHO-STAND-IN\n' > "$B"; chmod +x "$B"
SHA="$(shasum -a 256 "$B" | awk '{print $1}')"; C="0123456789abcdef0123456789abcdef01234567"
printf '%s\n' "$C" > "$B.commit"; printf '%s  kosmos-tunnel\n' "$SHA" > "$B.sha256"
out="$(connector_provenance "$B" 2>"$T/err")"; rc=$?
[ "$rc" = 0 ] && [ "$out" = "$C" ] && ok "matching sidecars: the commit is printed and it is the sidecar's" || bad "a good pair was refused or misread (rc $rc, '$out'): $(cat "$T/err")"
# CONTROLS, one per refusal.
rm "$B.commit"; connector_provenance "$B" >/dev/null 2>"$T/err" && bad "a missing .commit did not refuse" || { grep -q "no $B.commit" "$T/err" && ok "no .commit refuses and names the file and the remedy" || bad "wrong reason for a missing .commit: $(cat "$T/err")"; }
printf '%s\n' "$C" > "$B.commit"; rm "$B.sha256"; connector_provenance "$B" >/dev/null 2>"$T/err" && bad "a missing .sha256 did not refuse" || { grep -q "no $B.sha256" "$T/err" && ok "no .sha256 refuses" || bad "wrong reason for a missing .sha256: $(cat "$T/err")"; }
printf '%s  kosmos-tunnel\n' "0000000000000000000000000000000000000000000000000000000000000000" > "$B.sha256"; connector_provenance "$B" >/dev/null 2>"$T/err" && bad "a .sha256 naming other bytes did not refuse" || { grep -q "names other bytes" "$T/err" && ok "a .sha256 that names other bytes refuses (a stale or half-copied pair)" || bad "wrong reason for a mismatch: $(cat "$T/err")"; }
printf '%s  kosmos-tunnel\n' "$SHA" > "$B.sha256"; printf '%s-dirty\n' "$C" > "$B.commit"; connector_provenance "$B" >/dev/null 2>"$T/err" && bad "a dirty commit did not refuse" || { grep -q "DIRTY tree" "$T/err" && ok "a -dirty stamp refuses (bytes from no commit anyone can name)" || bad "wrong reason for dirty: $(cat "$T/err")"; }
printf 'not-a-sha\n' > "$B.commit"; connector_provenance "$B" >/dev/null 2>"$T/err" && bad "a malformed commit did not refuse" || { grep -q "40-hex" "$T/err" && ok "a malformed .commit refuses" || bad "wrong reason for malformed: $(cat "$T/err")"; }
printf '%s\n' "$C" > "$B.commit"; printf 'x' >> "$B"; connector_provenance "$B" >/dev/null 2>"$T/err" && bad "a changed binary beside an old .sha256 did not refuse" || { grep -q "names other bytes" "$T/err" && ok "CONTROL: the binary changing under its sidecars refuses (the sidecars describe bytes, not a name)" || bad "wrong reason after the binary changed: $(cat "$T/err")"; }
# the real connector on this Mac, when it is there: an integration line, skipped honestly otherwise.
printf '%s\n' "$C" > "$B.commit"; SHA="$(shasum -a 256 "$B" | awk '{print $1}')"; printf '%s\n' "$SHA" > "$B.sha256"
out="$(connector_provenance "$B" 2>"$T/err")"; rc=$?
[ "$rc" = 0 ] && [ "$out" = "$C" ] && ok "the relay build's own shape (bare hex, no file name) is read the same" || bad "a bare-hex .sha256 (the shape kosmos-relay writes) was refused or misread (rc $rc, '$out'): $(cat "$T/err")"
out="$(connector_provenance_sha "$B" 2>"$T/err")"; rc=$?
[ "$rc" = 0 ] && [ "$out" = "$SHA" ] && ok "connector_provenance_sha prints the sidecar's sha, the input's own bytes" || bad "connector_provenance_sha wrong (rc $rc, '$out'): $(cat "$T/err")"
printf 'SHA256 (kosmos-tunnel) = %s\n' "$SHA" > "$B.sha256"; connector_provenance "$B" >/dev/null 2>"$T/err" && bad "a .sha256 in another tool's shape was accepted" || { grep -q "64-hex" "$T/err" && ok "a .sha256 that is not shasum's shape refuses as malformed, not as a mismatch" || bad "wrong reason for a malformed .sha256: $(cat "$T/err")"; }
: > "$B.sha256"; connector_provenance "$B" >/dev/null 2>"$T/err" && bad "an empty .sha256 was accepted" || { grep -q "64-hex" "$T/err" && ok "an empty .sha256 refuses as malformed" || bad "wrong reason for an empty .sha256: $(cat "$T/err")"; }
printf '%s  kosmos-tunnel\n' "$SHA" > "$B.sha256"; cp "$B" "$T/copied-tunnel"; connector_provenance "$T/copied-tunnel" >/dev/null 2>"$T/err" && bad "a copied binary without its sidecars was accepted" || { grep -q "copy the .commit and .sha256" "$T/err" && ok "a copied binary without sidecars refuses and says to copy the sidecars with it" || bad "the copied-binary remedy is missing: $(cat "$T/err")"; }
R="${KOSMOS_TUNNEL_BIN:-$HOME/work/kosmos-relay/dist/kosmos-tunnel}"
if [ -f "$R" ]; then
  if out="$(connector_provenance "$R" 2>"$T/err")"; then ok "the connector on this Mac carries a clean stamp ($(printf '%s' "$out" | cut -c1-12))"; else echo "NOTE  the connector on this Mac has no clean stamp: $(cat "$T/err")"; fi
else echo "NOTE  no connector at $R on this machine; the integration line did not run"; fi
echo "connector-provenance: $FAILS failures"; [ "$FAILS" -eq 0 ]
