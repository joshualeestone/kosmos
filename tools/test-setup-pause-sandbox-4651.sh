#!/bin/bash
# test-setup-pause-sandbox-4651.sh -- #4651: the update's pause, run from a sandboxed shell, must stop
# before anything is changed, and must tell the person to use a normal Terminal (never to kill the board).
#
# setup.sh is served as a single curl|sh file and sources nothing, so this extracts the REAL pause block
# (from the FRESH_INSTALL=no guard to its closing fi) and runs it in a harness: a throwaway KOSMOS_HOME, a
# stub `kosmos` whose stop does nothing (as a sandboxed stop does), and a node stub listener as the board.
# "Passed the pause" is the line the harness prints if the block lets the update go on to replace files.
#
# Two seatbelt profiles, both measured on a Mac (2026-09-30):
#   A (deny network-outbound): curl exits 7, lsof still sees the listener, ps is denied.
#   B (A + deny process-info*): curl exits 7 and lsof FAILS ("Operation not permitted"). Before #4651 the
#     block read that failure as "nothing listening" and passed the pause under a live board.
# Controls outside any sandbox: a free port passes, and a listener that accepts but never answers still
# gets the existing "kill <pid>" advice (curl times out there; it does not fail to connect).
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SETUP="$HERE/install/setup.sh"
[ -f "$SETUP" ] || { echo "FAIL: cannot find install/setup.sh at $SETUP" >&2; exit 1; }
if [ ! -x /usr/bin/sandbox-exec ]; then
  # A Mac without sandbox-exec is a broken runner, not a reason to go green without testing anything.
  if [ "$(uname -s)" = Darwin ]; then echo "FAIL: /usr/bin/sandbox-exec is missing on this Mac" >&2; exit 1; fi
  echo "SKIP: no sandbox-exec (not a Mac)"; exit 0
fi
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "FAIL: node is needed for the stub listener" >&2; exit 1; }

BLOCK="$(awk '/^if \[ "\$FRESH_INSTALL" = "no" \] && \[ -f "\$KOSMOS_HOME\/bin\/kosmos" \]/{f=1} f{print} f && /^fi$/{exit}' "$SETUP")"
case "$BLOCK" in
  *'pausing Kosmos for the update'*'rm -f "$LOG_DIR/update-abort"'*) ;;
  *) echo "FAIL: could not extract the pause block (anchor drift?)" >&2; exit 1 ;;
esac

PROFILE_A='(version 1)(allow default)(deny network-outbound)'
PROFILE_B='(version 1)(allow default)(deny network-outbound)(deny process-info*)'
# C: B with writes to the temp folders denied too, so the check cannot lean on a temp file to see lsof fail.
PROFILE_C='(version 1)(allow default)(deny network-outbound)(deny process-info*)(deny file-write* (subpath "/private/var/folders") (subpath "/private/tmp"))'

T="$(mktemp -d "${TMPDIR:-/tmp}/pause4651.XXXXXX")"
LISTENER=""
cleanup() { if [ -n "$LISTENER" ]; then kill "$LISTENER" 2>/dev/null; fi; rm -rf "$T"; }
trap cleanup EXIT
mkdir -p "$T/home/bin" "$T/logs"
printf '#!/bin/sh\nexit 0\n' > "$T/home/bin/kosmos"; chmod +x "$T/home/bin/kosmos"
printf '%s\n' "$BLOCK" > "$T/pause.sh"
cat > "$T/run.sh" <<'EOF'
set -e
T="$1"; PORT="$2"
KOSMOS_HOME="$T/home"; LOG_DIR="$T/logs"; FRESH_INSTALL=no
info() { echo "INFO: $*"; }
die() { echo "DIE: $*"; exit 1; }
_kosmos_mode_keeps_board_off() { return 1; }
. "$T/pause.sh"
echo "PASSED THE PAUSE"
EOF

free_port() { "$NODE" -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"; }
# mode http: answers like a board. mode silent: accepts and never answers. mode v6: answers, on ::1 only.
start_listener() {
  "$NODE" -e "const m=process.argv[2];const p=+process.argv[1];
    if(m==='http'){require('http').createServer((q,r)=>r.end('<title>Kosmos</title>')).listen(p,'127.0.0.1')}
    else if(m==='v6'){require('http').createServer((q,r)=>r.end('<title>Kosmos</title>')).listen(p,'::1')}
    else{require('net').createServer(()=>{}).listen(p,'127.0.0.1')}
    setTimeout(()=>process.exit(0),120000)" "$1" "$2" &
  LISTENER=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    lsof -w -tiTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1 && return 0
    sleep 0.2
  done
  echo "FAIL: the stub listener never came up" >&2; exit 1
}
stop_listener() { if [ -n "$LISTENER" ]; then kill "$LISTENER" 2>/dev/null; wait "$LISTENER" 2>/dev/null; LISTENER=""; fi; }
run_pause() { # profile-or-empty port
  # /bin/sh: setup.sh ships as curl | sh, so the block runs in that dialect here too.
  if [ -n "$1" ]; then /usr/bin/sandbox-exec -p "$1" /bin/sh "$T/run.sh" "$T" "$2" 2>&1
  else /bin/sh "$T/run.sh" "$T" "$2" 2>&1; fi
}

FAILS=0
chk() { if eval "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; echo "      output: $OUT"; FAILS=$((FAILS + 1)); fi; }

# CONTROL: outside a sandbox, a free port passes the pause (the harness can pass, so a DIE below is the block's).
P="$(free_port)"; OUT="$(run_pause "" "$P")"
chk "control: outside a sandbox, a free port passes the pause" '[[ "$OUT" == *"PASSED THE PAUSE"* ]]'

# CONTROL: outside a sandbox, a listener that accepts but never answers keeps the existing kill advice.
P="$(free_port)"; start_listener "$P" silent; OUT="$(run_pause "" "$P")"; stop_listener
chk "control: outside a sandbox, a silent listener still gets the existing pid advice" '[[ "$OUT" == *"is still holding port"* && "$OUT" != *"normal Terminal"* ]]'

# Outside a sandbox, a listener on ::1 only (curl to 127.0.0.1 cannot connect, lsof sees it). This is an
# ordinary Terminal, so the words must still name the pid and say what to quit, not only "use a normal Terminal".
P="$(free_port)"; start_listener "$P" v6; OUT="$(run_pause "" "$P")"; V6PID="$LISTENER"; stop_listener
chk "outside a sandbox, a ::1-only listener stops the update and names its pid to quit" '[[ "$OUT" == *"DIE:"* && "$OUT" == *"quit the app with pid $V6PID"* ]]'

# A: lsof sees the live board, curl cannot connect. Must stop, and must not say to kill it.
P="$(free_port)"; start_listener "$P" http; OUT="$(run_pause "$PROFILE_A" "$P")"; stop_listener
chk "sandbox A, live board: the update stops before changing anything" '[[ "$OUT" == *"DIE:"* && "$OUT" != *"PASSED THE PAUSE"* ]]'
chk "sandbox A, live board: says to use a normal Terminal, never to kill the pid" '[[ "$OUT" == *"normal Terminal"* && "$OUT" != *"kill "* ]]'

# B: lsof is denied too. Before #4651 this PASSED the pause under a live board.
P="$(free_port)"; start_listener "$P" http; OUT="$(run_pause "$PROFILE_B" "$P")"; stop_listener
chk "sandbox B, live board: the update stops before changing anything (it passed before #4651)" '[[ "$OUT" == *"DIE:"* && "$OUT" != *"PASSED THE PAUSE"* ]]'
chk "sandbox B, live board: says to use a normal Terminal" '[[ "$OUT" == *"normal Terminal"* ]]'

# C: no file can be written, and lsof is denied. Must still stop.
P="$(free_port)"; start_listener "$P" http; OUT="$(run_pause "$PROFILE_C" "$P")"; stop_listener
chk "sandbox C (no temp writes either), live board: the update stops, and says to use a normal Terminal" '[[ "$OUT" == *"DIE:"* && "$OUT" == *"normal Terminal"* && "$OUT" != *"PASSED THE PAUSE"* ]]'

# B with nothing listening: the shell still cannot tell, so it stops too (fail closed, by decision).
P="$(free_port)"; OUT="$(run_pause "$PROFILE_B" "$P")"
chk "sandbox B, free port: still stops, because this shell cannot tell (fail closed)" '[[ "$OUT" == *"DIE:"* && "$OUT" == *"normal Terminal"* ]]'

echo "test-setup-pause-sandbox-4651: $FAILS failures"
[ "$FAILS" -eq 0 ]
