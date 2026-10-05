#!/bin/bash
# kosmos#5231: when a check's board dies between attempts, the run must say why before cleanup removes the sandbox.
# This exercises the REAL board_log_tail and wait_up, extracted from tools/browser-checks.sh (as
# test-wait-up-collision-1073.sh does), against the exact failure line from the card's Mortals run.
RUNNER="${RUNNER:-$(cd "$(dirname "$0")/.." && pwd)/tools/browser-checks.sh}"   # as test-wait-up-collision-1073.sh: from anywhere
[ -r "$RUNNER" ] || { echo "FAIL  $RUNNER not found"; exit 1; }
BLT_SRC="$(awk '/^board_log_tail\(\) \{/{f=1} f{print} f&&/^\}/{exit}' "$RUNNER")"
WAIT_UP_SRC="$(awk '/^wait_up\(\) \{/{f=1} f{print} f&&/^\}/{exit}' "$RUNNER")"
case "$BLT_SRC" in *"ERR_CONNECTION_REFUSED"*"board-logs.tsv"*) : ;; *) echo "FAIL  could not extract board_log_tail from $RUNNER"; exit 1 ;; esac
case "$WAIT_UP_SRC" in *"board-logs.tsv"*) : ;; *) echo "FAIL  wait_up does not record its board's log (#5231)"; exit 1 ;; esac
log() { printf '%s\n' "$*"; }
eval "$BLT_SRC"
eval "$WAIT_UP_SRC"

pass=0; fail=0
ok() { echo "PASS  $1"; pass=$((pass+1)); }
bad() { echo "FAIL  $1"; fail=$((fail+1)); }

T="$(mktemp -d)"; LIVE_PID=""; trap '[ -n "$LIVE_PID" ] && kill "$LIVE_PID" 2>/dev/null; rm -rf "$T"' EXIT   # review 2: never leave the listener
RUN_DIR="$T/run"; mkdir -p "$RUN_DIR"
DEAD_PORT="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')"
OTHER_PORT="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')"

# 1. wait_up records port -> log, even when the board never answers (that is when it matters most).
BOARD_LOG="$T/board.log"
printf 'Kosmos on http://127.0.0.1:%s\nFATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n' "$DEAD_PORT" > "$BOARD_LOG"
KOSMOS_BC_WAIT_TRIES=1 wait_up "$DEAD_PORT" "$BOARD_LOG" >/dev/null 2>&1
grep -q "^$DEAD_PORT	$BOARD_LOG\$" "$RUN_DIR/board-logs.tsv" && ok "wait_up records which log belongs to the board on which port" || bad "wait_up did not record port -> log: $(cat "$RUN_DIR/board-logs.tsv" 2>/dev/null)"

# 2. Playwright's wording, exactly as the card's Mortals run printed it, names the dead board and prints its log.
CAP="$T/cap"
printf 'PASS  control: the crossing count counts a crossing and only a crossing\npage.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:%s/\nCall log:\n' "$DEAD_PORT" > "$CAP"
out="$(board_log_tail "$CAP")"
case "$out" in *"board on :$DEAD_PORT is GONE"*"JavaScript heap out of memory"*) ok "a check whose board refused (Playwright's ERR_CONNECTION_REFUSED) prints that board's last log lines" ;; *) bad "the dead board's log was not printed: $out" ;; esac

# 3. Node's wording too.
printf 'Error: connect ECONNREFUSED 127.0.0.1:%s\n' "$DEAD_PORT" > "$CAP"
out="$(board_log_tail "$CAP")"
case "$out" in *"JavaScript heap out of memory"*) ok "node's ECONNREFUSED names the board too" ;; *) bad "node's ECONNREFUSED was not matched: $out" ;; esac

# 4. A refused port this run never booted: said plainly, nothing invented.
printf 'page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:%s/\n' "$OTHER_PORT" > "$CAP"
out="$(board_log_tail "$CAP")"
case "$out" in *"refused connections; it is not a board this run booted"*) ok "a refused port with no known board says so" ;; *) bad "an unknown port: $out" ;; esac

# 4b. (review) A port booted twice: the later boot's log is the one shown.
LATER_LOG="$T/later.log"; printf 'the second board on this port\n' > "$LATER_LOG"
printf '%s\t%s\n' "$DEAD_PORT" "$LATER_LOG" >> "$RUN_DIR/board-logs.tsv"
printf 'page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:%s/\n' "$DEAD_PORT" > "$CAP"
out="$(board_log_tail "$CAP")"
case "$out" in *"the second board on this port"*) case "$out" in *"heap out of memory"*) bad "a re-booted port printed the earlier board's log: $out" ;; *) ok "a re-booted port shows the later board's log" ;; esac ;; *) bad "a re-booted port showed no log: $out" ;; esac

# 4c. (review) A board that refused once but answers now says so, not GONE.
LIVE_PORT_FILE="$T/live.port"
node -e 'const s=require("node:http").createServer((q,r)=>r.end("{}"));s.listen(0,"127.0.0.1",()=>{require("node:fs").writeFileSync(process.argv[1],String(s.address().port))});setTimeout(()=>process.exit(0),15000)' "$LIVE_PORT_FILE" &
LIVE_PID=$!
for _ in $(seq 1 50); do [ -s "$LIVE_PORT_FILE" ] && break; sleep 0.2; done   # review 2: up to 10 s on a loaded box
LIVE_PORT="$(cat "$LIVE_PORT_FILE" 2>/dev/null)"
[ -n "$LIVE_PORT" ] || bad "the test's own listener never started (a loaded machine?), so arm 4c measured nothing"
LIVE_LOG="$T/live.log"; printf 'a board that came back\n' > "$LIVE_LOG"
printf '%s\t%s\n' "$LIVE_PORT" "$LIVE_LOG" >> "$RUN_DIR/board-logs.tsv"
printf 'Error: connect ECONNREFUSED 127.0.0.1:%s\n' "$LIVE_PORT" > "$CAP"
out="$(board_log_tail "$CAP")"
{ kill "$LIVE_PID"; wait "$LIVE_PID"; } 2>/dev/null
case "$out" in *"board on :$LIVE_PORT refused a connection but answers now"*"a board that came back"*) ok "a board that answers again is not called GONE" ;; *) bad "the live board was misreported: $out" ;; esac

# 5. CONTROL: a failure that is not a refused connection prints nothing (a timeout is not a dead board).
printf 'page.click: Timeout 30000ms exceeded.\nwaiting for locator(x)\n' > "$CAP"
out="$(board_log_tail "$CAP")"
[ -z "$out" ] && ok "CONTROL: a timeout with no refused connection prints no board log" || bad "a timeout printed a board log: $out"

# 6. run_one calls it after each failed attempt (the retry overwrites the first attempt's output).
n="$(awk '/^run_one\(\) \{/{f=1} f{print} f&&/^\}/{exit}' "$RUNNER" | grep -c 'board_log_tail "\$cap"')"
[ "$n" -eq 2 ] && ok "run_one reads the board log after both failed attempts" || bad "run_one calls board_log_tail $n time(s), not 2"

echo "board-log-tail-5231: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
