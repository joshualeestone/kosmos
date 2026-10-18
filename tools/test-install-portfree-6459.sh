#!/bin/bash
# kosmos#6459 (follow-up to #6457): three checks in tools/test-install.sh still decided "the port is free" by an HTTP
# answer inside a second, so a board still LISTENING but too loaded to answer read as released (a false green):
#   - "port released (uninstall stopped the board itself)"
#   - "port free before the belt pass"
#   - wait_port_free(), which returned "free" on the first curl that failed and so skipped its own kill pass.
# They now use #6457's _ti_port_busy (a LISTEN socket via lsof, then a TCP connect).
#
# This runs the harness's own code (extracted from tools/test-install.sh) against a listener that accepts but never
# answers, which is what a loaded board looks like from outside:
#   - the two checks' expression does NOT call it released; CONTROL: the old 1 s curl expression does;
#   - wait_port_free reaches its kill pass and the listener is gone afterwards; CONTROL: the old function returns at
#     once with the listener still alive;
#   - on a port with nothing on it, the checks read released and wait_port_free returns at once (they can say yes);
#   - no 1 s curl probe of $PORT is left in the harness.
#
#   bash tools/test-install-portfree-6459.sh
set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }
PIDS=""
trap 'for p in $PIDS; do kill "$p" 2>/dev/null; done' EXIT

extract() { awk -v n="$1" '$0 ~ "^"n"\\(\\) \\{" {p=1} p{print} p && /^\}/{exit}' tools/test-install.sh; }
probe="$(extract _ti_port_busy)"
waiter="$(extract wait_port_free)"
if [ -z "$probe" ] || [ -z "$waiter" ]; then
  bad "found _ti_port_busy and wait_port_free in tools/test-install.sh"
  echo "1 FAILURE(S)"; exit 1
fi
eval "$probe"
eval "$waiter"
# The pre-#6459 wait_port_free, for the CONTROL arm: the same function with its probe put back to the 1 s curl.
eval "$(printf '%s\n' "$waiter" | sed 's#^wait_port_free()#old_wait_port_free()#; s#_ti_port_busy "\$PORT" || return 0#curl -fsS -m 1 -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null || return 0#')"

# The two checks' expression, exactly as the harness's chk lines hold it.
released_expr="$(grep -o '"! _ti_port_busy \$PORT"' tools/test-install.sh | head -1 | tr -d '"')"

free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'; }
silent_listener() {   # <port>; sets LPID
  python3 -c 'import socket,sys,time
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
s.bind(("127.0.0.1",int(sys.argv[1]))); s.listen(16); time.sleep(120)' "$1" &
  LPID=$!
  PIDS="$PIDS $LPID"
  local i=0
  while [ "$i" -lt 100 ] && [ -z "$(lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null)" ]; do sleep 0.1; i=$((i+1)); done
  [ -n "$(lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null)" ] || { bad "the test's listener on $1 came up within 10 s"; return 1; }
}

# The checks.
n="$(grep -c '"! _ti_port_busy \$PORT"' tools/test-install.sh)"
if [ "$n" = 2 ]; then ok "both released/free checks use the listening probe"; else bad "both released/free checks use the listening probe (found $n)"; fi
if grep -q 'curl [^#]*-m 1 [^#]*127\.0\.0\.1:\$PORT/' tools/test-install.sh; then
  bad "no 1 s curl probe of \$PORT is left in the harness"
else
  ok "no 1 s curl probe of \$PORT is left in the harness"
fi

PORT="$(free_port)"
silent_listener "$PORT"
if eval "$released_expr"; then bad "a loaded board (listening, never answering) is NOT reported released"; else ok "a loaded board (listening, never answering) is NOT reported released"; fi
if eval '! curl -s -m 1 -o /dev/null http://127.0.0.1:$PORT/'; then
  ok "CONTROL: the old 1 s curl check reports that same board released (the false green)"
else
  bad "CONTROL: the old 1 s curl check reports that same board released (it answered, so this arm proves nothing)"
fi

# wait_port_free: the old one returns at once and leaves the listener; the new one reaches its kill pass.
if old_wait_port_free && kill -0 "$LPID" 2>/dev/null; then
  ok "CONTROL: the old wait_port_free calls it free at once and leaves the listener running"
else
  bad "CONTROL: the old wait_port_free calls it free at once and leaves the listener running"
fi
if wait_port_free; then ok "wait_port_free returns free once the port really is"; else bad "wait_port_free returns free once the port really is"; fi
sleep 0.3
if kill -0 "$LPID" 2>/dev/null || [ -n "$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null)" ]; then
  bad "wait_port_free reached its kill pass: nothing listens on the port afterwards"
else
  ok "wait_port_free reached its kill pass: nothing listens on the port afterwards"
fi

# They can say yes: nothing on the port.
PORT="$(free_port)"
if eval "$released_expr"; then ok "a port with nothing on it reads released"; else bad "a port with nothing on it reads released"; fi
start=$(date +%s)
if wait_port_free && [ $(( $(date +%s) - start )) -le 3 ]; then
  ok "wait_port_free returns at once on a port with nothing on it"
else
  bad "wait_port_free returns at once on a port with nothing on it"
fi

[ "$FAILS" -eq 0 ] && { echo "ALL PASS"; exit 0; }
echo "$FAILS FAILURE(S)"; exit 1
