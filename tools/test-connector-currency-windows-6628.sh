#!/bin/bash
# connector_currency_check for the Windows connector (#6628): the Windows build refuses a kosmos-tunnel.exe built
# before a change to its build inputs landed on kosmos-relay main, the same check the Mac cut runs (#3884). Its build
# script is kosmos-relay's tools/build-tunnel-release-windows.ps1, not the Mac one.
# Runs against a throwaway relay repo with a bare origin, so it needs no network and no real connector.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tools/lib/connector-provenance.sh
. tools/lib/connector-currency.sh
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/connector-currency-win.XXXXXX")"; trap 'rm -rf "$T"' EXIT
g(){ git -c user.name=t -c user.email=t@example.com -c commit.gpgsign=false "$@"; }
WINSCRIPT=tools/build-tunnel-release-windows.ps1

g init -q --bare -b main "$T/origin.git"
g init -q -b main "$T/relay"
mkdir -p "$T/relay/crates/tunnel" "$T/relay/crates/proto" "$T/relay/tools"
echo 1 > "$T/relay/crates/tunnel/lib.rs"; echo 1 > "$T/relay/crates/proto/lib.rs"
echo 1 > "$T/relay/Cargo.lock"; echo 1 > "$T/relay/Cargo.toml"
echo 1 > "$T/relay/tools/build-tunnel-release.sh"; echo 1 > "$T/relay/$WINSCRIPT"
g -C "$T/relay" add -A; g -C "$T/relay" commit -q -m "base"
g -C "$T/relay" remote add origin "$T/origin.git"; g -C "$T/relay" push -q origin main
BUILT="$(g -C "$T/relay" rev-parse HEAD)"

B="$T/kosmos-tunnel.exe"; printf 'MZ-STAND-IN\n' > "$B"
printf '%s\n' "$BUILT" > "$B.commit"; shasum -a 256 "$B" | awk '{print $1}' > "$B.sha256"

land(){ # <path> <subject>
  rm -rf "$T/other"; g clone -q "$T/origin.git" "$T/other"
  mkdir -p "$T/other/$(dirname "$1")"; echo "$RANDOM$RANDOM" >> "$T/other/$1"
  g -C "$T/other" add -A; g -C "$T/other" commit -q -m "$2"; g -C "$T/other" push -q origin main
}
reset_origin(){ g -C "$T/relay" push -q -f origin "${BUILT}:refs/heads/main"; }
check_rc(){ unset KOSMOS_ALLOW_STALE_TUNNEL; connector_currency_check "$B" "$T/relay" "$WINSCRIPT" 2>"$T/err"; }

# 1. pass: built from relay main
if check_rc; then ok "a Windows connector built from relay main is current"; else bad "a current Windows connector was refused: $(cat "$T/err")"; fi

# 2. refuse: a change to the Windows build script, named with the commit and the rebuild
land "$WINSCRIPT" "windows build: sign before the sidecars"
if check_rc; then bad "a change to $WINSCRIPT did not refuse"
else grep -q "STALE" "$T/err" && grep -q "windows build: sign before the sidecars" "$T/err" && grep -q -- "-File $WINSCRIPT -Sign <the signing script>" "$T/err" && grep -q "copy dist/kosmos-tunnel.exe with" "$T/err" && ! grep -q "both rustup targets" "$T/err" \
  && ok "a change to $WINSCRIPT refuses, names that commit and the Windows rebuild" || bad "wrong refusal for the Windows build script: $(cat "$T/err")"; fi

# 3. override: exactly 1 ships it on purpose and says what it skips; anything else still refuses
if KOSMOS_ALLOW_STALE_TUNNEL=1 connector_currency_check "$B" "$T/relay" "$WINSCRIPT" 2>"$T/err"; then
  grep -q "ON PURPOSE" "$T/err" && grep -q "windows build: sign" "$T/err" && ok "KOSMOS_ALLOW_STALE_TUNNEL=1 proceeds and lists what it ships without" || bad "override passed silently: $(cat "$T/err")"
else bad "the override still refused: $(cat "$T/err")"; fi
KOSMOS_ALLOW_STALE_TUNNEL=yes connector_currency_check "$B" "$T/relay" "$WINSCRIPT" 2>/dev/null && bad "an override other than exactly 1 was honoured" || ok "only KOSMOS_ALLOW_STALE_TUNNEL=1 overrides"

# 4. refuse: a tunnel change, the shared inputs count for Windows too
reset_origin; land crates/tunnel/lib.rs "tunnel fix"
if check_rc; then bad "a tunnel change did not refuse the Windows connector"
else grep -q "tunnel fix" "$T/err" && ok "a crates/tunnel change refuses the Windows connector" || bad "wrong refusal for a tunnel change: $(cat "$T/err")"; fi

# 5. the Mac build script is not a Windows input, and the default (no third argument) still treats it as one
reset_origin; land tools/build-tunnel-release.sh "mac build only"
if check_rc; then ok "a Mac-build-script change does not refuse the Windows connector"; else bad "a Mac-only build change refused the Windows connector: $(cat "$T/err")"; fi
if (unset KOSMOS_ALLOW_STALE_TUNNEL; connector_currency_check "$B" "$T/relay" 2>"$T/err"); then bad "CONTROL: the default inputs no longer include the Mac build script"
else grep -q "mac build only" "$T/err" && ok "CONTROL: with no third argument the Mac build script is still an input" || bad "wrong default refusal: $(cat "$T/err")"; fi

# 6. control: rebuilt from the new main, it is current again
reset_origin; land "$WINSCRIPT" "another windows build change"
g -C "$T/relay" fetch -q origin; NEW="$(g -C "$T/relay" rev-parse origin/main)"; printf '%s\n' "$NEW" > "$B.commit"
if check_rc; then ok "CONTROL: a Windows connector rebuilt from the new main is current again"; else bad "a rebuilt Windows connector was refused: $(cat "$T/err")"; fi

# 6b. a build script relay main does not have refuses as unknown, even with the override (a pathspec matching
# nothing would otherwise read as unchanged)
for ov in "" 1; do
  if KOSMOS_ALLOW_STALE_TUNNEL=$ov connector_currency_check "$B" "$T/relay" tools/no-such-build.ps1 2>"$T/err"; then bad "a build script missing from relay main was accepted (override '${ov}')"
  else grep -q "has no tools/no-such-build.ps1" "$T/err" && ok "a build script missing from relay main refuses as UNKNOWN (override '${ov}')" || bad "wrong refusal for a missing build script: $(cat "$T/err")"; fi
done

# 7. the Windows build runs it, after the provenance check and before the connector is staged, and exits on refusal
awk '/_connector_provenance_check "\$TUNNEL_BIN"/{p=NR}
     /^connector_currency_check "\$TUNNEL_BIN" "\$\{KOSMOS_RELAY_REPO:-\$HOME\/work\/kosmos-relay\}"/{c=NR}
     c && NR<=c+1 && /build-tunnel-release-windows\.ps1 \|\| exit 1/{w=NR}
     /^coordinator_floor_check "\$TUNNEL_BIN" "\$\{KOSMOS_RELAY_REPO:-\$HOME\/work\/kosmos-relay\}" .*coordinator-floor" \|\| exit 1$/{f=NR}
     /^connector_pe_signed "\$TUNNEL_BIN"/{q=NR}
     /cp "\$TUNNEL_BIN" "\$STAGE/{s=NR}
     END{ if (p && c && w && f && q && s && p<c && w<f && f<q && q<s) print "wired" }' tools/build-kosmos-windows.sh | grep -q wired \
  && ok "build-kosmos-windows.sh runs the check with the .ps1, || exit 1, after provenance, then the coordinator floor check, both before the signature check and staging" \
  || bad "build-kosmos-windows.sh does not run the currency check before it stages the connector"

echo "---"
[ "$FAILS" = 0 ] && echo "connector-currency-windows: all checks passed" || { echo "connector-currency-windows: $FAILS FAILED"; exit 1; }
