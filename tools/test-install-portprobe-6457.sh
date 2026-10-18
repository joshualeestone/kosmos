#!/bin/bash
# kosmos#6457: the install gate's "port <default> is as we found it" check must call a port busy when something is
# LISTENING on it, not when it answers HTTP within a second. On the 0.7.56 cut the host's own board (the same pid before
# and after) missed a 1 s curl at load 39, read as "free" after the run, and failed the cut.
#
# This runs tools/test-install.sh's own probe (_ti_port_busy, as written in that file) against real listeners:
#   - a listener that accepts but never answers reads BUSY; CONTROL: the old `curl -s -m 1` probe calls the same
#     listener free, so this arm reproduces the cut's failure rather than passing for some other reason;
#   - a port with nothing on it reads FREE (the probe can say no);
#   - free before, a listener started, busy after: the gate's before/after comparison would still go red, so a listener
#     the run leaves behind is still caught;
#   - both gate probes call it, and no 1 s curl probe of the default port is left in the harness.
#
#   bash tools/test-install-portprobe-6457.sh
set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }
PIDS=""
trap 'for p in $PIDS; do kill "$p" 2>/dev/null; done' EXIT

# The probe, as written in tools/test-install.sh (from its opening line to the closing brace).
probe="$(awk '/^_ti_port_busy\(\) \{/{p=1} p{print} p && /^\}/{exit}' tools/test-install.sh)"
if [ -z "$probe" ]; then
  bad "found _ti_port_busy in tools/test-install.sh"
  echo "1 FAILURE(S)"; exit 1
fi
eval "$probe"

free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'; }
# A listener that completes the handshake (the kernel does, from the backlog) but never reads or answers: what a board
# too loaded to serve looks like from outside.
silent_listener() {   # <port>; sets LPID
  python3 -c 'import socket,sys,time
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
s.bind(("127.0.0.1",int(sys.argv[1]))); s.listen(16); time.sleep(120)' "$1" &
  LPID=$!
  PIDS="$PIDS $LPID"
  local i=0
  while [ "$i" -lt 50 ] && [ -z "$(lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null)" ]; do sleep 0.1; i=$((i+1)); done
}

P1="$(free_port)"
silent_listener "$P1"
if _ti_port_busy "$P1"; then ok "a listener that never answers reads busy"; else bad "a listener that never answers reads busy"; fi
if curl -s -m 1 -o /dev/null "http://127.0.0.1:$P1/" 2>/dev/null; then
  bad "CONTROL: the old 1 s curl probe calls that listener free (it answered, so this arm proves nothing)"
else
  ok "CONTROL: the old 1 s curl probe calls that listener free"
fi
kill "$LPID" 2>/dev/null; wait "$LPID" 2>/dev/null

P2="$(free_port)"
if _ti_port_busy "$P2"; then bad "a port with nothing on it reads free"; else ok "a port with nothing on it reads free"; fi

P3="$(free_port)"
before=free; _ti_port_busy "$P3" && before=busy
silent_listener "$P3"
after=free; _ti_port_busy "$P3" && after=busy
if [ "$before" = free ] && [ "$after" = busy ]; then
  ok "a listener started during the run turns free into busy, so the gate still goes red"
else
  bad "a listener started during the run turns free into busy (before=$before after=$after)"
fi

n="$(grep -c '_ti_port_busy "\$KOSMOS_DEFAULT_PORT" && DEFAULT_PORT_\(BEFORE\|AFTER\)=busy' tools/test-install.sh)"
if [ "$n" = 2 ]; then ok "both gate probes use it"; else bad "both gate probes use it (found $n)"; fi
if grep -q 'curl -s -m 1 [^#]*KOSMOS_DEFAULT_PORT' tools/test-install.sh; then
  bad "no 1 s curl probe of the default port is left"
else
  ok "no 1 s curl probe of the default port is left"
fi

[ "$FAILS" -eq 0 ] && { echo "ALL PASS"; exit 0; }
echo "$FAILS FAILURE(S)"; exit 1
