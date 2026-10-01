#!/bin/sh
# test-update-putback-4818.sh -- setup.sh's #4818 put-back: an update that FAILS after it paused a board that was
# running starts that board again (no board.stopped, the old board answering on its port, a line saying which
# version is back). A board that was stopped before the run stays stopped (the card's control), and a failure
# after the new board started restarts nothing.
#
# setup.sh is served as one curl|sh file and sources nothing, so this extracts the exact shipped bytes (the
# BEGIN/END #4818 block, and the was-running check at the pause) and drives them in a child sh with a temp
# KOSMOS_HOME, a free port, and a fake `kosmos` whose start serves a page on that port and whose stop writes
# board.stopped, as the real one does.
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SETUP="$HERE/install/setup.sh"
[ -f "$SETUP" ] || { echo "FAIL: cannot find install/setup.sh at $SETUP" >&2; exit 1; }

BLOCK="$(awk '/^# BEGIN #4818 put-back$/{f=1; next} /^# END #4818 put-back$/{f=0} f' "$SETUP")"
case "$BLOCK" in *"_kosmos_put_board_back()"*"trap '_kosmos_on_exit' EXIT"*) : ;;
  *) echo "FAIL: could not extract the #4818 put-back block (anchor drift?)" >&2; exit 1 ;; esac
WASRUN="$(awk '/if ! _kosmos_mode_keeps_board_off && \[ ! -e "\$KOSMOS_HOME\/board.stopped" \]/{f=1} f{print} f && /^  fi$/{exit}' "$SETUP")"
case "$WASRUN" in *"_kosmos_was_running=yes"*"app/server.js"*|*"app/server.js"*"_kosmos_was_running=yes"*) : ;;
  *) echo "FAIL: could not extract the #4818 was-running check (anchor drift?)" >&2; exit 1 ;; esac
PAUSED="$(awk '/^  _kosmos_paused_board="\$_kosmos_was_running"$/{print; exit}' "$SETUP")"
case "$PAUSED" in *'_kosmos_paused_board="$_kosmos_was_running"'*) : ;;
  *) echo "FAIL: could not extract the #4818 pause-held line (anchor drift?)" >&2; exit 1 ;; esac

# The shipped mode readers (review 1: the put-back reads the mode again), the line that clears the flag once the
# new board started, and die().
MODEFNS="$(awk '/^_kosmos_mode_read\(\) \{$/{f=1} f{print} f && /^_kosmos_mode_keeps_board_off\(\) \{$/{g=1} g && /^}$/{exit}' "$SETUP")"
case "$MODEFNS" in *"_kosmos_board_decide() {"*"_kosmos_mode_keeps_board_off() {"*) : ;;
  *) echo "FAIL: could not extract the mode functions (anchor drift?)" >&2; exit 1 ;; esac
STARTED="$(awk '/_kosmos_paused_board=no   # #4818: the new board started/{print; exit}' "$SETUP")"
case "$STARTED" in *"_kosmos_paused_board=no"*) : ;;
  *) echo "FAIL: could not extract the #4818 started line (anchor drift?)" >&2; exit 1 ;; esac
DIEFN="$(awk '/^die\(\)   \{$/{f=1} f{print} f && /^}$/{exit}' "$SETUP")"
case "$DIEFN" in *"exit 1"*) : ;;
  *) echo "FAIL: could not extract die() (anchor drift?)" >&2; exit 1 ;; esac

PASS=0; FAIL=0

# Review 3: WHERE the put-back is armed. After the three dies that must not restart (our board still running,
# another install's board, another app on the port) and before the port wait, whose die (a survivor holding the
# port) and whose hang-up window must restart. Checked by line order in the shipped file.
ln() { grep -n -F "$1" "$SETUP" | head -1 | cut -d: -f1; }
L_ARM=$(ln '  _kosmos_paused_board="$_kosmos_was_running"')
L_OURS=$(ln 'die "A Kosmos board is still running on port $PORT and could not be paused')
L_APP=$(ln 'die "Another app on this computer is using port $PORT, which Kosmos needs.')
L_SURV=$(ln 'die "A process is still holding port $PORT after the pause')
if [ -n "$L_ARM" ] && [ -n "$L_OURS" ] && [ -n "$L_APP" ] && [ -n "$L_SURV" ]; then :; else
  echo "FAIL: could not find the pause dies or the arming line (anchor drift?)" >&2; exit 1; fi
pass() { echo "PASS  $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL  $1"; FAIL=$((FAIL + 1)); }
# Normalised (TMPDIR ends in a slash on macOS): setup matches its board by the exact path in its command line.
TMP="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/putback4818.XXXXXX")" && pwd)"
cleanup() {
  for pf in "$TMP"/*/board.pid; do [ -f "$pf" ] && kill "$(cat "$pf")" 2>/dev/null; done
  rm -rf "$TMP"
}
trap cleanup EXIT

free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'; }

# home <name> -> a KOSMOS_HOME with a fake kosmos and a 0.7.11 app.
home() {
  h="$TMP/$1"; mkdir -p "$h/bin" "$h/app" "$h/www"
  printf '{\n  "name": "kosmos",\n  "version": "0.7.11"\n}\n' > "$h/app/package.json"
  printf '<html>Kosmos</html>\n' > "$h/www/index.html"
  # The fake board's program sits at app/server.js, so its command line names that path as the real board's does
  # (setup recognises its own board by board.pid plus that path).
  cat > "$h/app/server.js" <<'EOF'
import http.server, os, sys
os.chdir(sys.argv[2])
http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), http.server.SimpleHTTPRequestHandler).serve_forever()
EOF
  cat > "$h/bin/kosmos" <<'EOF'
#!/bin/sh
H="$(cd "$(dirname "$0")/.." && pwd)"
case "$1" in
  start)
    [ -f "$H/board.pid" ] && kill -0 "$(cat "$H/board.pid")" 2>/dev/null && exit 0
    python3 "$H/app/server.js" "$PORT" "$H/www" >/dev/null 2>&1 &
    echo $! > "$H/board.pid"
    i=0; while [ $i -lt 50 ]; do curl -fsS -m 1 -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && exit 0; sleep 0.1; i=$((i + 1)); done
    exit 1 ;;
  stop)
    [ -f "$H/board.pid" ] && kill "$(cat "$H/board.pid")" 2>/dev/null
    rm -f "$H/board.pid"; : > "$H/board.stopped"
    i=0; while [ $i -lt 50 ]; do curl -fsS -m 1 -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null || exit 0; sleep 0.1; i=$((i + 1)); done
    exit 0 ;;
esac
EOF
  chmod +x "$h/bin/kosmos"
  echo "$h"
}
answers() { curl -fsS -m 2 -o /dev/null "http://127.0.0.1:$1/" 2>/dev/null; }

# run <home> <port> <script> -> runs the shipped bytes plus <script> in a child sh; stderr to <home>/err.
run() {
  KOSMOS_HOME="$1" PORT="$2" LOG="$1/no-log" sh -c "set -eu
$MODEFNS
$DIEFN
_kosmos_board_decide   # as setup.sh does just before the pause
$BLOCK
$WASRUN
$3" 2> "$1/err"
}

if [ "$L_OURS" -lt "$L_ARM" ] && [ "$L_APP" -lt "$L_ARM" ] && [ "$L_ARM" -lt "$L_SURV" ]; then
  pass "the put-back is armed after the dies that must not restart and before the port wait that must"
else
  fail "the put-back is armed in the wrong place (arm $L_ARM, ours $L_OURS, app $L_APP, survivor $L_SURV)"
fi

# 1. Running before the pause, the update pauses it and then FAILS: the board is put back.
P=$(free_port); H=$(home running); export PORT=$P
"$H/bin/kosmos" start
answers "$P" || fail "setup: the fake board did not start"
run "$H" "$P" '"$KOSMOS_HOME/bin/kosmos" stop --force
'"$PAUSED"'
exit 1'
if answers "$P"; then pass "a failed update puts back a board it paused: the old board answers on its port"; else fail "a failed update left the paused board off"; fi
if [ ! -e "$H/board.stopped" ]; then pass "and board.stopped is gone (launchd's KeepAlive keys on it)"; else fail "board.stopped was left behind"; fi
if grep -q "running again (0.7.11)" "$H/err"; then pass "and it says which version is running"; else fail "no 'running again (0.7.11)' line: $(cat "$H/err")"; fi

# 1b. Review 4: a BUSY board (ours, alive, but not answering within any probe) still counts as running, because it is
#     recognised by board.pid and its command line, not by an HTTP answer. Its program here never listens at all.
H=$(home busy)
cat > "$H/app/server.js" <<'EOF'
import time
time.sleep(60)
EOF
python3 "$H/app/server.js" >/dev/null 2>&1 &
echo $! > "$H/board.pid"
r=$(KOSMOS_HOME="$H" PORT=1 sh -c "set -eu
$MODEFNS
_kosmos_board_decide
_kosmos_was_running=no
$WASRUN
echo \$_kosmos_was_running")
kill "$(cat "$H/board.pid")" 2>/dev/null; rm -f "$H/board.pid"
if [ "$r" = yes ]; then pass "a busy board that does not answer still counts as running (by pid and path)"; else fail "a busy board read as not running (got '$r')"; fi

# 1c. Review 4: another install's board answering on the port, with our board.pid pointing at something else, is NOT
#     ours: the put-back is not armed for it.
P=$(free_port); O=$(home other); export PORT=$P
"$O/bin/kosmos" start
H=$(home notours)
sleep 60 & echo $! > "$H/board.pid"
r=$(KOSMOS_HOME="$H" PORT=$P sh -c "set -eu
$MODEFNS
_kosmos_board_decide
_kosmos_was_running=no
$WASRUN
echo \$_kosmos_was_running")
kill "$(cat "$H/board.pid")" 2>/dev/null; rm -f "$H/board.pid"
if [ "$r" = no ]; then pass "another install's board answering on the port does not count as ours"; else fail "another install's answering board counted as ours (got '$r')"; fi

# 2. CONTROL: the board was stopped before the run (board.stopped present, nothing answering): it stays stopped.
P=$(free_port); H=$(home stopped); export PORT=$P
: > "$H/board.stopped"
run "$H" "$P" '"$KOSMOS_HOME/bin/kosmos" stop --force
'"$PAUSED"'
exit 1'
if answers "$P"; then fail "a board the person had stopped was started by a failed update"; else pass "control: a board stopped before the run stays stopped after a failed update"; fi
if [ -e "$H/board.stopped" ]; then pass "and its board.stopped is kept"; else fail "the person's board.stopped was removed"; fi

# 2b. CONTROL: the board answers but board.stopped is there (the person asked for it off; something still serves).
#     The marker is the person's choice, so a failed update does not start the board again.
P=$(free_port); H=$(home marked); export PORT=$P
"$H/bin/kosmos" start
: > "$H/board.stopped"
run "$H" "$P" '"$KOSMOS_HOME/bin/kosmos" stop --force
'"$PAUSED"'
exit 1'
if answers "$P"; then fail "a board marked stopped was started by a failed update"; else pass "control: a board marked stopped stays stopped even though it was answering"; fi

# 3. A failure AFTER the new board started restarts nothing (the flag is cleared there).
P=$(free_port); H=$(home started); export PORT=$P
"$H/bin/kosmos" start
run "$H" "$P" '"$KOSMOS_HOME/bin/kosmos" stop --force
'"$PAUSED"'
'"$STARTED"'
exit 1'
if answers "$P"; then fail "a failure after the new board started restarted a board"; else pass "a failure after the new board started restarts nothing"; fi

# 3b. A failure through die() (a sentence and exit 1, the common way setup fails) puts the board back too.
P=$(free_port); H=$(home died); export PORT=$P
"$H/bin/kosmos" start
run "$H" "$P" '"$KOSMOS_HOME/bin/kosmos" stop --force
'"$PAUSED"'
die "the download failed"'
if answers "$P" && [ ! -e "$H/board.stopped" ]; then pass "a failure through die() puts the board back"; else fail "a failure through die() left the board off"; fi

# 3d. Review 2: a plain failing command under set -e (no die) puts the board back.
P=$(free_port); H=$(home sete); export PORT=$P
"$H/bin/kosmos" start
run "$H" "$P" '"$KOSMOS_HOME/bin/kosmos" stop --force
'"$PAUSED"'
false
echo "not reached"'
if answers "$P"; then pass "a set -e failure (a command that fails, no die) puts the board back"; else fail "a set -e failure left the board off"; fi

# 3e. Review 2: the window is closed during the download (a hang-up), or the run is sent TERM: the board is put back.
for sig in HUP TERM; do
  P=$(free_port); H=$(home "sig$sig"); export PORT=$P
  "$H/bin/kosmos" start
  run "$H" "$P" '"$KOSMOS_HOME/bin/kosmos" stop --force
'"$PAUSED"'
echo $$ > "$KOSMOS_HOME/paused"
sleep 20' &
  rp=$!
  i=0; while [ $i -lt 100 ] && [ ! -e "$H/paused" ]; do sleep 0.1; i=$((i + 1)); done
  if [ ! -s "$H/paused" ]; then fail "the $sig arm never reached the pause, so it proves nothing"; continue; fi
  # As a closed window or a TERM to the job does: the signal reaches the shell AND what it is running (its children,
  # by exact pid), not the shell alone, which would wait for its foreground command first. Wait until the shell's
  # `sleep` exists (review 3: the pid file is written just before it is forked).
  sp="$(cat "$H/paused")"; kids=""
  i=0; while [ $i -lt 50 ] && [ -z "$kids" ]; do kids="$(pgrep -P "$sp" 2>/dev/null | tr '\n' ' ')"; [ -n "$kids" ] || sleep 0.1; i=$((i + 1)); done
  sent=$(date +%s); kill -s "$sig" "$sp" $kids 2>/dev/null; wait "$rp" 2>/dev/null
  [ $(( $(date +%s) - sent )) -lt 10 ] || fail "the $sig did not end the run (it ran out its sleep), so it proves nothing"
  i=0; while [ $i -lt 50 ] && ! answers "$P"; do sleep 0.1; i=$((i + 1)); done
  if answers "$P"; then pass "a $sig during the update puts the board back"; else fail "a $sig during the update left the board off"; fi
done

# 3c. Review 1: the person switches this computer to connect elsewhere DURING the run (the mode file says so), and
#     the run then fails: the board stays off.
P=$(free_port); H=$(home connect); export PORT=$P
"$H/bin/kosmos" start
run "$H" "$P" '"$KOSMOS_HOME/bin/kosmos" stop --force
'"$PAUSED"'
printf connect > "$KOSMOS_HOME/mode"
exit 1'
if answers "$P"; then fail "a board switched to connect during the run was started by a failed update"; else pass "a board switched to connect during the run stays off after a failed update"; fi

# 4. A run that succeeds (exit 0) after the pause does not start anything either.
P=$(free_port); H=$(home succeeded); export PORT=$P
"$H/bin/kosmos" start
run "$H" "$P" '"$KOSMOS_HOME/bin/kosmos" stop --force
'"$PAUSED"'
exit 0'
if answers "$P"; then fail "a run that exited 0 started the board from the exit trap"; else pass "a run that succeeds does not use the put-back"; fi

echo "---"
echo "update put-back (#4818): $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
