#!/bin/bash
# #5470: kosmos_running_lines <script> (tools/lib/cut-guard.sh) answers "is <script> RUNNING" from real
# processes. A run starts with the interpreter and the script; a tools/queued-heavy.sh waiter that carries
# the script as an argument, the `sh -c` shell that started that waiter, and a command that only mentions
# the script are not runs. On 0.7.27 an unanchored `pgrep -f` read a waiter as a run and deadlocked the
# cut (#5467). Real processes, not a stubbed pgrep: the bug was in what pgrep returns.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tools/lib/cut-guard.sh
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/running-anchor-5470.XXXXXX")"
PIDS=""
cleanup() { local p; for p in $PIDS; do pkill -P "$p" 2>/dev/null; kill "$p" 2>/dev/null; done; wait 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT

# A unique script name, so nothing else on this machine can match, and a sleeper behind each shape.
NAME="fake-run-5470-$$.sh"; SCRIPT="tools/$NAME"
mkdir -p "$T/tools"
printf '#!/bin/bash\nsleep 30\n' > "$T/$SCRIPT"
printf '#!/bin/bash\nsleep 30\n' > "$T/tools/queued-heavy-standin.sh"
chmod +x "$T/$SCRIPT" "$T/tools/queued-heavy-standin.sh"
start() { "$@" >/dev/null 2>&1 & PIDS="$PIDS $!"; disown "$!" 2>/dev/null || true; }
pids_of() { printf '%s\n' "$1" | awk 'NF {print $1}' | sort -n | tr '\n' ' '; }
# Wait (up to ~5 s) until each pid shows its own command line to pgrep: a fresh fork can briefly show its
# parent's, which would read as a missing run on a loaded Mac.
settle() { local p i; for p in "$@"; do for i in 1 2 3 4 5 6 7 8 9 10; do pgrep -fl "${NAME//./\\.}" | awk '{print $1}' | grep -qx "$p" && break; sleep 0.5; done; done; }

# Nothing running yet.
out="$(kosmos_running_lines "$SCRIPT")"; rc=$?
[ "$rc" = 1 ] && [ -z "$out" ] && ok "nothing running: returns 1 with no lines" || bad "nothing running: rc=$rc out=$out"

# The shapes that are NOT runs.
( cd "$T" && start bash tools/queued-heavy-standin.sh "#5470 standin" bash "$SCRIPT"; echo "$PIDS" > "$T/waiter.pid" ); WAITER=$(awk '{print $NF}' "$T/waiter.pid"); PIDS="$PIDS $WAITER"
start sh -c "sleep 30; : bash $SCRIPT"; PARENT=$!
start bash -c 'sleep 30; :' "mentions-$SCRIPT"; MENTION=$!   # compound, so bash stays and keeps the mention
start bash -c "sleep 30; : $SCRIPT"; CSTRING=$!                  # a -c command string that names the script
settle $WAITER $PARENT $MENTION $CSTRING
# CONTROL: the unanchored pattern a hand-written wait used really does match them (else this proves nothing).
loose="$(pgrep -f "${NAME//./\\.}" | tr '\n' ' ')"
cmiss=0; for p in $WAITER $PARENT $MENTION $CSTRING; do case " $loose " in *" $p "*) : ;; *) cmiss=1; bad "control: unanchored pgrep did not match pid $p, so the test cannot show the bug" ;; esac; done
[ "$cmiss" = 0 ] && ok "CONTROL: an unanchored pgrep -f matches the waiter, its sh -c parent, the mention and the -c string"

out="$(kosmos_running_lines "$SCRIPT")"; rc=$?
[ "$rc" = 1 ] && ok "a queued waiter, its sh -c parent, a mention and a -c string are NOT runs (rc 1)" || bad "non-runs matched: rc=$rc pids=$(pids_of "$out") (waiter $WAITER, parent $PARENT, mention $MENTION, -c $CSTRING)"

# The shapes that ARE runs: relative and absolute script paths, bash and an absolute interpreter.
( cd "$T" && start bash "$SCRIPT"; echo "$PIDS" > "$T/rel.pid" ); REL=$(awk '{print $NF}' "$T/rel.pid"); PIDS="$PIDS $REL"
start /bin/bash "$T/$SCRIPT"; ABS=$!
( cd "$T" && start bash -x "$SCRIPT"; echo "$PIDS" > "$T/opt.pid" ); OPT=$(awk '{print $NF}' "$T/opt.pid"); PIDS="$PIDS $OPT"
( cd "$T" && start bash -o pipefail "$SCRIPT"; echo "$PIDS" > "$T/optv.pid" ); OPTV=$(awk '{print $NF}' "$T/optv.pid"); PIDS="$PIDS $OPTV"
settle $REL $ABS $OPT $OPTV
out="$(kosmos_running_lines "$SCRIPT")"; rc=$?
got="$(pids_of "$out")"
[ "$rc" = 0 ] && ok "a real run is found (rc 0)" || bad "real runs not found: rc=$rc"
case " $got " in *" $REL "*) ok "bash tools/<script> (relative, as release.sh starts it) is a run" ;; *) bad "relative run $REL missing from: $got" ;; esac
case " $got " in *" $ABS "*) ok "/bin/bash /abs/path/tools/<script> is a run" ;; *) bad "absolute run $ABS missing from: $got" ;; esac
case " $got " in *" $OPT "*) ok "bash -x tools/<script> (a shell option before the script) is a run" ;; *) bad "option run $OPT missing from: $got" ;; esac
case " $got " in *" $OPTV "*) ok "bash -o pipefail tools/<script> (an option that takes a value) is a run" ;; *) bad "value-option run $OPTV missing from: $got" ;; esac
leaked=""; for p in $WAITER $PARENT $MENTION $CSTRING; do case " $got " in *" $p "*) leaked="$leaked $p" ;; esac; done
[ -z "$leaked" ] && ok "with real runs present, the waiter, its parent, the mention and the -c string are still not listed" || bad "non-runs listed beside the real runs:$leaked"

# Shapes that cannot be held open as live processes (bash -n exits at once), read through a stubbed pgrep
# that prints fixed lines: which are runs, which are not.
shape() { # <expect run|not> <command line>
  local want="$1" line="$2" out rc
  rm -f "$T/stub.called"
  out="$(pgrep() { : > "$T/stub.called"; printf '4242 %s\n' "$line"; }; kosmos_running_lines "$SCRIPT")"; rc=$?
  [ -f "$T/stub.called" ] || { bad "the pgrep stub was not called for: $line (the helper no longer calls pgrep by name?)"; return; }
  if [ "$want" = run ]; then [ "$rc" = 0 ] && ok "a run: $line" || bad "should be a run: $line (rc $rc)"
  else [ "$rc" = 1 ] && ok "not a run: $line" || bad "should not be a run: $line (rc $rc)"; fi
}
shape not "bash -n $SCRIPT"
shape not "bash -xn $SCRIPT"
shape not "bash -lc $SCRIPT"
shape run  "bash -eo pipefail $SCRIPT"
shape run  "bash +x $SCRIPT"
shape run  "bash -- $SCRIPT"
shape run  "bash --rcfile /x/rc $SCRIPT"
shape not  "bash -e -c : $SCRIPT"      # a bare -c as its own word is still a command string
shape run  "bash --norc $SCRIPT"
shape not  "bash ${SCRIPT%.sh}Xsh"   # the dot is literal: a name that differs only there is not this script

# A pgrep that fails is "could not tell" (2), never "nothing running" (1).
out="$(pgrep() { return 3; }; kosmos_running_lines "$SCRIPT")"; rc=$?
[ "$rc" = 2 ] && ok "a failing pgrep returns 2 (could not tell), not 1" || bad "failing pgrep: rc=$rc"
kosmos_running_lines "" >/dev/null; rc=$?
[ "$rc" = 2 ] && ok "no script named: returns 2" || bad "empty script: rc=$rc"

echo "test-running-anchor-5470: $FAILS failure(s)"
[ "$FAILS" = 0 ]
