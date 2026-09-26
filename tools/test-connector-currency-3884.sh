#!/bin/bash
# connector_currency_check (#3884): a cut refuses a Plus connector built before a change to
# the tunnel's build inputs landed on kosmos-relay main, and says which commits it lacks.
# Runs against a throwaway relay repo with a bare origin, so it needs no network and no
# real connector.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tools/lib/connector-provenance.sh
. tools/lib/connector-currency.sh
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/connector-currency.XXXXXX")"; trap 'rm -rf "$T"' EXIT
g(){ git -c user.name=t -c user.email=t@example.com -c commit.gpgsign=false "$@"; }

# The relay: a bare origin and a working clone of it, holding the tunnel's inputs and a
# coordinator file that is NOT one of them.
g init -q --bare -b main "$T/origin.git"
g init -q -b main "$T/relay"
mkdir -p "$T/relay/crates/tunnel" "$T/relay/crates/proto" "$T/relay/coordinator"
echo 1 > "$T/relay/crates/tunnel/lib.rs"; echo 1 > "$T/relay/crates/proto/lib.rs"
echo 1 > "$T/relay/coordinator/lib.rs"; echo 1 > "$T/relay/Cargo.lock"; echo 1 > "$T/relay/Cargo.toml"
g -C "$T/relay" add -A; g -C "$T/relay" commit -q -m "base"
g -C "$T/relay" remote add origin "$T/origin.git"; g -C "$T/relay" push -q origin main
BUILT="$(g -C "$T/relay" rev-parse HEAD)"

# The connector, built from BUILT, with its sidecars.
B="$T/kosmos-tunnel"; printf 'MACHO-STAND-IN\n' > "$B"; chmod +x "$B"
printf '%s\n' "$BUILT" > "$B.commit"; shasum -a 256 "$B" | awk '{print $1}' > "$B.sha256"

# Land a commit on origin main from a second clone, as a merge elsewhere would.
land(){ # <path> <subject>
  rm -rf "$T/other"; g clone -q "$T/origin.git" "$T/other"
  mkdir -p "$T/other/$(dirname "$1")"; echo "$RANDOM$RANDOM" >> "$T/other/$1"
  g -C "$T/other" add -A; g -C "$T/other" commit -q -m "$2"; g -C "$T/other" push -q origin main
}
reset_origin(){ g -C "$T/relay" push -q -f origin "${BUILT}:refs/heads/main"; }
check_rc(){ unset KOSMOS_ALLOW_STALE_TUNNEL; connector_currency_check "$B" "$T/relay" 2>"$T/err"; }

# 1. current: origin main is the commit the connector was built from
if check_rc; then ok "a connector built from relay main is current"; else bad "a current connector was refused: $(cat "$T/err")"; fi

# 2. a change OUTSIDE the tunnel's inputs does not ask for a rebuild
land coordinator/lib.rs "coordinator-only change"
if check_rc; then ok "a coordinator-only change on main does not refuse"; else bad "a coordinator-only change refused: $(cat "$T/err")"; fi

# 3. a tunnel change refuses, names the missing commit and the rebuild
land crates/tunnel/lib.rs "tunnel-hsts: every answer carries HSTS"
if check_rc; then bad "a connector missing a tunnel commit was NOT refused (the 0.6.95 shape)"
else grep -q "STALE" "$T/err" && grep -q "tunnel-hsts: every answer carries HSTS" "$T/err" && grep -q "build-tunnel-release.sh" "$T/err" \
  && ! grep -q "coordinator-only change" "$T/err" \
  && ok "a tunnel commit on main refuses, names that commit (not the coordinator one) and the rebuild" \
  || bad "wrong refusal for a stale connector: $(cat "$T/err")"; fi

# 4. the override ships it on purpose, and still says what it skips
if KOSMOS_ALLOW_STALE_TUNNEL=1 connector_currency_check "$B" "$T/relay" 2>"$T/err"; then
  grep -q "ON PURPOSE" "$T/err" && grep -q "tunnel-hsts" "$T/err" && ok "KOSMOS_ALLOW_STALE_TUNNEL=1 proceeds and lists what it ships without" || bad "override passed silently: $(cat "$T/err")"
else bad "the override still refused: $(cat "$T/err")"; fi
KOSMOS_ALLOW_STALE_TUNNEL=yes connector_currency_check "$B" "$T/relay" 2>/dev/null && bad "an override other than exactly 1 was honoured" || ok "only KOSMOS_ALLOW_STALE_TUNNEL=1 overrides"

# 5. the other inputs: the path dependency, the lockfile, the workspace manifest
for f in crates/proto/lib.rs Cargo.lock Cargo.toml; do
  reset_origin; land "$f" "change to $f"
  if check_rc; then bad "a change to $f did not refuse"; else grep -q "change to $f" "$T/err" && ok "a change to $f refuses" || bad "wrong refusal for $f: $(cat "$T/err")"; fi
done

# 5b. the build script is an input; tests-only changes are not
reset_origin; land tools/build-tunnel-release.sh "build script change"
if check_rc; then bad "a change to the build script did not refuse"; else grep -q "build script change" "$T/err" && ok "a change to tools/build-tunnel-release.sh refuses" || bad "wrong refusal for the build script: $(cat "$T/err")"; fi
reset_origin; land crates/tunnel/tests/page.rs "tunnel tests only"
if check_rc; then ok "a tests-only change under crates/tunnel/tests does not refuse"; else bad "a tests-only change refused: $(cat "$T/err")"; fi

# 5c. the relay checkout on another branch, with a fetch refspec that does NOT cover main
# (review 1): origin/main must still be brought up to date, or a stale connector passes.
g -C "$T/relay" fetch -q origin; g -C "$T/relay" checkout -q -b feature
g -C "$T/relay" config remote.origin.fetch '+refs/heads/feature:refs/remotes/origin/feature'
land crates/tunnel/lib.rs "tunnel fix while the checkout is narrowed"
if check_rc; then bad "a narrowed refspec hid a tunnel commit (false green)"
else grep -q "tunnel fix while the checkout is narrowed" "$T/err" && ok "a narrowed refspec and a non-main checkout still see relay main" || bad "wrong refusal with a narrowed refspec: $(cat "$T/err")"; fi
g -C "$T/relay" config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'; g -C "$T/relay" checkout -q main

# 6. a rebuild from the new main clears it (the CONTROL that a refusal is about currency)
NEW="$(g -C "$T/relay" rev-parse origin/main)"; printf '%s\n' "$NEW" > "$B.commit"
if check_rc; then ok "CONTROL: a connector rebuilt from the new main is current again"; else bad "a rebuilt connector was refused: $(cat "$T/err")"; fi
printf '%s\n' "$BUILT" > "$B.commit"

# 7. fails closed: origin cannot be fetched
g -C "$T/relay" remote set-url origin "$T/no-such-origin.git"
if check_rc; then bad "an unfetchable origin was treated as current"
else grep -q "UNKNOWN" "$T/err" && ok "an unfetchable origin refuses as UNKNOWN, not current" || bad "wrong reason for a fetch failure: $(cat "$T/err")"; fi
g -C "$T/relay" remote set-url origin "$T/origin.git"

# 8. a commit the relay checkout does not have
printf '%s\n' "0123456789abcdef0123456789abcdef01234567" > "$B.commit"
if check_rc; then bad "a connector built from an unknown commit was accepted"
else grep -q "not in $T/relay" "$T/err" && ok "a connector built from a commit the relay does not have refuses" || bad "wrong reason for an unknown commit: $(cat "$T/err")"; fi
printf '%s\n' "$BUILT" > "$B.commit"

# 9. not a git checkout
if connector_currency_check "$B" "$T" 2>"$T/err"; then bad "a non-checkout relay path was accepted"
else grep -q "not a git checkout" "$T/err" && ok "a relay path that is not a checkout refuses" || bad "wrong reason for a non-checkout: $(cat "$T/err")"; fi

# 10. the provenance refusals still come first (no sidecar = no currency answer)
rm "$B.commit"
if check_rc; then bad "a connector with no .commit was accepted"
else grep -q "connector_provenance: no $B.commit" "$T/err" && ok "a missing .commit refuses through the provenance check" || bad "wrong reason with no sidecar: $(cat "$T/err")"; fi

# 11. the release wires it before the bump
awk '/step "== 1d\. the Plus connector is current/{s=1} /step "== 2\. the version/{exit} s&&/connector_currency_check/{c=NR} s&&c&&NR<=c+1&&/\|\| exit 1/{print "wired"; exit}' tools/release.sh | grep -q wired \
  && ok "release.sh runs connector_currency_check in step 1d with || exit 1, before step 2's bump" || bad "release.sh does not run the check in 1d before the bump"

echo "---"
[ "$FAILS" = 0 ] && echo "connector-currency: all checks passed" || { echo "connector-currency: $FAILS FAILED"; exit 1; }
