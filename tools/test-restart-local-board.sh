#!/bin/bash
# tools/test-restart-local-board.sh -- proves restart-local-board.sh's #2044 OUTCOME
# wait. It drives the poll logic in isolation via KOSMOS_BOARD_POLL_ONLY against a
# stub board (no launchd, no real restart), and asserts:
#   - the success arm: the board serves the wanted version -> exit 0
#   - the slow-but-healthy arm: the board serves an old version and flips to the
#     wanted one LATE -> still exit 0 (the exact case the old fixed 10s cap broke)
#   - the STALE arm (#360): the board keeps serving a DIFFERENT version -> exit 1
#   - the not-answering arm (#2109): nothing is listening -> exit 0 with a WARNING
#     (a silent board is down/restarting, not serving stale code; the release is
#     already served and verified, so it must not fail the cut)
#   - the divergence arm (#2109): stale (exit 1) and silent (exit 0) must NOT collapse
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
const DELAY = Number(process.env.DELAY || 0);  // ms to wait before responding (slow-board sim)
const srv = http.createServer((req, res) => {
  let v = '';
  try { v = fs.readFileSync(VF, 'utf8').trim(); } catch {}
  const send = () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ version: v })); };
  if (DELAY > 0) setTimeout(send, DELAY); else send();
});
srv.listen(0, '127.0.0.1', () => { fs.writeFileSync(PF, String(srv.address().port)); });
JS

VF="$T/ver"; PF="$T/port"
start_stub() {  # $1 = initial version served; STUB_DELAY (ms) delays each response
  rm -f "$PF"
  printf '%s' "$1" > "$VF"
  VF="$VF" PF="$PF" DELAY="${STUB_DELAY:-0}" node "$T/stub.js" &
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

# 2. Past-the-old-cap arm (the regression #2044 fixes): the stub serves an OLD
#    version and flips to WANT ~11s in -- PAST the old fixed ~10s poll cap (10x
#    `sleep 1`). With a 20s deadline the wait must SUCCEED, and it must have taken
#    MORE than 10s to do so. The old code would have exited 1 at ~10s on this exact
#    healthy-but-slow board; the elapsed assertion is what proves the window really
#    extended past the old cap rather than the arm passing for a cheaper reason.
#    (~11s runtime; this is the one deliberately slow arm.)
start_stub "old-1.2.3"
( sleep 11; printf '%s' "$WANT" > "$VF" ) &
t0="$(date +%s)"
out="$(KOSMOS_BOARD_POLL_ONLY=1 KOSMOS_BOARD_STATUS_URL="$URL" KOSMOS_BOARD_WANT="$WANT" KOSMOS_BOARD_WAIT_SECS=20 bash "$SCRIPT" 2>&1)"; rc=$?
elapsed=$(( $(date +%s) - t0 ))
if [ "$rc" -eq 0 ]; then pass "past-the-old-cap arm: flip at ~11s -> exit 0"; else fail "past-cap arm exit 0 (rc=$rc, out=$out)"; fi
if [ "$elapsed" -ge 10 ]; then pass "past-the-old-cap arm genuinely waited past the old ~10s cap (${elapsed}s)"; else fail "past-cap arm returned in ${elapsed}s; the old 10s cap would NOT have been exceeded, so it does not prove the fix"; fi
if has "$out" "back on ${WANT}"; then pass "past-cap arm confirms the board came back"; else fail "past-cap arm message: $out"; fi
stop_stub

# 3. STALE arm (#360, the perturbation that must go red): the stub keeps serving a
#    DIFFERENT non-empty version. After the deadline the step must exit 1 -- launchd
#    did not pick up the new code, the board is serving OLD bytes, which the fix must
#    NOT paper over.
start_stub "stale-0.0.0"
out="$(KOSMOS_BOARD_POLL_ONLY=1 KOSMOS_BOARD_STATUS_URL="$URL" KOSMOS_BOARD_WANT="$WANT" KOSMOS_BOARD_WAIT_SECS=2 bash "$SCRIPT" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "stale arm: keeps serving a different version -> exit 1"; else fail "stale arm exit 1 (rc=$rc, out=$out)"; fi
if has "$out" "STILL SERVING stale-0.0.0"; then pass "stale arm names the stale version being served"; else fail "stale arm message: $out"; fi
if has "$out" "NOT ${WANT}"; then pass "stale arm names the version it should be on"; else fail "stale arm want: $out"; fi
stop_stub

# 4. Not-answering arm (#2109): point at a port whose stub we just stopped -> nothing
#    is listening -> exit 0 with a WARNING. A DOWN board is NOT serving stale code
#    (it comes back on the code on disk), and the release is already served/verified,
#    so it must NOT fail the cut -- it warns.
start_stub "whatever"
deadurl="$URL"
stop_stub
sleep 0.3
out="$(KOSMOS_BOARD_POLL_ONLY=1 KOSMOS_BOARD_STATUS_URL="$deadurl" KOSMOS_BOARD_WANT="$WANT" KOSMOS_BOARD_WAIT_SECS=2 bash "$SCRIPT" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ]; then pass "not-answering arm: no board -> exit 0 (warns, does not fail the cut)"; else fail "not-answering arm exit 0 (rc=$rc, out=$out)"; fi
if has "$out" "WARNING"; then pass "not-answering arm prints a WARNING"; else fail "not-answering arm warning: $out"; fi
if has "$out" "NOT failed"; then pass "not-answering arm says the cut is not failed"; else fail "not-answering arm not-failed message: $out"; fi

# 4b. Divergence arm (#2109): stale (a different version) and silent (no answer) must
#     produce DIFFERENT exit codes -- a regression that collapses them back to the
#     same code is exactly what this guards. Reuses arms 3 and 4: stale rc must be 1,
#     silent rc must be 0.
start_stub "stale-0.0.0"
stale_out="$(KOSMOS_BOARD_POLL_ONLY=1 KOSMOS_BOARD_STATUS_URL="$URL" KOSMOS_BOARD_WANT="$WANT" KOSMOS_BOARD_WAIT_SECS=2 bash "$SCRIPT" 2>&1)"; stale_rc=$?
sdead="$URL"; stop_stub; sleep 0.3
silent_out="$(KOSMOS_BOARD_POLL_ONLY=1 KOSMOS_BOARD_STATUS_URL="$sdead" KOSMOS_BOARD_WANT="$WANT" KOSMOS_BOARD_WAIT_SECS=2 bash "$SCRIPT" 2>&1)"; silent_rc=$?
if [ "$stale_rc" -eq 1 ] && [ "$silent_rc" -eq 0 ]; then pass "divergence: stale exits 1, silent exits 0 (they do not collapse)"; else fail "divergence: stale_rc=$stale_rc silent_rc=$silent_rc"; fi

# 4c. Slow-stale arm (#2109 review): a STALE board that is UP but SLOW under load --
#     its short (3s) in-loop poll times out and returns empty (looks like "not
#     answering"), but the PATIENT (10s) final poll reveals it is serving OLD code ->
#     exit 1. Without the patient poll this misclassifies as silent (exit 0) and ships
#     stale code to the review board silently. The stub delays each response 4s: past
#     the 3s in-loop timeout, within the 10s patient timeout. (~7s runtime.)
STUB_DELAY=4000
start_stub "stale-0.0.0"
out="$(KOSMOS_BOARD_POLL_ONLY=1 KOSMOS_BOARD_STATUS_URL="$URL" KOSMOS_BOARD_WANT="$WANT" KOSMOS_BOARD_WAIT_SECS=2 bash "$SCRIPT" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "slow-stale arm: a slow-but-stale board is caught by the patient final poll -> exit 1"; else fail "slow-stale arm exit 1 (rc=$rc, out=$out)"; fi
if has "$out" "STILL SERVING stale-0.0.0"; then pass "slow-stale arm names the stale version the patient poll saw"; else fail "slow-stale arm message: $out"; fi
unset STUB_DELAY
stop_stub

# 5. Bad-knob arm: a non-numeric KOSMOS_BOARD_WAIT_SECS is refused with a clear
#    message, not a cryptic set -e abort on the arithmetic. The validation runs
#    before any wait, so the dead URL is never contacted.
out="$(KOSMOS_BOARD_POLL_ONLY=1 KOSMOS_BOARD_STATUS_URL="http://127.0.0.1:1/api/status" KOSMOS_BOARD_WANT="$WANT" KOSMOS_BOARD_WAIT_SECS="45s" bash "$SCRIPT" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "must be a non-negative integer"; then pass "bad-knob arm: non-numeric KOSMOS_BOARD_WAIT_SECS is refused"; else fail "bad-knob arm (rc=$rc, out=$out)"; fi

# 6. Empty-want arm: if the wanted version cannot be determined (empty), that is a
#    failure -- NOT a false 'back on ' success against a silent board. The guard
#    fires before any poll, so this is instant.
out="$(KOSMOS_BOARD_POLL_ONLY=1 KOSMOS_BOARD_STATUS_URL="http://127.0.0.1:1/api/status" KOSMOS_BOARD_WANT="" KOSMOS_BOARD_WAIT_SECS=2 bash "$SCRIPT" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "wanted version is empty"; then pass "empty-want arm: an empty target is a failure, not a false pass"; else fail "empty-want arm (rc=$rc, out=$out)"; fi

# 7. Zero-padded knob arm: an all-digit but zero-padded KOSMOS_BOARD_WAIT_SECS like
#    '08' (NOT valid octal) must be read as decimal 8, not abort the arithmetic with
#    "value too great for base" -- the exact cryptic abort the knob guard exists to
#    close. Board already serves WANT, so this exits 0 fast.
start_stub "$WANT"
out="$(KOSMOS_BOARD_POLL_ONLY=1 KOSMOS_BOARD_STATUS_URL="$URL" KOSMOS_BOARD_WANT="$WANT" KOSMOS_BOARD_WAIT_SECS=08 bash "$SCRIPT" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && ! has "$out" "value too great for base"; then pass "zero-padded knob arm: '08' is decimal 8, not an octal abort"; else fail "zero-padded knob arm (rc=$rc, out=$out)"; fi
stop_stub

echo ""
if [ "$fails" -eq 0 ]; then echo "ALL PASS"; else echo "$fails FAILED"; exit 1; fi
