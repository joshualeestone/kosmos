#!/bin/bash
# connector_verbs_check (#718): the bundle build refuses a connector without
# mac-request once the phone-notifications gate is open, and only notes it in
# one line while the gate is closed.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tools/lib/connector-verbs.sh
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/connector-verbs.XXXXXX")"; trap 'rm -rf "$T"' EXIT

# Stand-in connectors: one that knows mac-request, one that answers like a pre-#103 build.
NEW="$T/new-tunnel"; printf '#!/bin/sh\n[ "$1" = mac-request ] && exit 0\nexit 2\n' > "$NEW"; chmod +x "$NEW"
OLD="$T/old-tunnel"; printf '#!/bin/sh\necho "error: unrecognized subcommand '"'"'$1'"'"'" >&2\nexit 2\n' > "$OLD"; chmod +x "$OLD"
OPEN="$T/open.js"; printf "const x = 1;\nconst PHONE_APP_CAN_RECEIVE = true;\nlet available = PHONE_APP_CAN_RECEIVE;\n" > "$OPEN"
SHUT="$T/shut.js"; printf "const PHONE_APP_CAN_RECEIVE = false;\n" > "$SHUT"

connector_verbs_check "$NEW" "$OPEN" 2>"$T/err" && [ ! -s "$T/err" ] && ok "gate open, connector knows mac-request: goes on silently" || bad "a good connector with the gate open was refused or noisy: $(cat "$T/err")"
connector_verbs_check "$NEW" "$SHUT" 2>"$T/err" && [ ! -s "$T/err" ] && ok "gate closed, connector knows mac-request: goes on silently" || bad "a good connector with the gate closed was refused or noisy: $(cat "$T/err")"

connector_verbs_check "$OLD" "$OPEN" 2>"$T/err" && bad "gate open with an old connector was NOT refused" || { grep -q "does not know 'mac-request'" "$T/err" && grep -q "build-tunnel-release.sh" "$T/err" && ok "gate open, old connector: refused, naming the verb and the rebuild" || bad "wrong refusal for an old connector: $(cat "$T/err")"; }

if connector_verbs_check "$OLD" "$SHUT" 2>"$T/err"; then
  n="$(wc -l < "$T/err" | tr -d ' ')"
  [ "$n" = 1 ] && grep -q "harmless until PHONE_APP_CAN_RECEIVE opens" "$T/err" && ok "gate closed, old connector: goes on with exactly one calm line" || bad "the closed-gate note is not one calm line ($n lines): $(cat "$T/err")"
else bad "gate closed with an old connector was refused; it must only note it"; fi

# The gate line must be read exactly; anything else refuses rather than guessing.
printf "const PHONE_APP_CAN_RECEIVE = process.env.X === '1';\n" > "$T/odd.js"
connector_verbs_check "$NEW" "$T/odd.js" 2>"$T/err" && bad "an unreadable gate line was accepted" || { grep -q "cannot read the phone-notifications ship gate" "$T/err" && ok "a reworded gate line refuses, naming the line it expects" || bad "wrong reason for an unreadable gate: $(cat "$T/err")"; }
connector_verbs_check "$NEW" "$T/nowhere.js" 2>"$T/err" && bad "a missing gate file was accepted" || ok "a missing gate file refuses"
printf "// const PHONE_APP_CAN_RECEIVE = true;\nconst PHONE_APP_CAN_RECEIVE = false;\n" > "$T/commented.js"
[ "$(connector_gate_value "$T/commented.js")" = false ] && ok "a commented-out line is not read as the gate" || bad "a commented-out declaration was read as the gate"

# The real gate in this checkout reads as a value (the declaration has not drifted from what this lib matches).
g="$(connector_gate_value engine/phonenotify.js)"
[ "$g" = true ] || [ "$g" = false ] && ok "engine/phonenotify.js's gate reads as '$g'" || bad "engine/phonenotify.js's gate line no longer matches; update tools/lib/connector-verbs.sh"

# The build's calling convention: a direct call under set -euo pipefail, its || branch taken on refusal.
if bash -c 'set -euo pipefail; . tools/lib/connector-verbs.sh; connector_verbs_check "$1" "$2" || exit 7; echo REACHED' _ "$OLD" "$OPEN" >"$T/out" 2>/dev/null; then bad "the build's convention went on past a refusal"; else [ "$?" = 7 ] && ! grep -q REACHED "$T/out" && ok "under errexit, a refusal takes the caller's || branch" || bad "the build's convention did not stop at the refusal"; fi

# The real connector on this Mac, when it is there: an integration line, reported but never failed.
R="${KOSMOS_TUNNEL_BIN:-$HOME/work/kosmos-relay/dist/kosmos-tunnel}"
if [ -x "$R" ]; then
  if "$R" mac-request --help >/dev/null 2>&1; then echo "NOTE  the connector at $R knows mac-request"; else echo "NOTE  the connector at $R predates mac-request (rebuild before the gate opens)"; fi
else echo "NOTE  no connector at $R on this machine; the integration line did not run"; fi
echo "connector-verbs: $FAILS failures"; [ "$FAILS" -eq 0 ]
