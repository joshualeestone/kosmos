#!/bin/bash
# Offline test for tools/tunnel-handshake-gate.sh (kosmos#4270). No relay, coordinator or network:
# STUB connectors print what the real one prints in each case (the real lines were captured from
# the shipped 0.7.05 kosmos-tunnel against a local relay), and a local HTTPS server with a
# throwaway CA stands in for the coordinator's /v1/meta and for the visit through the relay.
# Every verdict and exit code is pinned, with PASS controls, so a gate that refuses everything
# cannot read as a gate that works.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
GATE="$HERE/tunnel-handshake-gate.sh"
pass=0; fail=0
for t in openssl python3 curl shasum nc; do
  command -v "$t" >/dev/null 2>&1 || { echo "MISSING TOOL: $t"; exit 1; }
done

W="$(mktemp -d "${TMPDIR:-/tmp}/tunnelgate-test.XXXXXX")"
SRV=""
# The server's stop is wrapped so bash's "Terminated" job report does not read as a failure.
trap '{ [ -n "$SRV" ] && kill "$SRV" && wait "$SRV"; } 2>/dev/null; pkill -f "kosmos-gate-stub-$(basename "$W")" 2>/dev/null; rm -rf "$W"' EXIT
HOST=gate-test.kosmos.test

# A throwaway CA and a leaf for HOST, for the visitor's HTTPS.
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=gate test CA" \
  -keyout "$W/ca.key" -out "$W/ca.pem" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -subj "/CN=$HOST" -keyout "$W/leaf.key" -out "$W/leaf.csr" >/dev/null 2>&1
printf 'subjectAltName=DNS:%s\n' "$HOST" > "$W/san.ext"
openssl x509 -req -in "$W/leaf.csr" -CA "$W/ca.pem" -CAkey "$W/ca.key" -CAcreateserial -days 2 \
  -extfile "$W/san.ext" -out "$W/leaf.pem" >/dev/null 2>&1
[ -s "$W/leaf.pem" ] || { echo "could not make the test certificate"; exit 1; }

# The server: /v1/meta answers per $W/meta (ok -> 200, down -> 502, as Caddy does with the
# coordinator down); any other path is "the visit" and answers per $W/mode (ok -> the session
# page, wrong -> another page, boom -> 500). A stub that comes "up" writes its page into $W/mode,
# so each connector serves its own page.
PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
echo ok > "$W/mode"; echo ok > "$W/meta"
python3 - "$W" "$PORT" <<'PY' >/dev/null 2>&1 &
import http.server, ssl, sys
w, port = sys.argv[1], int(sys.argv[2])
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/v1/meta"):
            if open(w + "/meta").read().strip() == "down":
                self.send_response(502); self.end_headers(); return
            self.send_response(200); self.end_headers(); self.wfile.write(b"{}"); return
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
mkidentity() { mkdir -p "$1"; for f in mac_id mac_key tls.crt tls.key coordinator_pubkey; do echo x > "$1/$f"; done; echo "$HOST" > "$1/address"; }
mkidentity "$W/state"

# The stub connector. Its behaviour comes from the file named by $1's mode env: one mode per
# LINE, one line consumed per invocation (the last line repeats), so a connector can fail its
# first attempt and pass its second. It execs into a sleep NAMED with this run's tag, so the
# leak check at the end can find a stub that outlived its gate.
TAG="$(basename "$W")"
cat > "$W/stub-tunnel" <<'STUB'
#!/bin/bash
state=""; while [ $# -gt 0 ]; do [ "$1" = --state-dir ] && state="$2"; shift; done
n=$(( $(cat "$STUB_MODE_FILE.n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STUB_MODE_FILE.n"
mode="$(sed -n "${n}p" "$STUB_MODE_FILE")"; [ -n "$mode" ] || mode="$(tail -1 "$STUB_MODE_FILE")"
hold() { exec -a "kosmos-gate-stub-$STUB_TAG" sleep 60; }
up() { echo "$1" > "$STUB_PAGE_FILE"; echo "2026-09-28T01:21:47Z  INFO kosmos_tunnel_client::session: tunnel up relay=x hostname=y"; }
case "$mode" in
  up)       up ok; hold ;;
  wrong)    up wrong; hold ;;
  boom)     up boom; hold ;;
  ticket)   echo "2026-09-28T01:21:47Z  WARN kosmos_tunnel_client: session ended: Kosmos+ answered 502 for /v1/mac/relay-ticket"; hold ;;
  auth)     echo "2026-09-28T01:21:47Z  WARN kosmos_tunnel_client: session ended: relay TLS handshake: invalid peer certificate: UnknownIssuer"; hold ;;
  renew)    echo renewed-crt > "$state/tls.crt"; echo renewed-key > "$state/tls.key"; up ok; hold ;;
  renew2)   echo ctl-renewed-crt > "$state/tls.crt"; echo ctl-renewed-key > "$state/tls.key"; up ok; hold ;;
  renewbad) echo bad-crt > "$state/tls.crt"; echo bad-key > "$state/tls.key"; echo "session ended: relay TLS handshake: bad certificate"; hold ;;
  exits)    echo "error: something broke"; exit 1 ;;
  silent)   hold ;;
esac
STUB
chmod +x "$W/stub-tunnel"

# run <label> <want-exit> <want-text> <candidate modes> <control modes|-> [extra gate args...]
# Modes are space-separated, one per attempt. "-" runs with no control connector.
run() {
  local label="$1" want="$2" text="$3" cmodes="$4" kmodes="$5"; shift 5
  printf '%s\n' $cmodes > "$W/cand.mode"; rm -f "$W/cand.mode.n"
  printf '%s\n' $kmodes > "$W/ctl.mode"; rm -f "$W/ctl.mode.n"
  echo ok > "$W/mode"
  local ctl=(--control-tunnel "$W/control-tunnel"); [ "$kmodes" = - ] && ctl=()
  local out rc
  out=$(STUB_TAG="$TAG" STUB_PAGE_FILE="$W/mode" bash "$GATE" \
        --tunnel "$W/cand-tunnel" ${ctl[@]+"${ctl[@]}"} --state-dir "$W/state" \
        --coordinator "https://127.0.0.1:$PORT" --relay "127.0.0.1:$PORT" \
        --visit-resolve "$HOST:$PORT:127.0.0.1" --visitor-ca "$W/ca.pem" --timeout 6 "$@" 2>&1); rc=$?
  if [ "$rc" -eq "$want" ] && printf '%s' "$out" | grep -qF -- "$text"; then
    pass=$((pass + 1)); echo "  ok    $label"
  else
    fail=$((fail + 1)); echo "  FAIL  $label: exit $rc (wanted $want), wanted text: $text"; printf '%s\n' "$out" | sed 's/^/        /'
  fi
}
# The candidate and the control read DIFFERENT mode files: each is a tiny wrapper naming its own.
printf '#!/bin/bash\nSTUB_MODE_FILE=%q exec %q "$@"\n' "$W/cand.mode" "$W/stub-tunnel" > "$W/cand-tunnel"
printf '#!/bin/bash\nSTUB_MODE_FILE=%q exec %q "$@"\n' "$W/ctl.mode" "$W/stub-tunnel" > "$W/control-tunnel"
chmod +x "$W/cand-tunnel" "$W/control-tunnel"

echo "tunnel-handshake-gate:"
run "control: tunnel up and the session page -> PASS"                0 "tunnel-gate: PASS"                  "up"            "up"
# A broken build: fails twice around a control that passes.
run "no relay ticket, control passes -> FAIL at ticket"              1 "FAIL at ticket"                     "ticket"        "up"
run "relay TLS refused, control passes -> FAIL at dial-auth"         1 "FAIL at dial-auth: the relay session" "auth"        "up"
run "the connector exits, control passes -> FAIL at dial-auth"       1 "the connector exited"               "exits"         "up"
run "no tunnel up in time, control passes -> FAIL at dial-auth"      1 "no \"tunnel up\" within 6s"         "silent"        "up"
run "a different page, control passes -> FAIL at serve"              1 "not the connector's session page"   "wrong"         "up"
run "HTTP 500, control passes -> FAIL at serve"                      1 "got HTTP 500"                       "boom"          "up"
# The environment: the control fails too. This is the 502-mid-deploy / relay-restart / lapsed-
# identity family, whatever the connector's words, never a refusal.
run "the control fails too -> CANNOT TELL, not FAIL"                 2 "the served build's connector fails too" "ticket"    "ticket"
run "the control fails at serve too -> CANNOT TELL"                  2 "the served build's connector fails too" "boom"      "boom"
# A flaky environment: the candidate fails, the control passes, the candidate passes on retry.
run "the candidate passes on its second attempt -> PASS, says RETRY" 0 "on a RETRY; its first attempt failed at dial-auth" "auth up" "up"
# The environment changes DURING the retry: the second control fails, so it holds, never refuses.
run "candidate fails twice, the control then fails -> CANNOT TELL"   2 "the environment changed during the run" "auth"   "up ticket"
run "a candidate failure with no control -> CANNOT TELL"             2 "no control connector"               "auth"          "-"
run "a control that is not executable -> CANNOT TELL, says why"      2 "not an executable file"             "auth"          "up"   --control-tunnel "$W/nope"
# Preflight holds.
run "no identity -> CANNOT TELL"                                     2 "no enrolled gate identity"          "up"            "up"   --state-dir "$W/nothing-here"
run "coordinator unreachable -> CANNOT TELL"                         2 "the coordinator (http://127.0.0.1:9)" "up"          "up"   --coordinator http://127.0.0.1:9
echo down > "$W/meta"
run "coordinator answering 502 (Caddy, coordinator down) -> CANNOT TELL" 2 "/v1/meta gave '502'"          "up"            "up"
echo ok > "$W/meta"
run "relay unreachable -> CANNOT TELL"                               2 "the relay (127.0.0.1:9)"            "up"            "up"   --relay 127.0.0.1:9
run "--visit-resolve for another host -> CANNOT TELL"                2 "but the gate's address is"          "up"            "up"   --visit-resolve "other.kosmos.test:$PORT:127.0.0.1"

# No connector named at all.
out=$(bash "$GATE" --state-dir "$W/state" 2>&1); rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q 'no --tarball or --tunnel'; then pass=$((pass + 1)); echo "  ok    no --tarball or --tunnel -> CANNOT TELL"
else fail=$((fail + 1)); echo "  FAIL  no --tarball or --tunnel: exit $rc: $out"; fi

# A flag given last with no value refuses at once (it used to spin forever). Under an alarm, so
# a regression reads as a timeout (exit 142), not a hung suite.
out=$(perl -e 'alarm 10; exec @ARGV' bash "$GATE" --tunnel "$W/cand-tunnel" --state-dir 2>&1); rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q -- '--state-dir needs a value'; then pass=$((pass + 1)); echo "  ok    a flag with no value -> refuses at once"
else fail=$((fail + 1)); echo "  FAIL  a flag with no value: exit $rc: $out"; fi

# --tarball / --control-tarball (how promote-channel.sh calls it): connectors come from tarballs.
mkdir -p "$W/tb/app/bin" "$W/tb-empty/app/web" "$W/tbc/app/bin"
cp "$W/cand-tunnel" "$W/tb/app/bin/kosmos-tunnel"; cp "$W/control-tunnel" "$W/tbc/app/bin/kosmos-tunnel"
tar -czf "$W/with.tar.gz" -C "$W/tb" app; tar -czf "$W/without.tar.gz" -C "$W/tb-empty" app; tar -czf "$W/ctl.tar.gz" -C "$W/tbc" app
tarball_case() {
  local label="$1" want="$2" text="$3" cmodes="$4" tb="$5"; shift 5
  printf '%s\n' $cmodes > "$W/cand.mode"; rm -f "$W/cand.mode.n"; echo up > "$W/ctl.mode"; rm -f "$W/ctl.mode.n"; echo ok > "$W/mode"
  local out rc
  # The extra arguments go LAST so they override the defaults (the gate takes the last value of a
  # flag). They once went first, and two rows silently tested the defaults instead.
  out=$(STUB_TAG="$TAG" STUB_PAGE_FILE="$W/mode" bash "$GATE" --tarball "$tb" --state-dir "$W/state" \
        --coordinator "https://127.0.0.1:$PORT" --relay "127.0.0.1:$PORT" \
        --visit-resolve "$HOST:$PORT:127.0.0.1" --visitor-ca "$W/ca.pem" --timeout 6 "$@" 2>&1); rc=$?
  if [ "$rc" -eq "$want" ] && printf '%s' "$out" | grep -qF -- "$text"; then pass=$((pass + 1)); echo "  ok    $label"
  else fail=$((fail + 1)); echo "  FAIL  $label: exit $rc (wanted $want): $out"; fi
}
tarball_case "--tarball with a connector -> PASS"                     0 "tunnel-gate: PASS"            up   "$W/with.tar.gz"
tarball_case "--tarball WITHOUT a connector -> FAIL (a build defect)" 1 "FAIL at build"                up   "$W/without.tar.gz"
tarball_case "--tarball that does not exist -> CANNOT TELL"           2 "no such tarball"              up   "$W/nope.tar.gz"
tarball_case "no connector during an outage is still FAIL, not an outage" 1 "FAIL at build"          up   "$W/without.tar.gz" --coordinator http://127.0.0.1:9
tarball_case "no connector with NO identity enrolled is still FAIL"   1 "FAIL at build"                up   "$W/without.tar.gz" --state-dir "$W/nothing-here"
# Listed but not extractable here (a dangling link stands in for a full disk): the machine's
# problem, not the build's.
mkdir -p "$W/tbl/app/bin"; ln -s /nowhere/kosmos-tunnel "$W/tbl/app/bin/kosmos-tunnel"; tar -czf "$W/dangling.tar.gz" -C "$W/tbl" app
tarball_case "a connector listed but not extracted -> CANNOT TELL"    2 "could not extract"            up   "$W/dangling.tar.gz"
tarball_case "--control-tarball arbitrates a broken candidate -> FAIL" 1 "FAIL at dial-auth"           auth "$W/with.tar.gz" --control-tarball "$W/ctl.tar.gz"
tarball_case "--control-tarball with no connector -> CANNOT TELL, says why" 2 "gave no connector"      auth "$W/with.tar.gz" --control-tarball "$W/without.tar.gz"

# Another connector with the gate's identity -> CANNOT TELL. Stand-ins carry the command line a
# connector has: first a SIGKILLed earlier gate's (a tunnel-gate.* temp dir), then one started by
# hand on the enrolled state dir, then (control) another Mac's.
standin() { bash -c "exec -a 'kosmos-tunnel run${2:- --state-dir }$1 --coordinator x' sleep 30" & STALE=$!; sleep 0.3; }
unstand() { { kill "$STALE"; wait "$STALE"; } 2>/dev/null; }
standin "/nowhere/tunnel-gate.Stale1/a1/state"
run "an earlier gate's connector still running -> CANNOT TELL"       2 "gate's identity is still running"   "up" "up"; unstand
standin "$W/state"
run "a hand-started connector on the gate's state -> CANNOT TELL"    2 "gate's identity is still running"   "up" "up"; unstand
standin "$W/state" " --state-dir="
run "the same, started as --state-dir=DIR -> CANNOT TELL"          2 "gate's identity is still running"   "up" "up"; unstand
standin "$W/state" " --coordinator x --state-dir "
run "the same, with --state-dir after another flag -> CANNOT TELL"  2 "gate's identity is still running"   "up" "up"; unstand
standin "$W/state-other"
run "control: another Mac's connector does not hold the gate"        0 "tunnel-gate: PASS"                  "up" "up"; unstand
# The state path is ESCAPED for the regex: '+' would otherwise be a quantifier, and "st+ate"
# would never match itself, so a hand-started connector there would go unseen.
mkidentity "$W/st+ate"
standin "$W/st+ate"
run "a state path with a regex metachar is escaped -> CANNOT TELL"   2 "gate's identity is still running"   "up" "up" --state-dir "$W/st+ate"; unstand

# One gate at a time: a lock held by a LIVE gate holds; a lock left by a dead one is taken over.
mkdir "$W/state.gate-lock"; sleep 30 & LIVE=$!; echo "$LIVE" > "$W/state.gate-lock/pid"
run "another gate run holds the lock -> CANNOT TELL"                 2 "another gate run holds this identity" "up" "up"
{ kill "$LIVE"; wait "$LIVE"; } 2>/dev/null
run "a lock left by a dead gate is taken over -> PASS"               0 "tunnel-gate: PASS"                  "up" "up"
# A lock with no pid yet: its owner is between mkdir and writing it. Young -> held; old -> taken.
mkdir "$W/state.gate-lock"
run "a fresh lock with no pid yet -> CANNOT TELL"                    2 "taking this identity's lock right now" "up" "up"
touch -t 202001010000 "$W/state.gate-lock"
run "an old lock with no pid -> taken over, PASS"                    0 "tunnel-gate: PASS"                  "up" "up"
if [ -e "$W/state.gate-lock" ]; then fail=$((fail + 1)); echo "  FAIL  the gate left its lock behind"
else pass=$((pass + 1)); echo "  ok    the gate removes its lock"; fi

# A renewed certificate is carried back from a PASSING attempt only. The PASS rows above are the
# control: they leave tls.crt as "x".
if [ "$(cat "$W/state/tls.crt")" = x ]; then pass=$((pass + 1)); echo "  ok    control: no renewal leaves the enrolled certificate alone"
else fail=$((fail + 1)); echo "  FAIL  the enrolled certificate changed with no renewal"; fi
run "a failing build's renewed certificate is NOT kept -> FAIL"       1 "FAIL at dial-auth"                 "renewbad"  "up"
if [ "$(cat "$W/state/tls.crt")" = x ]; then pass=$((pass + 1)); echo "  ok    a failed attempt's certificate never reaches the enrolled state"
else fail=$((fail + 1)); echo "  FAIL  a failed attempt's certificate was kept: tls.crt=$(cat "$W/state/tls.crt")"; fi
run "a passing renewal -> PASS"                                       0 "kept the connector's renewed certificate" "renew" "up"
if [ "$(cat "$W/state/tls.crt")" = renewed-crt ] && [ "$(cat "$W/state/tls.key")" = renewed-key ]; then
  pass=$((pass + 1)); echo "  ok    the renewed certificate and key are in the enrolled state dir"
else fail=$((fail + 1)); echo "  FAIL  the renewal was thrown away: tls.crt=$(cat "$W/state/tls.crt")"; fi

# A real FAIL whose LAST control attempt renewed (and served with) a new pair keeps that pair.
run "a renewal by the second control, on a FAIL -> kept"           1 "kept the connector's renewed certificate" "auth"  "up renew2"
if [ "$(cat "$W/state/tls.crt")" = ctl-renewed-crt ]; then pass=$((pass + 1)); echo "  ok    the second control's renewal is in the enrolled state dir"
else fail=$((fail + 1)); echo "  FAIL  the second control's renewal was dropped: tls.crt=$(cat "$W/state/tls.crt")"; fi

# The takeover lock: a fresh one holds; one left by a gate killed mid-takeover (old) is recovered.
# A dead pid from a child that exits by itself. NOT a killed `sleep &`: a child killed before its
# exec still holds this script's EXIT trap and would run it, deleting $W (it did, once).
sh -c 'exit 0' & DEAD=$!; wait "$DEAD"
mkdir "$W/state.gate-lock"; echo "$DEAD" > "$W/state.gate-lock/pid"; mkdir "$W/state.gate-lock.takeover"
run "a fresh takeover lock -> CANNOT TELL"                          2 "taking over this identity's lock"   "up" "up"
touch -t 202001010000 "$W/state.gate-lock.takeover"
run "a takeover lock left by a killed gate -> recovered, PASS"      0 "tunnel-gate: PASS"                  "up" "up"
if [ -e "$W/state.gate-lock.takeover" ] || [ -e "$W/state.gate-lock" ]; then fail=$((fail + 1)); echo "  FAIL  a lock was left behind"
else pass=$((pass + 1)); echo "  ok    no lock left behind after a takeover"; fi

# No stub connector outlives its run (the gate's bounded stop). The stubs are named by this run's
# tag, so this finds a leaked one (it went red with the gate's stop emptied).
left=$(pgrep -f "kosmos-gate-stub-$TAG" | wc -l | tr -d ' ')
if [ "$left" = 0 ]; then pass=$((pass + 1)); echo "  ok    no connector left running"
else fail=$((fail + 1)); echo "  FAIL  $left stub connector(s) left running"; pkill -f "kosmos-gate-stub-$TAG"; fi

echo "test-tunnel-handshake-gate: $pass passed, $fail failed"
# 50 = every row above; equal to the count so a dropped row cannot pass.
[ "$fail" -eq 0 ] && [ "$pass" -eq 50 ]
