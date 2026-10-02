#!/bin/bash
# coordinator_floor_check (#5037): a cut refuses a connector that carries a coordinator-first relay change
# (tools/coordinator-floor) while the coordinator serving traffic does not. A throwaway relay repo, a
# stand-in connector, and the coordinator's /v1/meta served from a file:// URL, so no network.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tools/lib/connector-provenance.sh
. tools/lib/coordinator-floor.sh
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/coordinator-floor.XXXXXX")"; trap 'rm -rf "$T"' EXIT
export KOSMOS_COORDINATOR_RETRIES=0   # the file:// "unreadable" arms would otherwise sleep through retries
g(){ git -c user.name=t -c user.email=t@example.com -c commit.gpgsign=false "$@"; }

# The relay history: OLD (before the change), FLOOR (the coordinator-first change), NEWER (after it).
g init -q -b main "$T/relay"
commit(){ echo "$1" >> "$T/relay/f"; g -C "$T/relay" add -A; g -C "$T/relay" commit -q -m "$1"; g -C "$T/relay" rev-parse HEAD; }
OLD="$(commit old)"; FLOOR="$(commit floor)"; NEWER="$(commit newer)"
printf '# comment\n\n%s the coordinator signs the account (test)\n' "$FLOOR" > "$T/floor"

connector(){ # <relay commit>: a stand-in connector with its provenance sidecars
  B="$T/kosmos-tunnel"; printf 'MACHO-%s\n' "$1" > "$B"; chmod +x "$B"
  printf '%s\n' "$1" > "$B.commit"; shasum -a 256 "$B" | awk '{print $1}' > "$B.sha256"
}
coordinator(){ # <build> : serve {"build": <build>} as /v1/meta; "none" = no meta at all
  rm -rf "$T/coord"; mkdir -p "$T/coord/v1"
  [ "$1" = none ] || printf '{"bought_addresses":false,"build":"%s","domain":"kosmosplus.com"}' "$1" > "$T/coord/v1/meta"
}
run(){ unset KOSMOS_ALLOW_COORDINATOR_BEHIND; KOSMOS_COORDINATOR_URL="file://$T/coord" coordinator_floor_check "$T/kosmos-tunnel" "$T/relay" "$T/floor" 2>"$T/err"; }

# 1. a connector BELOW the floor: the coordinator is not asked (CONTROL: its meta is absent, which would refuse)
connector "$OLD"; coordinator none
run && ok "a connector without the floor change passes without asking the coordinator" || bad "a pre-floor connector was refused: $(cat "$T/err")"

# 2. THE CASE: connector carries the floor change, coordinator is below it -> refused, names the change
connector "$NEWER"; coordinator "${OLD:0:8}"
if run; then bad "a connector carrying the floor change shipped beside an older coordinator (the #4869 shape)"
else grep -q "needs the coordinator to carry" "$T/err" && grep -q "signs the account" "$T/err" && grep -q "${OLD:0:8}" "$T/err" \
  && ok "a coordinator below the floor refuses, naming the change and the coordinator's build" || bad "wrong refusal: $(cat "$T/err")"; fi

# 3. CONTROL for 2: the coordinator at the floor, and above it, pass (short and full build ids)
coordinator "${FLOOR:0:8}"; run && ok "a coordinator AT the floor (short build id) passes" || bad "at-floor coordinator refused: $(cat "$T/err")"
coordinator "$NEWER"; run && ok "a coordinator ABOVE the floor (full build id) passes" || bad "above-floor coordinator refused: $(cat "$T/err")"
connector "$FLOOR"; coordinator "${OLD:0:8}"
behind(){ grep -q "needs the coordinator to carry" "$T/err" && grep -q "signs the account" "$T/err"; }   # the coordinator-behind arm, nothing else
run && bad "a connector built exactly at the floor commit was not checked" || { behind && ok "a connector built exactly at the floor commit is checked too" || bad "wrong refusal at the floor: $(cat "$T/err")"; }
# 3b. review 1: relay squash-merges, so a connector built from the PRE-SQUASH branch carries the change without
# descending from the floor commit. It must be asked about, not waved through (the gate used to pass it).
g -C "$T/relay" checkout -q -b signacct "$OLD"; echo floor-on-branch >> "$T/relay/g"; g -C "$T/relay" add -A; g -C "$T/relay" commit -q -m "branch copy of the floor change"
BRANCH="$(g -C "$T/relay" rev-parse HEAD)"; g -C "$T/relay" checkout -q main
connector "$BRANCH"; coordinator "${OLD:0:8}"
run && bad "a connector from the pre-squash branch passed without asking the coordinator" || { behind && ok "a connector off the floor's line (a pre-squash branch) is asked about, and refused beside an older coordinator" || bad "wrong refusal for the branch connector: $(cat "$T/err")"; }
coordinator "${FLOOR:0:8}"; run && ok "CONTROL: the same branch connector passes once the coordinator carries the floor" || bad "branch connector refused beside an at-floor coordinator: $(cat "$T/err")"

# 4. fails closed: no meta, no build in it, a build the relay does not have, a floor commit it does not have
connector "$NEWER"
coordinator none; run && bad "an unreadable /v1/meta was waved on" || { grep -q "UNKNOWN" "$T/err" && ok "an unreadable /v1/meta refuses (unknown is not assumed)" || bad "wrong refusal for no meta: $(cat "$T/err")"; }
rm -rf "$T/coord"; mkdir -p "$T/coord/v1"; printf '<html>gateway</html>' > "$T/coord/v1/meta"
run && bad "a meta that is not JSON was waved on" || { grep -q "not with JSON" "$T/err" && ok "a meta that is not JSON refuses, said as not JSON" || bad "wrong refusal for non-JSON meta: $(cat "$T/err")"; }
rm -rf "$T/coord"; mkdir -p "$T/coord/v1"; printf '{"domain":"x"}' > "$T/coord/v1/meta"
run && bad "a meta with no build was waved on" || { grep -q "names no build" "$T/err" && ok "a meta with no build refuses" || bad "wrong refusal for no build: $(cat "$T/err")"; }
coordinator deadbeef0; run && bad "a build the relay does not have was waved on" || { grep -q "deployed from a branch" "$T/err" && ok "a build the relay checkout does not have refuses, naming the branch-deploy case" || bad "wrong refusal for an unknown build: $(cat "$T/err")"; }
rm -rf "$T/coord"; mkdir -p "$T/coord/v1"; printf '{"build":"V1.2-release"}' > "$T/coord/v1/meta"
run && bad "a malformed build was waved on" || { grep -q "not a commit id ('V1.2-release')" "$T/err" && ok "a malformed build refuses, naming the value" || bad "wrong refusal for a malformed build: $(cat "$T/err")"; }
# A floor file with a CRLF, a tab separator and an indented comment is still read (CONTROL: an at-floor coordinator passes it).
printf '  # indented comment\r\n%s\tthe coordinator signs the account (test)\r\n' "$FLOOR" > "$T/floor-crlf"
coordinator "${OLD:0:8}"
KOSMOS_COORDINATOR_URL="file://$T/coord" coordinator_floor_check "$T/kosmos-tunnel" "$T/relay" "$T/floor-crlf" 2>"$T/err" && bad "a CRLF/tab floor line was not read (the behind coordinator passed)" || { behind && ok "a floor line with CRLF and a tab is read (behind refuses on it)" || bad "wrong refusal on the CRLF floor: $(cat "$T/err")"; }
coordinator "${FLOOR:0:8}"
KOSMOS_COORDINATOR_URL="file://$T/coord" coordinator_floor_check "$T/kosmos-tunnel" "$T/relay" "$T/floor-crlf" 2>"$T/err" && ok "CONTROL: the same CRLF floor passes an at-floor coordinator" || bad "CRLF floor refused an at-floor coordinator: $(cat "$T/err")"
KOSMOS_COORDINATOR_RETRIES=two KOSMOS_COORDINATOR_URL="file://$T/coord" coordinator_floor_check "$T/kosmos-tunnel" "$T/relay" "$T/floor" 2>"$T/err" && bad "a non-numeric retries value was used" || { grep -q "must be a number" "$T/err" && ok "a non-numeric KOSMOS_COORDINATOR_RETRIES refuses, said as such" || bad "wrong refusal for bad retries: $(cat "$T/err")"; }
coordinator unknown; run && bad "an unstamped (unknown) build was waved on" || { grep -q "UNSTAMPED" "$T/err" && ok "an unstamped coordinator build refuses, said as unstamped" || bad "wrong refusal for an unknown build word: $(cat "$T/err")"; }
coordinator "${NEWER:0:8}-dirty"; run && bad "a dirty coordinator build was waved on" || { grep -q "DIRTY build" "$T/err" && ok "a dirty coordinator build refuses, said as dirty" || bad "wrong refusal for a dirty build: $(cat "$T/err")"; }
coordinator "$NEWER"; printf '%s why\n' "0123456789012345678901234567890123456789" > "$T/floor2"
KOSMOS_COORDINATOR_URL="file://$T/coord" coordinator_floor_check "$T/kosmos-tunnel" "$T/relay" "$T/floor2" 2>"$T/err" \
  && bad "a floor commit the relay does not have was waved on" || { grep -q "the floor names" "$T/err" && ok "a floor naming a commit the relay does not have refuses" || bad "wrong refusal for a bad floor: $(cat "$T/err")"; }

# 5. the override ships anyway and says what it skips; only exactly 1 counts
coordinator "${OLD:0:8}"
if KOSMOS_ALLOW_COORDINATOR_BEHIND=1 KOSMOS_COORDINATOR_URL="file://$T/coord" coordinator_floor_check "$T/kosmos-tunnel" "$T/relay" "$T/floor" 2>"$T/err"; then
  grep -q "ON PURPOSE" "$T/err" && grep -q "signs the account" "$T/err" && ok "KOSMOS_ALLOW_COORDINATOR_BEHIND=1 proceeds and names what it skips" || bad "override passed silently: $(cat "$T/err")"
else bad "the override still refused: $(cat "$T/err")"; fi
KOSMOS_ALLOW_COORDINATOR_BEHIND=yes KOSMOS_COORDINATOR_URL="file://$T/coord" coordinator_floor_check "$T/kosmos-tunnel" "$T/relay" "$T/floor" 2>"$T/err"; rc=$?
[ "$rc" = 1 ] && behind && ok "only KOSMOS_ALLOW_COORDINATOR_BEHIND=1 overrides (=yes refuses on the behind arm)" || bad "=yes: rc=$rc, not the behind refusal: $(cat "$T/err")"
# The override covers a coordinator KNOWN to be behind, never an unknown one.
coordinator none
KOSMOS_ALLOW_COORDINATOR_BEHIND=1 KOSMOS_COORDINATOR_URL="file://$T/coord" coordinator_floor_check "$T/kosmos-tunnel" "$T/relay" "$T/floor" 2>"$T/err"; rc=$?
[ "$rc" = 1 ] && grep -q "UNKNOWN" "$T/err" && ok "the override does not cover an unreadable /v1/meta" || bad "override waved an unreadable meta: rc=$rc $(cat "$T/err")"
coordinator deadbeef0
KOSMOS_ALLOW_COORDINATOR_BEHIND=1 KOSMOS_COORDINATOR_URL="file://$T/coord" coordinator_floor_check "$T/kosmos-tunnel" "$T/relay" "$T/floor" 2>"$T/err"; rc=$?
[ "$rc" = 1 ] && grep -q "deployed from a branch" "$T/err" && ok "the override does not cover a build the checkout lacks" || bad "override waved an unknown build: rc=$rc $(cat "$T/err")"
coordinator "${NEWER:0:8}-dirty"
KOSMOS_ALLOW_COORDINATOR_BEHIND=1 KOSMOS_COORDINATOR_URL="file://$T/coord" coordinator_floor_check "$T/kosmos-tunnel" "$T/relay" "$T/floor" 2>"$T/err"; rc=$?
[ "$rc" = 1 ] && grep -q "DIRTY build" "$T/err" && ok "the override does not cover a dirty build" || bad "override waved a dirty build: rc=$rc $(cat "$T/err")"

# 6. the committed floor file and the release.sh wiring
REAL_FLOOR="$(grep -v '^#' tools/coordinator-floor | awk 'NF{print $1}')"
if [ -z "$REAL_FLOOR" ]; then bad "tools/coordinator-floor holds no commit"
elif printf '%s\n' "$REAL_FLOOR" | grep -qvE '^[0-9a-f]{40}$'; then bad "tools/coordinator-floor has a line that is not a full sha"
else ok "tools/coordinator-floor holds full shas only"; fi
printf '%s\n' "$REAL_FLOOR" | grep -qx "534f36980f2f364b178193eb54958329d3daf6d5" && ok "tools/coordinator-floor carries #4869 (534f36980)" || bad "tools/coordinator-floor lacks #4869"
grep -qF '"${KOSMOS_RELAY_REPO:-$HOME/work/kosmos-relay}" "$REPO/tools/coordinator-floor" || exit 1' tools/release.sh && grep -qF '. "$REPO/tools/lib/coordinator-floor.sh"' tools/release.sh \
  && ok "release.sh sources the check and runs it (step 1d2)" || bad "release.sh does not run coordinator_floor_check"
# It runs AFTER step 1d (which fetches the relay checkout it reads) and BEFORE the version bump (step 2).
d="$(grep -n 'connector_currency_check "\${KOSMOS_TUNNEL_BIN' tools/release.sh | head -1 | cut -d: -f1)"
a="$(grep -n 'coordinator_floor_check "\${KOSMOS_TUNNEL_BIN' tools/release.sh | head -1 | cut -d: -f1)"; b="$(grep -n 'step "== 2. the version, in one place ==' tools/release.sh | head -1 | cut -d: -f1)"
[ -n "$d" ] && [ -n "$a" ] && [ -n "$b" ] && [ "$d" -lt "$a" ] && [ "$a" -lt "$b" ] && ok "step 1d2 runs after 1d's fetch and before the version bump" || bad "step order wrong (1d $d, 1d2 $a, bump $b)"
# The default coordinator is the one installs talk to (engine/remote.js DEFAULT_COORDINATOR); a drift would ask the wrong one.
DC="$(sed -n "s/^const DEFAULT_COORDINATOR = '\([^']*\)';.*/\1/p" engine/remote.js)"
[ -n "$DC" ] && grep -qF "KOSMOS_COORDINATOR_URL:-$DC}" tools/lib/coordinator-floor.sh && ok "the default coordinator matches engine/remote.js ($DC)" || bad "the default coordinator drifted from engine/remote.js ($DC)"

echo ""
[ "$FAILS" = 0 ] && echo "test-coordinator-floor-5037: ALL PASS" || { echo "test-coordinator-floor-5037: $FAILS FAILED"; exit 1; }
