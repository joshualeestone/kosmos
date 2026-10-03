#!/usr/bin/env bash
# test-staging-experience-check.sh - exercises the CI-runnable arms of the #2036
# experience check. The USABLE (exit 0) path needs a live enforcing board (mint +
# redeem + /api/*), which CI does not have; it is validated by hand against a running
# board and that is stated below, not faked. What CI CAN prove is that the check
# discriminates: a non-enforcing state is cannot-tell (2), and a down board is a loud
# alarm (1) rather than a false pass.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK="$HERE/staging-experience-check.sh"
fail=0
pass() { printf 'PASS  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fail=1; }

# cannot-tell: a store root with NO board.token is a non-enforcing (sandbox / from-
# source) board, exactly the state the card says cannot test the update experience.
TMPROOT="$(mktemp -d "${TMPDIR:-/tmp}/staging-exp-test.XXXXXXXX")"
KOSMOS_STORE_ROOT="$TMPROOT" bash "$CHECK" 16180 >/dev/null 2>&1
rc=$?; rm -rf "$TMPROOT"
[ "$rc" = 2 ] && pass "no board.token -> cannot-tell (exit 2)" || bad "no board.token should exit 2, got $rc"

# alarm: an enforcing store root (a token present) but a port with no board -> the
# nonce mint cannot succeed -> exit 1. This proves a board it cannot reach reads as a
# LOUD failure, never a silent pass.
TMPROOT2="$(mktemp -d "${TMPDIR:-/tmp}/staging-exp-test.XXXXXXXX")"
printf 'deadbeefdeadbeef\n' > "$TMPROOT2/board.token"
KOSMOS_STORE_ROOT="$TMPROOT2" bash "$CHECK" 19998 >/dev/null 2>&1
rc=$?; rm -rf "$TMPROOT2"
[ "$rc" = 1 ] && pass "enforcing but board unreachable -> alarm (exit 1)" || bad "unreachable board should exit 1, got $rc"

# #5084: WHICH version the gate checked. A fake enforcing board (node, loopback, a free port) answers the
# requests the gate makes, and reports a version of our choosing from GET /api/version. It
# proves: a board on another version than KOSMOS_GATE_EXPECT_VERSION is cannot-tell (2) and says so; a
# board whose version cannot be read is cannot-tell too; a matching board passes and names its version;
# and with no expected version the gate behaves as before (back-compatible for a hand run).
FAKE="$(mktemp -d "${TMPDIR:-/tmp}/staging-exp-fake.XXXXXXXX")"
printf 'feedfacefeedface\n' > "$FAKE/board.token"
cat > "$FAKE/board.js" <<'JS'
const http = require('node:http');
const [tok, ver] = [process.argv[2], process.argv[3]];
const s = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x'); const ok = q.headers['x-kosmos-board-token'] === tok;
  const cookie = /kosmos_board=1/.test(q.headers.cookie || '');
  const j = (c, o) => { r.writeHead(c, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (q.method === 'POST' && u.pathname === '/api/board-nonce') return ok ? j(200, { nonce: 'abcdef12' }) : j(403, {});
  if (q.method === 'GET' && u.pathname === '/api/version') return ok ? (ver ? j(200, { running: ver }) : j(404, {})) : j(403, {});
  // Round 1 of #5084: POST /api/update/check can START an install on a real board; the gate must never send it.
  if (u.pathname === '/api/update/check') { require('node:fs').appendFileSync(process.argv[4], q.method + ' /api/update/check\n'); return j(200, { running: ver }); }
  if (u.pathname === '/' && u.searchParams.get('boot') === 'abcdef12') { r.writeHead(302, { location: '/', 'set-cookie': 'kosmos_board=1; Path=/; HttpOnly' }); return r.end(); }
  if (u.pathname === '/api/accounts') return cookie ? j(200, []) : j(403, {});
  j(404, {});
});
s.listen(0, '127.0.0.1', () => process.stdout.write(String(s.address().port) + '\n'));
JS
fake_gate() {   # $1 board version ("" = none reported), $2 expected ("" = unset); prints rc then the output
  node "$FAKE/board.js" feedfacefeedface "$1" "$FAKE/forbidden" > "$FAKE/port" 2>/dev/null & local pid=$!
  local i=0; while [ ! -s "$FAKE/port" ] && [ $i -lt 50 ]; do sleep 0.1; i=$((i+1)); done
  local port; port="$(head -1 "$FAKE/port")"
  # A fake that never started would leave the port empty, and an empty arg sends the gate to KOSMOS_PORT/16180,
  # a real board. Refuse rather than test against it.
  if [ -z "$port" ]; then kill "$pid" 2>/dev/null; printf '99\nthe fake board did not start\n'; return; fi
  local out rc
  if [ -n "$2" ]; then out="$(KOSMOS_GATE_EXPECT_VERSION="$2" KOSMOS_STORE_ROOT="$FAKE" bash "$CHECK" "$port" 2>&1)"; rc=$?
  else out="$(env -u KOSMOS_GATE_EXPECT_VERSION KOSMOS_STORE_ROOT="$FAKE" bash "$CHECK" "$port" 2>&1)"; rc=$?; fi
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; rm -f "$FAKE/port"
  printf '%s\n%s\n' "$rc" "$out"
}
r="$(fake_gate 0.7.18 0.7.19)"
[ "$(printf '%s' "$r" | head -1)" = 2 ] && case "$r" in *"runs 0.7.18, not 0.7.19"*"another release"*"KOSMOS_GATE_EXPECT_VERSION=0.7.19 bash $HERE/staging-experience-check.sh"*) true;; *) false;; esac \
  && pass "#5084: a board on the previous release is cannot-tell (exit 2) and says which version it runs" || bad "#5084 previous-release board: $r"
r="$(fake_gate "" 0.7.19)"
[ "$(printf '%s' "$r" | head -1)" = 2 ] && case "$r" in *"could not read which version"*"HTTP 404, a board older than this route"*) true;; *) false;; esac \
  && pass "#5084: a board whose version cannot be read is cannot-tell (exit 2)" || bad "#5084 unreadable version: $r"
r="$(fake_gate 0.7.19 0.7.19)"
[ "$(printf '%s' "$r" | head -1)" = 0 ] && case "$r" in *"USABLE on 0.7.19:"*) true;; *) false;; esac \
  && pass "#5084: a board on the expected version passes and names it (USABLE on 0.7.19)" || bad "#5084 matching board: $r"
r="$(fake_gate 0.7.18 "")"
[ "$(printf '%s' "$r" | head -1)" = 0 ] && case "$r" in *"USABLE on 0.7.18:"*) true;; *) false;; esac \
  && pass "#5084: with no expected version the gate passes as before and names what it checked" || bad "#5084 no expectation: $r"
[ ! -s "$FAKE/forbidden" ] && pass "#5084: the gate never sent POST /api/update/check (it can start an install)" || bad "#5084: the gate sent $(cat "$FAKE/forbidden")"
rm -rf "${FAKE:?}"

# The exit-0 USABLE path is also exercised above against the #5084 fake board (the four requests the gate
# makes); a REAL board is still validated by hand, since the fake answers what the gate asks, not what Kosmos does.
printf 'NOTE  the exit-0 path runs here against a fake board; a real board is validated by hand\n'

if [ "$fail" = 0 ]; then
  echo "test-staging-experience-check: all CI-runnable arms passed"
  exit 0
fi
echo "test-staging-experience-check: FAILURES above"
exit 1
