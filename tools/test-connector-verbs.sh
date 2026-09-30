#!/bin/bash
# connector_verbs_check (#718): the bundle build refuses a connector without
# mac-request once the phone-notifications gate is open, and only notes it in
# one line while the gate is closed.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tools/lib/connector-verbs.sh
FAILS=0; PASSES=0; RETRIES=0; ok(){ echo "PASS  $1"; PASSES=$((PASSES+1)); }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/connector-verbs.XXXXXX")"; trap 'rm -rf "$T"' EXIT

# Stand-in connectors: one that knows mac-request, one that answers like a pre-#103 build.
NEW="$T/new-tunnel"; printf '#!/bin/sh\n[ "$1" = mac-request ] && [ "$2" = --help ] && exit 0\nexit 3\n' > "$NEW"; chmod +x "$NEW"
OLD="$T/old-tunnel"; printf '#!/bin/sh\necho "error: unrecognized subcommand '"'"'$1'"'"'" >&2\nexit 2\n' > "$OLD"; chmod +x "$OLD"
OPEN="$T/open.js"; printf "const x = 1;\nconst PHONE_APP_CAN_RECEIVE = true;\nlet available = PHONE_APP_CAN_RECEIVE;\n" > "$OPEN"
SHUT="$T/shut.js"; printf "const PHONE_APP_CAN_RECEIVE = false;\n" > "$SHUT"

# #4678: the arms below test which REASON the check gives, on stand-ins that answer at once. If the only
# outcome is the probe's own timeout sentence, the box never ran the stand-in within the bound (reported on
# #4678 from a loaded box, not reproduced here: a stand-in that exits at once reached the 20 s bound), which
# says nothing about the reason.
# Run it again then, and only then: any other outcome is judged on the first try, so a wrong reason or a
# noisy line can never be retried away. ONE rerun at most (Liu Kang, m3843), printed and counted: two
# timeouts in a row are judged as a timeout, so a stand-in that really hangs still fails its arm.
# The match is the check's own wording around the probe's reason ("(it did not answer within N seconds),
# and" with the gate open, "...seconds);" with it closed), not a stand-in's stderr that happens to say so.
# VERBS_RERUN_CLEARS names a file removed before the rerun and VERBS_RERUN_SECONDS a bound for it; only the
# arms that test the rerun itself set them. Sets VRC (the check's status) and leaves its stderr in $T/err.
TIMEOUT_RE='[(]it did not answer within [0-9]+ seconds[)](, and|;)'
verbs_try() {
  connector_verbs_check "$1" "$2" 2>"$T/err"; VRC=$?
  [ "$(wc -l < "$T/err" | tr -d ' ')" = 1 ] && grep -Eq "$TIMEOUT_RE" "$T/err" || return 0
  RETRIES=$((RETRIES + 1)); echo "RETRY $(basename "$1"): timed out once (the box did not run it within the bound); running it once more"
  [ -n "${VERBS_RERUN_CLEARS:-}" ] && rm -f "$VERBS_RERUN_CLEARS"
  CONNECTOR_PROBE_SECONDS="${VERBS_RERUN_SECONDS:-${CONNECTOR_PROBE_SECONDS:-}}" connector_verbs_check "$1" "$2" 2>"$T/err"; VRC=$?
}

verbs_try "$NEW" "$OPEN"; [ "$VRC" = 0 ] && [ ! -s "$T/err" ] && ok "gate open, connector knows mac-request: goes on silently" || bad "a good connector with the gate open was refused or noisy: $(cat "$T/err")"
verbs_try "$NEW" "$SHUT"; [ "$VRC" = 0 ] && [ ! -s "$T/err" ] && ok "gate closed, connector knows mac-request: goes on silently" || bad "a good connector with the gate closed was refused or noisy: $(cat "$T/err")"

verbs_try "$OLD" "$OPEN"; [ "$VRC" = 0 ] && bad "gate open with an old connector was NOT refused" || { grep -q "does not know 'mac-request'" "$T/err" && grep -q "build-tunnel-release.sh" "$T/err" && ok "gate open, old connector: refused, naming the verb and the rebuild" || bad "wrong refusal for an old connector: $(cat "$T/err")"; }

verbs_try "$OLD" "$SHUT"
if [ "$VRC" = 0 ]; then
  n="$(wc -l < "$T/err" | tr -d ' ')"
  [ "$n" = 1 ] && grep -q "predates mac-request, so the Plus standing refresh and update announce stay unsigned-broken as before (#3626)" "$T/err" && ok "gate closed, old connector: goes on with exactly one line saying what stays inactive" || bad "the closed-gate note is not one calm line ($n lines): $(cat "$T/err")"
else bad "gate closed with an old connector was refused; it must only note it"; fi

# The gate line must be read exactly; anything else refuses rather than guessing.
printf "const PHONE_APP_CAN_RECEIVE = process.env.X === '1';\n" > "$T/odd.js"
connector_verbs_check "$NEW" "$T/odd.js" 2>"$T/err" && bad "an unreadable gate line was accepted" || { grep -q "cannot read the phone-notifications ship gate" "$T/err" && ok "a reworded gate line refuses, naming the line it expects" || bad "wrong reason for an unreadable gate: $(cat "$T/err")"; }
connector_verbs_check "$NEW" "$T/nowhere.js" 2>"$T/err" && bad "a missing gate file was accepted" || { grep -q "cannot read the phone-notifications ship gate" "$T/err" && ok "a missing gate file refuses, for that reason" || bad "wrong reason for a missing gate file: $(cat "$T/err")"; }

# A connector that cannot be run is not evidence it is old: its own reason, never "rebuild the relay".
NOX="$T/noexec-tunnel"; cp "$NEW" "$NOX"; chmod -x "$NOX"
verbs_try "$NOX" "$OPEN"; [ "$VRC" = 0 ] && bad "gate open, a non-executable connector was accepted" || { grep -q "could not check" "$T/err" && grep -q "not executable" "$T/err" && ! grep -q "build-tunnel-release" "$T/err" && ok "gate open, a non-executable connector refuses as unrunnable, not as old" || bad "wrong reason for a non-executable connector: $(cat "$T/err")"; }
CRASH="$T/crash-tunnel"; printf '#!/bin/sh\necho "Segmentation fault" >&2\nexit 139\n' > "$CRASH"; chmod +x "$CRASH"
verbs_try "$CRASH" "$OPEN"; [ "$VRC" = 0 ] && bad "gate open, a crashing connector was accepted" || { grep -q "exited 139" "$T/err" && ! grep -q "does not know" "$T/err" && ok "gate open, a crash refuses naming its exit, not as old" || bad "wrong reason for a crash: $(cat "$T/err")"; }
verbs_try "$CRASH" "$SHUT"; if [ "$VRC" = 0 ]; then [ "$(wc -l < "$T/err" | tr -d ' ')" = 1 ] && grep -q "could not check" "$T/err" && grep -q "stay unsigned-broken as before" "$T/err" && ok "gate closed, a crash is one line and the build goes on" || bad "closed-gate crash note wrong: $(cat "$T/err")"; else bad "gate closed, a crashing connector was refused"; fi
EXIT2="$T/other-exit2"; printf '#!/bin/sh\necho "error: the argument --coordinator is required" >&2\nexit 2\n' > "$EXIT2"; chmod +x "$EXIT2"
verbs_try "$EXIT2" "$OPEN"; [ "$VRC" = 0 ] && bad "an exit 2 without unrecognized subcommand was accepted" || { grep -q "could not check" "$T/err" && ok "exit 2 for another reason is not read as old" || bad "exit 2 misread: $(cat "$T/err")"; }
HANG="$T/hang-tunnel"; printf '#!/bin/sh\nexec sleep 300\n' > "$HANG"; chmod +x "$HANG"
start=$(date +%s); CONNECTOR_PROBE_SECONDS=2 connector_verbs_check "$HANG" "$OPEN" 2>"$T/err"; took=$(( $(date +%s) - start ))
# #4678: bounded means it returned well before the stand-in's own 300 s sleep, with the 2 s timeout named.
# The limit is 30 s, not the old 10: 10 was a guess at the box's speed that a busy box broke without the
# bound failing, while 30 still catches a 2 s bound armed about fifteen times too long.
[ "$took" -lt 30 ] && grep -q "could not check" "$T/err" && grep -q "did not answer within 2 seconds" "$T/err" && ok "a hanging connector is cut off by the bound (${took}s) and refused as unrunnable" || bad "a hang was not bounded (${took}s): $(cat "$T/err")"
# A bound of 0 or junk must not switch the bound off (perl's alarm 0 means "no alarm").
for v in 0 00 -3 abc 2.5 ""; do [ "$(CONNECTOR_PROBE_SECONDS="$v" connector_probe_seconds)" = 20 ] || bad "CONNECTOR_PROBE_SECONDS='$v' was not replaced by 20"; done
[ "$(CONNECTOR_PROBE_SECONDS=7 connector_probe_seconds)" = 7 ] && [ "$(unset CONNECTOR_PROBE_SECONDS; connector_probe_seconds)" = 20 ] && ok "the bound: 0, 00, negative, junk and empty fall back to 20; a positive whole number is kept" || bad "the bound sanitiser is wrong"
# A connector that exits 142 by itself is not reported as a timeout.
E142="$T/exit142-tunnel"; printf '#!/bin/sh\nexit 142\n' > "$E142"; chmod +x "$E142"
case "$(connector_mac_request_probe "$E142")" in *"exited 142"*) ok "a connector's own exit 142 is not read as a timeout" ;; *) bad "exit 142 misread: $(connector_mac_request_probe "$E142")" ;; esac

# A connector whose CHILD hangs (no exec): the bound must kill the whole group, not only the shell.
# #4678: the proof needs the child to EXIST before the bound fires. On a busy box the bound can fire before
# the stand-in has even forked, and then nothing was tested. So if the stand-in recorded no child AND the
# check's outcome is the timeout sentence, the arm runs once more (ONE rerun, printed and counted), and is
# judged only once the child exists. No child and some OTHER outcome is judged at once; no child twice is
# "could not tell", a failure, never a pass. Only the pid the stand-in wrote is signalled, and only after ps
# shows it is that stand-in's sleep.
child_hang_arm() {  # child_hang_arm <stand-in> <label> <bound seconds> [a file to remove before the rerun]
  local stand="$1" label="$2" b="$3" clears="${4:-}" i=1 start took pid
  while :; do
    rm -f "$T/kid.pid"
    start=$(date +%s); CONNECTOR_PROBE_SECONDS="$b" connector_verbs_check "$stand" "$OPEN" 2>"$T/err"; took=$(( $(date +%s) - start ))
    [ -s "$T/kid.pid" ] && break
    grep -Eq "$TIMEOUT_RE" "$T/err" || { bad "$label: the stand-in recorded no child and the check did not time out: $(cat "$T/err")"; return; }
    [ "$i" -ge 2 ] && { bad "$label: could not tell: the stand-in did not record its child before the $b s bound, twice (a busy box), so the bound was not tested"; return; }
    RETRIES=$((RETRIES + 1)); echo "RETRY $label: the stand-in did not record its child before the bound; running it once more"
    [ -n "$clears" ] && rm -f "$clears"
    i=$((i + 1))
  done
  [ "$took" -lt 30 ] && grep -q "did not answer within $b seconds" "$T/err" && ok "$label: a connector whose child hangs is also cut off (${took}s), naming the time limit" || bad "$label: a hanging child was not bounded (${took}s): $(cat "$T/err")"
  pid="$(cat "$T/kid.pid")"
  if kill -0 "$pid" 2>/dev/null; then
    bad "$label: the hung connector's child outlived the bound"
    /bin/ps -o command= -p "$pid" 2>/dev/null | grep -q '^sleep 300' && kill "$pid" 2>/dev/null
  else ok "$label: the timed-out connector's child process is gone too"; fi
}
KID="$T/child-hang-tunnel"; printf '#!/bin/sh\nsleep 300 &\necho $! > "%s"\nwait\n' "$T/kid.pid" > "$KID"; chmod +x "$KID"
# A 5 s bound: this arm only needs the child to EXIST before the bound fires (the HANG arm above covers the
# 2 s bound itself), so it gets room a busy box's scheduling needs.
child_hang_arm "$KID" "child hang" 5

# #4678, the rerun itself. Each stand-in hangs while a marker file the TEST made exists, and the test removes
# it before the rerun, so the first try times out and the second answers whatever the box's speed (a marker
# the stand-in had to write itself would depend on the very scheduling this card is about). Each arm also
# checks that exactly one rerun happened.
SLOWCRASH="$T/slow-once-crash"; : > "$T/sc.slow"
printf '#!/bin/sh\n[ -e "%s" ] && exec sleep 300\necho "Segmentation fault" >&2\nexit 139\n' "$T/sc.slow" > "$SLOWCRASH"; chmod +x "$SLOWCRASH"
r0=$RETRIES; CONNECTOR_PROBE_SECONDS=1 VERBS_RERUN_SECONDS=20 VERBS_RERUN_CLEARS="$T/sc.slow" verbs_try "$SLOWCRASH" "$OPEN"
[ $((RETRIES - r0)) = 1 ] && [ "$VRC" != 0 ] && grep -q "exited 139" "$T/err" && ok "a stand-in that timed out once is run once more and judged on its real answer" || bad "a first-run timeout was not rerun once and judged on the real answer ($((RETRIES - r0)) reruns): $(cat "$T/err")"
ALWAYS="$T/always-slow"; printf '#!/bin/sh\nexec sleep 300\n' > "$ALWAYS"; chmod +x "$ALWAYS"
r0=$RETRIES; CONNECTOR_PROBE_SECONDS=1 verbs_try "$ALWAYS" "$OPEN"
[ $((RETRIES - r0)) = 1 ] && [ "$VRC" != 0 ] && grep -q "did not answer within 1 seconds" "$T/err" && ok "CONTROL: a stand-in that times out every try is rerun exactly once and still refuses, naming the timeout" || bad "an always-timing-out stand-in was not refused after exactly one rerun ($((RETRIES - r0)) reruns): $(cat "$T/err")"
SLOWKID="$T/slow-once-child-hang"; : > "$T/sk.slow"
printf '#!/bin/sh\n[ -e "%s" ] && exec sleep 300\nsleep 300 &\necho $! > "%s"\nwait\n' "$T/sk.slow" "$T/kid.pid" > "$SLOWKID"; chmod +x "$SLOWKID"
# A 5 s bound here: the arm tests the rerun, not the 2 s bound (the KID arm above does), and its rerun is
# spent on purpose, so its second try gets more room than a busy box's scheduling needs.
r0=$RETRIES; child_hang_arm "$SLOWKID" "child hang, slow first run" 5 "$T/sk.slow"
[ $((RETRIES - r0)) = 1 ] && ok "child hang, slow first run: exactly one rerun" || bad "child hang, slow first run: $((RETRIES - r0)) reruns, expected exactly 1"
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
# verb (its seat exits 2 and ends with an "update Kosmos" note in the room).
callers="$(grep -l "macRequest(" engine/*.js 2>/dev/null | grep -v -e "engine/remote.js" -e "\.test\.js$" | sort | tr '\n' ' ')"
[ "$callers" = "engine/federation.js engine/fedseats.js engine/mac-standing.js engine/phonenotify.js engine/updating.js " ] && ok "mac-request callers are exactly the five the gate-closed rule was decided on" || bad "the mac-request callers changed ($callers); re-decide whether an old connector breaks something that works, then update this list"

# The real connector on this Mac, when it is there: an integration line, reported but never failed.
R="${KOSMOS_TUNNEL_BIN:-$HOME/work/kosmos-relay/dist/kosmos-tunnel}"
if [ -x "$R" ]; then
  echo "NOTE  the connector at $R: $(connector_mac_request_probe "$R")"
else echo "NOTE  no connector at $R on this machine; the integration line did not run"; fi
EXPECTED=27
[ "$PASSES" -eq "$EXPECTED" ] || bad "expected $EXPECTED passing checks, saw $PASSES (a check was skipped, or one was added without updating EXPECTED)"
# Three stand-ins above rerun on purpose (the slow-once crash, the always-slow control, the slow-once child
# hang); any rerun beyond those three was the box.
echo "connector-verbs: $PASSES passed, $FAILS failures, $RETRIES arm(s) rerun once after a timeout (3 of them on purpose)"; [ "$FAILS" -eq 0 ]
