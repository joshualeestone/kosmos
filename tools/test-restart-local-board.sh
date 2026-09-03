#!/bin/bash
# tools/test-restart-local-board.sh -- proves restart-local-board.sh's #2044 OUTCOME
# wait. It drives the poll logic in isolation via KOSMOS_BOARD_POLL_ONLY against a
# stub board (no launchd, no real restart), and asserts:
#   - the success arm: the board serves the wanted version -> exit 0
#   - the slow-but-healthy arm: the board serves an old version and flips to the
#     wanted one LATE -> still exit 0 (the exact case the old fixed 10s cap broke)
#   - the failure arm: the board never serves the wanted version -> exit 1
#   - the not-answering arm: nothing is listening -> exit 1
# A check that has only ever seen a healthy machine has not been tested.
#
#   bash tools/test-restart-local-board.sh
set -uo pipefail
SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/tools/restart-local-board.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/test-relboard.XXXXXX")"
STUB_PID=""
trap 'kill "${STUB_PID:-}" 2>/dev/null; rm -rf "$T"' EXIT
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

WANT="9.9.9-test"

# A stub board: serves /api/status = {version: <trim of $VF>}, re-reading VF on each
# request so the test can flip the served version mid-run. Listens on an ephemeral
# port and writes the actual port to $PF.
cat > "$T/stub.js" <<'JS'
const http = require('http'), fs = require('fs');
const VF = process.env.VF, PF = process.env.PF;
const srv = http.createServer((req, res) => {
  let v = '';
  try { v = fs.readFileSync(VF, 'utf8').trim(); } catch {}
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ version: v }));
});
srv.listen(0, '127.0.0.1', () => { fs.writeFileSync(PF, String(srv.address().port)); });
JS

VF="$T/ver"; PF="$T/port"
start_stub() {  # $1 = initial version served
  rm -f "$PF"
  printf '%s' "$1" > "$VF"
  VF="$VF" PF="$PF" node "$T/stub.js" &
  STUB_PID=$!
  disown "$STUB_PID" 2>/dev/null || true   # keep bash from printing a "Terminated" notice on kill
  local _
  for _ in $(seq 1 50); do [ -s "$PF" ] && break; sleep 0.1; done
  PORT="$(cat "$PF" 2>/dev/null)"
  URL="http://127.0.0.1:${PORT}/api/status"
}
stop_stub() { kill "${STUB_PID:-}" 2>/dev/null; STUB_PID=""; }

# Control: the stub actually serves what we write, and 'stale' differs from WANT, so
# a later "reached WANT" proves movement rather than a coincidence.
start_stub "stale-0.0.0"
got="$(curl -s -m 3 "$URL" 2>/dev/null)"
if has "$got" "stale-0.0.0"; then pass "control: the stub serves the version we set"; else fail "control: stub not serving (got: $got, url: $URL)"; fi
if [ "stale-0.0.0" != "$WANT" ]; then pass "control: stale version differs from WANT"; else fail "control: stale must differ from WANT"; fi
stop_stub

# 1. Success arm: the stub already serves WANT -> exit 0, promptly.
start_stub "$WANT"
out="$(KOSMOS_BOARD_POLL_ONLY=1 KOSMOS_BOARD_STATUS_URL="$URL" KOSMOS_BOARD_WANT="$WANT" KOSMOS_BOARD_WAIT_SECS=10 bash "$SCRIPT" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ]; then pass "success arm: board on WANT -> exit 0"; else fail "success arm exit 0 (rc=$rc, out=$out)"; fi
if has "$out" "back on ${WANT}"; then pass "success arm names the version"; else fail "success arm message: $out"; fi
stop_stub

# 2. Slow-but-healthy arm: the stub serves an OLD version, then flips to WANT ~2s in.
#    With a 20s deadline the wait must SUCCEED -- this is the exact case the old fixed
#    ~10s cap broke (a healthy board answering just past the cap). It proves the wait
#    tracks the OUTCOME, not a fixed window.
start_stub "old-1.2.3"
( sleep 2; printf '%s' "$WANT" > "$VF" ) &
out="$(KOSMOS_BOARD_POLL_ONLY=1 KOSMOS_BOARD_STATUS_URL="$URL" KOSMOS_BOARD_WANT="$WANT" KOSMOS_BOARD_WAIT_SECS=20 bash "$SCRIPT" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ]; then pass "slow-but-healthy arm: late flip to WANT -> exit 0"; else fail "slow arm exit 0 (rc=$rc, out=$out)"; fi
if has "$out" "back on ${WANT}"; then pass "slow arm confirms the board came back"; else fail "slow arm message: $out"; fi
stop_stub

# 3. Failure arm (the perturbation that must go red): the stub NEVER serves WANT.
#    After a short deadline the step must exit 1, naming the last answer -- a genuine
#    stale board is still a failure, which the fix must not paper over.
start_stub "stale-0.0.0"
out="$(KOSMOS_BOARD_POLL_ONLY=1 KOSMOS_BOARD_STATUS_URL="$URL" KOSMOS_BOARD_WANT="$WANT" KOSMOS_BOARD_WAIT_SECS=2 bash "$SCRIPT" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "failure arm: never reaches WANT -> exit 1"; else fail "failure arm exit 1 (rc=$rc, out=$out)"; fi
if has "$out" "DID NOT COME BACK ON ${WANT}"; then pass "failure arm names the fault"; else fail "failure arm message: $out"; fi
if has "$out" "last answer: 'stale-0.0.0'"; then pass "failure arm reports the last version seen"; else fail "failure arm last-answer: $out"; fi
stop_stub

# 4. Not-answering arm: point at a port whose stub we just stopped -> nothing is
#    listening -> exit 1 with last answer 'none'. A board that is DOWN is a failure,
#    distinct from one serving stale code.
start_stub "whatever"
deadurl="$URL"
stop_stub
sleep 0.3
out="$(KOSMOS_BOARD_POLL_ONLY=1 KOSMOS_BOARD_STATUS_URL="$deadurl" KOSMOS_BOARD_WANT="$WANT" KOSMOS_BOARD_WAIT_SECS=2 bash "$SCRIPT" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "not-answering arm: no board -> exit 1"; else fail "not-answering arm exit 1 (rc=$rc, out=$out)"; fi
if has "$out" "last answer: 'none'"; then pass "not-answering arm reports 'none'"; else fail "not-answering arm message: $out"; fi

echo ""
if [ "$fails" -eq 0 ]; then echo "ALL PASS"; else echo "$fails FAILED"; exit 1; fi
