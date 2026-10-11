#!/bin/bash
# test-setup-pause-sandbox-4651.sh -- #4651: the update's pause, run from a sandboxed shell, must stop
# before anything is changed, and must tell the person to use a normal Terminal (never to kill the board).
#
# setup.sh is served as a single curl|sh file and sources nothing, so this extracts the REAL pause block
# (from the FRESH_INSTALL=no guard to its closing fi) and runs it in a harness: a throwaway KOSMOS_HOME, a
# stub `kosmos` whose verbs do nothing
# (as #4636's stop does in a sandbox), except that start fails when STUBSTART=fail, and a node stub listener as the board.
# "Passed the pause" is the line the harness prints if the block lets the update go on to replace files.
#
# Three seatbelt profiles, measured on a Mac (2026-09-30):
#   A (deny network-outbound): curl cannot connect, lsof still sees the listener, ps is denied.
#   B (A + deny process-info*): lsof FAILS ("Operation not permitted"). Before #4651 the block read that
#     failure as "nothing listening" and passed the pause under a live board.
#   C (B + no writes to the temp folders).
# Outside any sandbox: a free port passes, a listener that accepts but never answers keeps the existing
# "kill <pid>" advice, and a listener on ::1 only gets words that name its pid.
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SETUP="$HERE/install/setup.sh"
[ -f "$SETUP" ] || { echo "FAIL: cannot find install/setup.sh at $SETUP" >&2; exit 1; }
if [ ! -x /usr/bin/sandbox-exec ]; then
  # A Mac without sandbox-exec is a broken runner, not a reason to go green without testing anything.
  if [ "$(uname -s)" = Darwin ]; then echo "FAIL: /usr/bin/sandbox-exec is missing on this Mac" >&2; exit 1; fi
  echo "SKIP: no sandbox-exec (not a Mac)"; exit 0
fi
# A shell that is itself sandboxed cannot start a nested sandbox: say so plainly rather than fail every arm.
if ! /usr/bin/sandbox-exec -p '(version 1)(allow default)' /usr/bin/true 2>/dev/null; then
  echo "FAIL: sandbox-exec cannot start a sandbox here (is this shell already sandboxed?)" >&2; exit 1
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
# C: B with writes to the temp folders denied too.
PROFILE_C='(version 1)(allow default)(deny network-outbound)(deny process-info*)(deny file-write* (subpath "/private/var/folders") (subpath "/private/tmp"))'

T="$(mktemp -d "${TMPDIR:-/tmp}/pause4651.XXXXXX")"
LISTENER=""
cleanup() { if [ -n "$LISTENER" ]; then kill "$LISTENER" 2>/dev/null; fi; rm -rf "$T"; }
trap cleanup EXIT
mkdir -p "$T/home/bin" "$T/logs"
printf '#!/bin/sh\nif [ "$1" = start ] && [ "${STUBSTART:-ok}" = fail ]; then exit 1; fi\nexit 0\n' > "$T/home/bin/kosmos"; chmod +x "$T/home/bin/kosmos"
PUTBACK="$(awk '/^_kosmos_put_board_back\(\) \{/{f=1} f{print} f && /^\}$/{exit}' "$SETUP")"
case "$PUTBACK" in *'could not be started again'*) ;; *) echo "FAIL: could not extract _kosmos_put_board_back (anchor drift?)" >&2; exit 1 ;; esac
printf '%s\n' "$PUTBACK" > "$T/putback.sh"
# #4675: the stops record through this function, defined above the block in setup.sh.
NOTE="$(awk '/^_kosmos_note_pause_abort\(\) \{/{f=1} f{print} f && /^\}$/{exit}' "$SETUP")"
case "$NOTE" in *'reason=%s'*) ;; *) echo "FAIL: could not extract _kosmos_note_pause_abort (anchor drift?)" >&2; exit 1 ;; esac
printf '%s\n' "$NOTE" > "$T/note.sh"
# setup.sh reads the board's marker once, defaults it to no, and takes it out of the environment (it goes on to start
# the board, whose agents must not inherit it). Those lines are lifted and RUN here, not mirrored: from the default to
# the unset.
BYBOARD_LINES="$(awk '/^_kosmos_by_board=no$/{f=1} f{print} f && /^unset KOSMOS_UPDATE_BY_BOARD$/{exit}' "$SETUP")"
case "$BYBOARD_LINES" in
  '_kosmos_by_board=no'*'KOSMOS_UPDATE_BY_BOARD'*'unset KOSMOS_UPDATE_BY_BOARD') ;;
  *) echo "FAIL: could not extract the lines that read KOSMOS_UPDATE_BY_BOARD (anchor drift?)" >&2; exit 1 ;;
esac
[ "$(printf '%s\n' "$BYBOARD_LINES" | wc -l | tr -d ' ')" -le 4 ] || { echo "FAIL: the KOSMOS_UPDATE_BY_BOARD lines lifted more than expected" >&2; exit 1; }
printf '%s\n' "$BYBOARD_LINES" > "$T/byboard.sh"
# setup.sh must initialise the flag at the top level itself (it runs under set -u); the harness mirrors that line.
grep -q '^_kosmos_putback_unsure=no' "$SETUP" || { echo "FAIL: setup.sh does not initialise _kosmos_putback_unsure" >&2; exit 1; }
printf '%s\n' "$BLOCK" > "$T/pause.sh"
cat > "$T/run.sh" <<'EOF'
set -eu
T="$1"; PORT="$2"
KOSMOS_HOME="$T/home"; LOG_DIR="$T/logs"; FRESH_INSTALL=no
info() { echo "INFO: $*"; }
die() {
  echo "DIE: $*"
  echo "STATE put-back=${_kosmos_paused_board:-unset} unsure=${_kosmos_putback_unsure:-unset}"
  _kosmos_put_board_back 2>&1   # as setup.sh's EXIT trap does on a failed exit
  exit 1
}
_kosmos_board_decide() { _kosmos_board_off=no; }
. "$T/putback.sh"
. "$T/note.sh"
. "$T/byboard.sh"   # setup.sh's own lines: reads KOSMOS_UPDATE_BY_BOARD from this run's environment, then unsets it
echo "BYBOARD=$_kosmos_by_board child-sees=$(/bin/sh -c 'echo "${KOSMOS_UPDATE_BY_BOARD:-gone}"')"
_kosmos_mode_keeps_board_off() { return 1; }
# #4920: the block gives an old Linux unit KillMode=process before its stop; here (no systemd unit) it is a no-op.
_kosmos_linux_unit_killmode() { :; }
# As setup.sh sets them above the block (the block reads them).
_kosmos_was_running=no; _kosmos_paused_board=no; _kosmos_marker_ours=no; _kosmos_putback_unsure=no
if [ -n "${PRESTOPPED:-}" ]; then : > "$KOSMOS_HOME/board.stopped"; fi
. "$T/pause.sh"
echo "PASSED THE PAUSE"
EOF

free_port() { "$NODE" -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"; }
# mode http: answers like a board. mode silent: accepts and never answers. mode v6: answers, on ::1 only.
# mode banner: speaks first and not HTTP, as ssh does (curl exits 1 on it, measured).
start_listener() {
  "$NODE" -e "const m=process.argv[2];const p=+process.argv[1];
    if(m==='http'){require('http').createServer((q,r)=>r.end('<title>Kosmos</title>')).listen(p,'127.0.0.1')}
    else if(m==='banner'){require('net').createServer(c=>c.write('SSH-2.0-OpenSSH_9.6\r\n')).listen(p,'127.0.0.1')}
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
  rm -f "$T/home/board.stopped"   # outside the sandbox: profile C cannot remove it
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
chk "control: the third stop (a process that answers) is not marked unsure" '[[ "$OUT" == *"STATE put-back=yes unsure=no"* ]]'

# Outside a sandbox, a listener that speaks first and not HTTP keeps the existing pid advice too.
P="$(free_port)"; start_listener "$P" banner; OUT="$(run_pause "" "$P")"; stop_listener
chk "control: outside a sandbox, a non-HTTP banner listener keeps the existing pid advice" '[[ "$OUT" == *"is still holding port"* && "$OUT" != *"normal Terminal"* ]]'

# Outside a sandbox, a listener on ::1 only (curl to 127.0.0.1 cannot connect, lsof sees it). This is an
# ordinary Terminal, so the words must still name the pid and say what to quit, not only "use a normal Terminal".
P="$(free_port)"; start_listener "$P" v6; OUT="$(run_pause "" "$P")"; V6PID="$LISTENER"; stop_listener
chk "outside a sandbox, a ::1-only listener stops the update and names its pid to quit" '[[ "$OUT" == *"DIE:"* && "$OUT" == *"quit the app with pid $V6PID"* ]]'
chk "outside a sandbox, a ::1-only listener: the put-back still runs (it can start the board here), marked unsure" '[[ "$OUT" == *"STATE put-back=yes unsure=yes"* && "$OUT" == *"Kosmos is running ("* && "$OUT" != *"running again"* ]]'

# A with nothing listening: lsof works and finds nothing, so the board really stopped. Must PASS: failing closed
# on an unreadable port must not turn into refusing every update from a sandboxed shell.
P="$(free_port)"; OUT="$(run_pause "$PROFILE_A" "$P")"
chk "sandbox A, free port: passes the pause (the board really stopped)" '[[ "$OUT" == *"PASSED THE PAUSE"* ]]'

# A: lsof sees the live board, curl cannot connect. Must stop, and must not say to kill it.
P="$(free_port)"; start_listener "$P" http; OUT="$(run_pause "$PROFILE_A" "$P")"; stop_listener
chk "sandbox A, live board: the update stops before changing anything" '[[ "$OUT" == *"DIE:"* && "$OUT" != *"PASSED THE PAUSE"* ]]'
chk "sandbox A, live board: says to use a normal Terminal, never to kill the pid" '[[ "$OUT" == *"normal Terminal"* && "$OUT" != *"kill "* ]]'
chk "sandbox A, live board: the put-back still runs, marked unsure" '[[ "$OUT" == *"STATE put-back=yes unsure=yes"* ]]'

# B: lsof is denied too. Before #4651 this PASSED the pause under a live board.
P="$(free_port)"; start_listener "$P" http; OUT="$(run_pause "$PROFILE_B" "$P")"; stop_listener
chk "sandbox B, live board: the update stops before changing anything (it passed before #4651)" '[[ "$OUT" == *"DIE:"* && "$OUT" != *"PASSED THE PAUSE"* ]]'
chk "sandbox B, live board: says to use a normal Terminal, and shows what the port check said" '[[ "$OUT" == *"normal Terminal"* && "$OUT" == *"Operation not permitted"* ]]'
chk "sandbox B, live board: the put-back still runs, marked unsure" '[[ "$OUT" == *"STATE put-back=yes unsure=yes"* ]]'
# B, but the person had stopped the board before the run (board.stopped already there): nothing is put back.
P="$(free_port)"; start_listener "$P" http; OUT="$(PRESTOPPED=1 run_pause "$PROFILE_B" "$P")"; stop_listener
chk "sandbox B, a board the person stopped: nothing is put back" '[[ "$OUT" == *"DIE:"* && "$OUT" == *"STATE put-back=no"* && "$OUT" != *"Kosmos is running"* ]]'

# C: no file can be written, and lsof is denied. Must still stop.
P="$(free_port)"; start_listener "$P" http; OUT="$(run_pause "$PROFILE_C" "$P")"; stop_listener
chk "sandbox C (no temp writes either), live board: the update stops, and says to use a normal Terminal" '[[ "$OUT" == *"DIE:"* && "$OUT" == *"normal Terminal"* && "$OUT" != *"PASSED THE PAUSE"* ]]'
chk "sandbox C, live board: the put-back still runs, marked unsure" '[[ "$OUT" == *"STATE put-back=yes unsure=yes"* ]]'

# B with nothing listening: the shell still cannot tell, so it stops too (fail closed, by decision).
P="$(free_port)"; OUT="$(run_pause "$PROFILE_B" "$P")"
chk "sandbox B, free port: still stops, because this shell cannot tell (fail closed)" '[[ "$OUT" == *"DIE:"* && "$OUT" == *"normal Terminal"* ]]'
chk "sandbox B, free port: the put-back still runs, marked unsure" '[[ "$OUT" == *"STATE put-back=yes unsure=yes"* ]]'

# A, and the put-back's start fails (it cannot start a board from this shell): the words must not claim a pause.
P="$(free_port)"; start_listener "$P" http; OUT="$(STUBSTART=fail run_pause "$PROFILE_A" "$P")"; stop_listener
chk "sandbox A, the start fails: says to open the app or run kosmos start, never that Kosmos was paused" '[[ "$OUT" == *"If Kosmos is not running, open the Kosmos app, or run: kosmos start (from a normal Terminal)."* && "$OUT" != *"was paused"* ]]'
# B (the FIRST stop: the port check itself failed), and the start fails: the same neutral words.
P="$(free_port)"; start_listener "$P" http; OUT="$(STUBSTART=fail run_pause "$PROFILE_B" "$P")"; stop_listener
chk "sandbox B, the start fails: the first stop's words never say Kosmos was paused either" '[[ "$OUT" == *"If Kosmos is not running, open the Kosmos app, or run: kosmos start (from a normal Terminal)."* && "$OUT" != *"was paused"* ]]'
# CONTROL: the third stop with a failing start keeps main's own words.
P="$(free_port)"; start_listener "$P" silent; OUT="$(STUBSTART=fail run_pause "" "$P")"; stop_listener
chk "control: the third stop with a failing start keeps main's words (#4818)" '[[ "$OUT" == *"Kosmos was paused for this update and could not be started again"* ]]'

# ---- #4675: when the BOARD started the run, each stop after the pause is recorded with its own reason -------------
# The marker is read from outside any sandbox. count is the whole streak, same counts back over the latest reason; a
# pass clears it.
MARK="$T/logs/update-abort"
reason_is() { grep -q "^reason=$1\$" "$MARK" 2>/dev/null; }
count_is() { [ "$(sed -n 's/^count=//p' "$MARK" 2>/dev/null)" = "$1" ]; }
same_is() { [ "$(sed -n 's/^same=//p' "$MARK" 2>/dev/null)" = "$1" ]; }
rm -f "$MARK"
# CONTROL: the same three stops from a pasted install line (no marker from the board) record nothing.
P="$(free_port)"; start_listener "$P" silent; OUT="$(run_pause "" "$P")"; stop_listener
chk "control: a pasted run stopping at a held port records nothing" '[[ "$OUT" == *"DIE:"* && "$OUT" == *"BYBOARD=no child-sees=gone"* ]] && [ ! -e "$MARK" ]'
P="$(free_port)"; start_listener "$P" v6; OUT="$(run_pause "" "$P")"; stop_listener
chk "control: a pasted run stopping at an unreachable holder records nothing" '[[ "$OUT" == *"DIE:"* ]] && [ ! -e "$MARK" ]'
P="$(free_port)"; start_listener "$P" http; OUT="$(run_pause "$PROFILE_B" "$P")"; stop_listener
chk "control: a pasted run in a sandbox, stopping at a failed port check, records nothing" '[[ "$OUT" == *"DIE:"* ]] && [ ! -e "$MARK" ]'
# Only the value 1 is the board. Anything else in the variable is a pasted run, and is unset all the same.
P="$(free_port)"; start_listener "$P" silent; OUT="$(KOSMOS_UPDATE_BY_BOARD=yes run_pause "" "$P")"; stop_listener
chk "KOSMOS_UPDATE_BY_BOARD=yes is not the board: nothing recorded, and the variable is gone for children" '[[ "$OUT" == *"BYBOARD=no child-sees=gone"* ]] && [ ! -e "$MARK" ]'
# The board's run: the third stop, twice, so the count is seen to run.
P="$(free_port)"; start_listener "$P" silent; OUT="$(KOSMOS_UPDATE_BY_BOARD=1 run_pause "" "$P")"; stop_listener
chk "the board's run: the marker is read, then gone from the environment the board will be started in" '[[ "$OUT" == *"BYBOARD=yes child-sees=gone"* ]]'
chk "the board's run stopping at a held port records port-still-held, count 1" '[[ "$OUT" == *"is still holding port"* ]] && reason_is port-still-held && count_is 1'
P="$(free_port)"; start_listener "$P" silent; OUT="$(KOSMOS_UPDATE_BY_BOARD=1 run_pause "" "$P")"; stop_listener
chk "the same stop again: count 2, same 2" 'reason_is port-still-held && count_is 2 && same_is 2'
# The second stop: a different reason. The streak goes on; same starts again.
P="$(free_port)"; start_listener "$P" v6; OUT="$(KOSMOS_UPDATE_BY_BOARD=1 run_pause "" "$P")"; stop_listener
chk "the board's run stopping at an unreachable holder records port-unreachable, count 3, same 1" '[[ "$OUT" == *"check of it failed"* ]] && reason_is port-unreachable && count_is 3 && same_is 1'
# The first stop (the port check itself fails), with the same words as before.
P="$(free_port)"; start_listener "$P" http; OUT="$(KOSMOS_UPDATE_BY_BOARD=1 run_pause "$PROFILE_B" "$P")"; stop_listener
chk "the board's run stopping at a failed port check records port-check-failed, count 4, same 1" '[[ "$OUT" == *"the port check failed"* ]] && reason_is port-check-failed && count_is 4 && same_is 1'
# A pasted run after that leaves the board's streak as it was.
P="$(free_port)"; start_listener "$P" silent; OUT="$(run_pause "" "$P")"; stop_listener
chk "a pasted run that stops leaves the board's streak as it was" '[[ "$OUT" == *"DIE:"* ]] && reason_is port-check-failed && count_is 4 && same_is 1'
# C cannot write the marker at all: the stop must still stop, with its own words, and the marker is as it was.
P="$(free_port)"; start_listener "$P" http; OUT="$(KOSMOS_UPDATE_BY_BOARD=1 run_pause "$PROFILE_C" "$P")"; stop_listener
chk "sandbox C, the board's run: an unwritable marker does not change the stop, and is left as it was" '[[ "$OUT" == *"DIE:"* && "$OUT" == *"the port check failed"* && "$OUT" != *"PASSED THE PAUSE"* ]] && reason_is port-check-failed && count_is 4 && same_is 1'
# An update that gets past the pause clears the streak, whoever ran it.
P="$(free_port)"; OUT="$(run_pause "" "$P")"
chk "an update that passes the pause clears the streak" '[[ "$OUT" == *"PASSED THE PAUSE"* ]] && [ ! -e "$MARK" ]'

echo "test-setup-pause-sandbox-4651: $FAILS failures"
[ "$FAILS" -eq 0 ]
