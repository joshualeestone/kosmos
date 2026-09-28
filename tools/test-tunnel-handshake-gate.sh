#!/bin/bash
# Offline test for tools/tunnel-handshake-gate.sh (kosmos#4270). No relay, coordinator or network:
# a STUB connector prints what the real one prints in each case (the real lines were captured from
# the shipped 0.7.05 kosmos-tunnel against a local relay), and a local HTTPS server with a
# throwaway CA stands in for the visit through the relay. Every verdict and exit code is pinned,
# with a PASS control, so a gate that refuses everything cannot read as a gate that works.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
GATE="$HERE/tunnel-handshake-gate.sh"
pass=0; fail=0
for t in openssl python3 curl shasum; do
  command -v "$t" >/dev/null 2>&1 || { echo "MISSING TOOL: $t"; exit 1; }
done

W="$(mktemp -d "${TMPDIR:-/tmp}/tunnelgate-test.XXXXXX")"
SRV=""
# The server's stop is wrapped so bash's "Terminated" job report does not read as a failure.
trap '{ [ -n "$SRV" ] && kill "$SRV" && wait "$SRV"; } 2>/dev/null; rm -rf "$W"' EXIT
HOST=gate-test.kosmos.test

# A throwaway CA and a leaf for HOST, for the visitor's HTTPS.
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=gate test CA" \
  -keyout "$W/ca.key" -out "$W/ca.pem" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -subj "/CN=$HOST" -keyout "$W/leaf.key" -out "$W/leaf.csr" >/dev/null 2>&1
printf 'subjectAltName=DNS:%s\n' "$HOST" > "$W/san.ext"
openssl x509 -req -in "$W/leaf.csr" -CA "$W/ca.pem" -CAkey "$W/ca.key" -CAcreateserial -days 2 \
  -extfile "$W/san.ext" -out "$W/leaf.pem" >/dev/null 2>&1
[ -s "$W/leaf.pem" ] || { echo "could not make the test certificate"; exit 1; }

# The visitor's server: GET /ok -> the session page, /wrong -> another page, /boom -> 500.
# The gate always asks for "/", so each case points the stub's page at a mode file.
PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
echo ok > "$W/mode"
python3 - "$W" "$PORT" <<'PY' >/dev/null 2>&1 &
import http.server, ssl, sys
w, port = sys.argv[1], int(sys.argv[2])
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        mode = open(w + "/mode").read().strip()
        if mode == "boom":
            self.send_response(500); self.end_headers(); return
        body = b"<html><head><title>Kosmos+</title></head></html>" if mode == "ok" else b"<html><title>Something else</title></html>"
        self.send_response(200); self.send_header("content-type", "text/html"); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
srv = http.server.HTTPServer(("127.0.0.1", port), H)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain(w + "/leaf.pem", w + "/leaf.key")
srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
srv.serve_forever()
PY
SRV=$!
for _ in $(seq 1 40); do curl -s --max-time 1 --cacert "$W/ca.pem" --resolve "$HOST:$PORT:127.0.0.1" -o /dev/null "https://$HOST:$PORT/" && break; sleep 0.25; done

# An enrolled-looking state dir for HOST.
mkdir -p "$W/state"
for f in mac_id mac_key tls.crt tls.key coordinator_pubkey; do echo x > "$W/state/$f"; done
echo "$HOST" > "$W/state/address"

# The stub connector. STUB_MODE picks what it prints (the real connector's wording). It execs
# into a sleep NAMED with this run's tag, so the leak check at the end can find a stub that
# outlived its gate (a bare "exec sleep" would leave nothing with a findable name).
TAG="$(basename "$W")"
cat > "$W/stub-tunnel" <<'STUB'
#!/bin/bash
state=""; while [ $# -gt 0 ]; do [ "$1" = --state-dir ] && state="$2"; shift; done
hold() { exec -a "kosmos-gate-stub-$STUB_TAG" sleep 60; }
up() { echo "2026-09-28T01:21:47Z  INFO kosmos_tunnel_client::session: tunnel up relay=x hostname=y"; }
case "$(cat "$STUB_MODE_FILE")" in
  up)     up; hold ;;
  ticket) echo "2026-09-28T01:21:47Z  WARN kosmos_tunnel_client: session ended: Kosmos+ unreachable for /v1/mac/relay-ticket: http://127.0.0.1:9/v1/mac/relay-ticket: Connection refused"; hold ;;
  auth)   echo "2026-09-28T01:21:47Z  WARN kosmos_tunnel_client: session ended: relay TLS handshake: invalid peer certificate: UnknownIssuer"; hold ;;
  retry)  echo "2026-09-28T01:21:47Z  WARN kosmos_tunnel_client: session ended: relay TLS handshake: early eof"; sleep 2; up; hold ;;
  renew)  echo renewed-crt > "$state/tls.crt"; echo renewed-key > "$state/tls.key"; up; hold ;;
  exits)  echo "error: something broke"; exit 1 ;;
  silent) hold ;;
esac
STUB
chmod +x "$W/stub-tunnel"

# run <label> <want-exit> <want-text> <stub-mode> <page-mode> [extra gate args...]
run() {
  local label="$1" want="$2" text="$3" smode="$4" pmode="$5"; shift 5
  echo "$smode" > "$W/stubmode"; echo "$pmode" > "$W/mode"
  local out rc
  out=$(STUB_TAG="$TAG" STUB_MODE_FILE="$W/stubmode" bash "$GATE" --tunnel "$W/stub-tunnel" --state-dir "$W/state" \
        --coordinator "https://127.0.0.1:$PORT" --relay "127.0.0.1:$PORT" \
        --visit-resolve "$HOST:$PORT:127.0.0.1" --visitor-ca "$W/ca.pem" --timeout 4 "$@" 2>&1); rc=$?
  if [ "$rc" -eq "$want" ] && printf '%s' "$out" | grep -qF -- "$text"; then
    pass=$((pass + 1)); echo "  ok    $label"
  else
    fail=$((fail + 1)); echo "  FAIL  $label: exit $rc (wanted $want), wanted text: $text"; printf '%s\n' "$out" | sed 's/^/        /'
  fi
}

echo "tunnel-handshake-gate:"
run "control: tunnel up and the session page -> PASS"      0 "tunnel-gate: PASS"                      up     ok
run "no relay ticket -> FAIL at ticket"                     1 "FAIL at ticket"                         ticket ok
run "relay TLS refused -> FAIL at dial-auth"                1 "FAIL at dial-auth: the relay session"   auth   ok
run "the connector exits -> FAIL at dial-auth"              1 "the connector exited"                   exits  ok
run "no tunnel up in time -> FAIL at dial-auth"             1 "no \"tunnel up\" within 4s"             silent ok
run "a different page -> FAIL at serve"                     1 "not the connector's session page"       up     wrong
run "HTTP 500 -> FAIL at serve"                             1 "got HTTP 500"                           up     boom
run "no identity -> CANNOT TELL"                            2 "no enrolled gate identity"              up     ok     --state-dir "$W/nothing-here"
run "a session ends, the retry comes up -> PASS"            0 "tunnel-gate: PASS"                      retry  ok
# An outage or a dropped network HOLDS (2), never refuses (1): later arguments override the
# reachable ones in run().
run "coordinator unreachable -> CANNOT TELL, not FAIL"      2 "the coordinator (http://127.0.0.1:9)"   up     ok     --coordinator http://127.0.0.1:9
run "relay unreachable -> CANNOT TELL, not FAIL"            2 "the relay (127.0.0.1:9)"                up     ok     --relay 127.0.0.1:9
run "--visit-resolve for another host -> CANNOT TELL"       2 "but the gate's address is"              up     ok     --visit-resolve "other.kosmos.test:$PORT:127.0.0.1"

# No connector named at all.
out=$(bash "$GATE" --state-dir "$W/state" 2>&1); rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q 'no --tarball or --tunnel'; then pass=$((pass + 1)); echo "  ok    no --tarball or --tunnel -> CANNOT TELL"
else fail=$((fail + 1)); echo "  FAIL  no --tarball or --tunnel: exit $rc: $out"; fi

# --tarball (how promote-channel.sh calls it): the connector is taken from the tarball.
mkdir -p "$W/tb/app/bin" "$W/tb-empty/app/web"; cp "$W/stub-tunnel" "$W/tb/app/bin/kosmos-tunnel"
tar -czf "$W/with.tar.gz" -C "$W/tb" app; tar -czf "$W/without.tar.gz" -C "$W/tb-empty" app
tarball_case() {
  local label="$1" want="$2" text="$3" tb="$4"
  echo up > "$W/stubmode"; echo ok > "$W/mode"
  local out rc
  out=$(STUB_TAG="$TAG" STUB_MODE_FILE="$W/stubmode" bash "$GATE" --tarball "$tb" --state-dir "$W/state" \
        --coordinator "https://127.0.0.1:$PORT" --relay "127.0.0.1:$PORT" --visit-resolve "$HOST:$PORT:127.0.0.1" --visitor-ca "$W/ca.pem" --timeout 4 2>&1); rc=$?
  if [ "$rc" -eq "$want" ] && printf '%s' "$out" | grep -qF -- "$text"; then pass=$((pass + 1)); echo "  ok    $label"
  else fail=$((fail + 1)); echo "  FAIL  $label: exit $rc (wanted $want): $out"; fi
}
tarball_case "--tarball with a connector -> PASS"         0 "tunnel-gate: PASS"                   "$W/with.tar.gz"
tarball_case "--tarball without a connector -> CANNOT TELL" 2 "has no app/bin/kosmos-tunnel"       "$W/without.tar.gz"
tarball_case "--tarball that does not exist -> CANNOT TELL" 2 "no such tarball"                    "$W/nope.tar.gz"

# An earlier gate's connector still running -> CANNOT TELL. A stand-in with the command line a
# gate's connector has (its state dir under a tunnel-gate.* temp dir).
bash -c 'exec -a "kosmos-tunnel run --state-dir /nowhere/tunnel-gate.Stale1/state --coordinator x" sleep 30' &
STALE=$!
sleep 0.3
run "an earlier gate connector still running -> CANNOT TELL" 2 "gate's identity is still running" up ok
{ kill "$STALE"; wait "$STALE"; } 2>/dev/null
# A connector started by hand on the enrolled state dir itself holds the same identity.
bash -c "exec -a 'kosmos-tunnel run --state-dir $W/state --coordinator x' sleep 30" &
STALE=$!
sleep 0.3
run "a hand-started connector on the gate's state -> CANNOT TELL" 2 "gate's identity is still running" up ok
{ kill "$STALE"; wait "$STALE"; } 2>/dev/null
# Control: a connector on a DIFFERENT state dir (a prefix of the gate's name) is not the gate's.
bash -c "exec -a 'kosmos-tunnel run --state-dir $W/state-other --coordinator x' sleep 30" &
STALE=$!
sleep 0.3
run "control: another Mac's connector does not hold the gate" 0 "tunnel-gate: PASS" up ok
{ kill "$STALE"; wait "$STALE"; } 2>/dev/null

# A renewed certificate is carried back into the enrolled state dir (the connector runs on a
# copy). The PASS rows above are the control: they leave tls.crt as "x".
if [ "$(cat "$W/state/tls.crt")" = x ]; then pass=$((pass + 1)); echo "  ok    control: no renewal leaves the enrolled certificate alone"
else fail=$((fail + 1)); echo "  FAIL  the enrolled certificate changed with no renewal"; fi
run "a renewed certificate -> PASS"                         0 "kept the connector's renewed certificate" renew ok
if [ "$(cat "$W/state/tls.crt")" = renewed-crt ] && [ "$(cat "$W/state/tls.key")" = renewed-key ]; then
  pass=$((pass + 1)); echo "  ok    the renewed certificate and key are in the enrolled state dir"
else fail=$((fail + 1)); echo "  FAIL  the renewal was thrown away: tls.crt=$(cat "$W/state/tls.crt")"; fi

# No stub connector outlives its run (the gate's bounded stop). The stubs are named by this run's
# tag, so this finds a leaked one (it went red with the gate's cleanup emptied).
left=$(pgrep -f "kosmos-gate-stub-$TAG" | wc -l | tr -d ' ')
if [ "$left" = 0 ]; then pass=$((pass + 1)); echo "  ok    no connector left running"
else fail=$((fail + 1)); echo "  FAIL  $left stub connector(s) left running"; pkill -f "kosmos-gate-stub-$TAG"; fi

echo "test-tunnel-handshake-gate: $pass passed, $fail failed"
# 23 = every row above; equal to the count so a dropped row cannot pass.
[ "$fail" -eq 0 ] && [ "$pass" -eq 23 ]
