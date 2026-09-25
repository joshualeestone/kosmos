#!/bin/bash
# connector_verbs_check (#718): the bundle build refuses a connector without
# mac-request once the phone-notifications gate is open, and only notes it in
# one line while the gate is closed.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tools/lib/connector-verbs.sh
FAILS=0; PASSES=0; ok(){ echo "PASS  $1"; PASSES=$((PASSES+1)); }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/connector-verbs.XXXXXX")"; trap 'rm -rf "$T"' EXIT

# Stand-in connectors: one that knows mac-request, one that answers like a pre-#103 build.
NEW="$T/new-tunnel"; printf '#!/bin/sh\n[ "$1" = mac-request ] && [ "$2" = --help ] && exit 0\nexit 3\n' > "$NEW"; chmod +x "$NEW"
OLD="$T/old-tunnel"; printf '#!/bin/sh\necho "error: unrecognized subcommand '"'"'$1'"'"'" >&2\nexit 2\n' > "$OLD"; chmod +x "$OLD"
OPEN="$T/open.js"; printf "const x = 1;\nconst PHONE_APP_CAN_RECEIVE = true;\nlet available = PHONE_APP_CAN_RECEIVE;\n" > "$OPEN"
SHUT="$T/shut.js"; printf "const PHONE_APP_CAN_RECEIVE = false;\n" > "$SHUT"

connector_verbs_check "$NEW" "$OPEN" 2>"$T/err" && [ ! -s "$T/err" ] && ok "gate open, connector knows mac-request: goes on silently" || bad "a good connector with the gate open was refused or noisy: $(cat "$T/err")"
connector_verbs_check "$NEW" "$SHUT" 2>"$T/err" && [ ! -s "$T/err" ] && ok "gate closed, connector knows mac-request: goes on silently" || bad "a good connector with the gate closed was refused or noisy: $(cat "$T/err")"

connector_verbs_check "$OLD" "$OPEN" 2>"$T/err" && bad "gate open with an old connector was NOT refused" || { grep -q "does not know 'mac-request'" "$T/err" && grep -q "build-tunnel-release.sh" "$T/err" && ok "gate open, old connector: refused, naming the verb and the rebuild" || bad "wrong refusal for an old connector: $(cat "$T/err")"; }

if connector_verbs_check "$OLD" "$SHUT" 2>"$T/err"; then
  n="$(wc -l < "$T/err" | tr -d ' ')"
  [ "$n" = 1 ] && grep -q "predates mac-request, so the Plus standing refresh and update announce stay unsigned-broken as before (#3626)" "$T/err" && ok "gate closed, old connector: goes on with exactly one line saying what stays inactive" || bad "the closed-gate note is not one calm line ($n lines): $(cat "$T/err")"
else bad "gate closed with an old connector was refused; it must only note it"; fi

# The gate line must be read exactly; anything else refuses rather than guessing.
printf "const PHONE_APP_CAN_RECEIVE = process.env.X === '1';\n" > "$T/odd.js"
connector_verbs_check "$NEW" "$T/odd.js" 2>"$T/err" && bad "an unreadable gate line was accepted" || { grep -q "cannot read the phone-notifications ship gate" "$T/err" && ok "a reworded gate line refuses, naming the line it expects" || bad "wrong reason for an unreadable gate: $(cat "$T/err")"; }
connector_verbs_check "$NEW" "$T/nowhere.js" 2>"$T/err" && bad "a missing gate file was accepted" || { grep -q "cannot read the phone-notifications ship gate" "$T/err" && ok "a missing gate file refuses, for that reason" || bad "wrong reason for a missing gate file: $(cat "$T/err")"; }

# A connector that cannot be run is not evidence it is old: its own reason, never "rebuild the relay".
NOX="$T/noexec-tunnel"; cp "$NEW" "$NOX"; chmod -x "$NOX"
connector_verbs_check "$NOX" "$OPEN" 2>"$T/err" && bad "gate open, a non-executable connector was accepted" || { grep -q "could not check" "$T/err" && grep -q "not executable" "$T/err" && ! grep -q "build-tunnel-release" "$T/err" && ok "gate open, a non-executable connector refuses as unrunnable, not as old" || bad "wrong reason for a non-executable connector: $(cat "$T/err")"; }
CRASH="$T/crash-tunnel"; printf '#!/bin/sh\necho "Segmentation fault" >&2\nexit 139\n' > "$CRASH"; chmod +x "$CRASH"
connector_verbs_check "$CRASH" "$OPEN" 2>"$T/err" && bad "gate open, a crashing connector was accepted" || { grep -q "exited 139" "$T/err" && ! grep -q "does not know" "$T/err" && ok "gate open, a crash refuses naming its exit, not as old" || bad "wrong reason for a crash: $(cat "$T/err")"; }
if connector_verbs_check "$CRASH" "$SHUT" 2>"$T/err"; then [ "$(wc -l < "$T/err" | tr -d ' ')" = 1 ] && grep -q "could not check" "$T/err" && grep -q "stay unsigned-broken as before" "$T/err" && ok "gate closed, a crash is one line and the build goes on" || bad "closed-gate crash note wrong: $(cat "$T/err")"; else bad "gate closed, a crashing connector was refused"; fi
EXIT2="$T/other-exit2"; printf '#!/bin/sh\necho "error: the argument --coordinator is required" >&2\nexit 2\n' > "$EXIT2"; chmod +x "$EXIT2"
connector_verbs_check "$EXIT2" "$OPEN" 2>"$T/err" && bad "an exit 2 without unrecognized subcommand was accepted" || { grep -q "could not check" "$T/err" && ok "exit 2 for another reason is not read as old" || bad "exit 2 misread: $(cat "$T/err")"; }
HANG="$T/hang-tunnel"; printf '#!/bin/sh\nexec sleep 60\n' > "$HANG"; chmod +x "$HANG"
start=$(date +%s); CONNECTOR_PROBE_SECONDS=2 connector_verbs_check "$HANG" "$OPEN" 2>"$T/err"; took=$(( $(date +%s) - start ))
[ "$took" -lt 10 ] && grep -q "could not check" "$T/err" && ok "a hanging connector is cut off by the bound (${took}s) and refused as unrunnable" || bad "a hang was not bounded (${took}s): $(cat "$T/err")"
# A bound of 0 or junk must not switch the bound off (perl's alarm 0 means "no alarm").
for v in 0 00 -3 abc 2.5 ""; do [ "$(CONNECTOR_PROBE_SECONDS="$v" connector_probe_seconds)" = 20 ] || bad "CONNECTOR_PROBE_SECONDS='$v' was not replaced by 20"; done
[ "$(CONNECTOR_PROBE_SECONDS=7 connector_probe_seconds)" = 7 ] && [ "$(unset CONNECTOR_PROBE_SECONDS; connector_probe_seconds)" = 20 ] && ok "the bound: 0, 00, negative, junk and empty fall back to 20; a positive whole number is kept" || bad "the bound sanitiser is wrong"
# A connector that exits 142 by itself is not reported as a timeout.
E142="$T/exit142-tunnel"; printf '#!/bin/sh\nexit 142\n' > "$E142"; chmod +x "$E142"
case "$(connector_mac_request_probe "$E142")" in *"exited 142"*) ok "a connector's own exit 142 is not read as a timeout" ;; *) bad "exit 142 misread: $(connector_mac_request_probe "$E142")" ;; esac

# A connector whose CHILD hangs (no exec): the bound must kill the whole group, not only the shell.
KID="$T/child-hang-tunnel"; printf '#!/bin/sh\nsleep 60 &\necho $! > "%s"\nwait\n' "$T/kid.pid" > "$KID"; chmod +x "$KID"
start=$(date +%s); CONNECTOR_PROBE_SECONDS=2 connector_verbs_check "$KID" "$OPEN" 2>"$T/err"; took=$(( $(date +%s) - start ))
[ "$took" -lt 10 ] && grep -q "did not answer within 2 seconds" "$T/err" && ok "a connector whose child hangs is also cut off (${took}s), naming the time limit" || bad "a hanging child was not bounded (${took}s): $(cat "$T/err")"
if [ -s "$T/kid.pid" ]; then
  kill -0 "$(cat "$T/kid.pid")" 2>/dev/null && { bad "the hung connector's child outlived the bound"; kill "$(cat "$T/kid.pid")" 2>/dev/null; } || ok "the timed-out connector's child process is gone too"
else bad "the child-hang stand-in never recorded its child (the check above proved nothing)"; fi
printf "// const PHONE_APP_CAN_RECEIVE = true;\nconst PHONE_APP_CAN_RECEIVE = false;\n" > "$T/commented.js"
[ "$(connector_gate_value "$T/commented.js")" = false ] && ok "a commented-out line is not read as the gate" || bad "a commented-out declaration was read as the gate"

# The gate reader called bare under set -e with no match still returns (prints nothing).
if bash -c 'set -euo pipefail; . tools/lib/connector-verbs.sh; connector_gate_value "$1"; echo REACHED' _ "$T/odd.js" 2>/dev/null | grep -qx REACHED; then ok "the gate reader called bare under set -e survives a file with no gate line"; else bad "the gate reader aborted a bare set -e caller"; fi

# The real gate in this checkout reads as a value (the declaration has not drifted from what this lib matches).
g="$(connector_gate_value engine/phonenotify.js)"
[ "$g" = true ] || [ "$g" = false ] && ok "engine/phonenotify.js's gate reads as '$g'" || bad "engine/phonenotify.js's gate line no longer matches; update tools/lib/connector-verbs.sh"

# The build's calling convention: a direct call under set -euo pipefail, its || branch taken on refusal.
if bash -c 'set -euo pipefail; . tools/lib/connector-verbs.sh; connector_verbs_check "$1" "$2" || exit 7; echo REACHED' _ "$OLD" "$OPEN" >"$T/out" 2>/dev/null; then bad "the build's convention went on past a refusal"; else [ "$?" = 7 ] && ! grep -q REACHED "$T/out" && ok "under errexit, a refusal takes the caller's || branch" || bad "the build's convention did not stop at the refusal"; fi

# The probe called directly as a bare statement under set -e: a failing connector must still
# print its verdict and let the caller go on. (Through connector_verbs_check the probe runs
# inside $( ), where bash suspends errexit, so only a direct call can show this.)
if bash -c 'set -euo pipefail; . tools/lib/connector-verbs.sh; connector_mac_request_probe "$1"; echo REACHED' _ "$OLD" >"$T/out" 2>/dev/null && grep -qx old "$T/out" && grep -q REACHED "$T/out"; then ok "the probe called bare under set -e reports 'old' and the caller goes on"; else bad "the probe aborted a bare set -e caller: $(cat "$T/out")"; fi
connector_verbs_check "$T/no-such-tunnel" "$OPEN" 2>"$T/err" && bad "a missing connector was accepted" || { grep -q "there is no file at" "$T/err" && ok "a missing connector is named as missing, not as not executable" || bad "wrong reason for a missing connector: $(cat "$T/err")"; }

# The gate-closed rule rests on which features need mac-request: an old connector breaks nothing
# that works today only because these three callers were already failing without it (#3626,
# Liu Kang on #718). A NEW caller must re-decide that before it ships, so the set is pinned.
# #3311 re-decided for engine/federation.js and engine/fedseats.js: federation never worked
# before this connector, so an old one breaks nothing that works. It refuses the unlisted
# federation routes (the board shows that sentence on invite/verify) and has no fed-room
# verb (a seat that cannot start backs off; the room stays local).
callers="$(grep -l "macRequest(" engine/*.js 2>/dev/null | grep -v -e "engine/remote.js" -e "\.test\.js$" | sort | tr '\n' ' ')"
[ "$callers" = "engine/federation.js engine/fedseats.js engine/mac-standing.js engine/phonenotify.js engine/updating.js " ] && ok "mac-request callers are exactly the five the gate-closed rule was decided on" || bad "the mac-request callers changed ($callers); re-decide whether an old connector breaks something that works, then update this list"

# The real connector on this Mac, when it is there: an integration line, reported but never failed.
R="${KOSMOS_TUNNEL_BIN:-$HOME/work/kosmos-relay/dist/kosmos-tunnel}"
if [ -x "$R" ]; then
  echo "NOTE  the connector at $R: $(connector_mac_request_probe "$R")"
else echo "NOTE  no connector at $R on this machine; the integration line did not run"; fi
EXPECTED=22
[ "$PASSES" -eq "$EXPECTED" ] || bad "expected $EXPECTED passing checks, saw $PASSES (a check was skipped, or one was added without updating EXPECTED)"
echo "connector-verbs: $PASSES passed, $FAILS failures"; [ "$FAILS" -eq 0 ]
