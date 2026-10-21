#!/bin/bash
# kosmos#6667: the board's pause check on REAL systemd (GitHub's ubuntu runner, linux-systemd.yml). Measures, with the
# real install/kosmos and the units engine/linuxboard.js writes:
#   1. a killed update's pause (board.stopped plus a gone update's name, newer than the board's last start) is cleared
#      by the timer by itself, and the board comes back, where systemd alone refuses to start it (the control);
#   2. a person's stop (board.stopped, no name) stays through a firing of the timer, and the board stays down;
#   3. removeBoard takes the pause check away with the board.
# The board itself is the #4918 test's stub (board-run loops); board-revive is the real command.
set -uo pipefail
[ -n "${CI:-}" ] && [ -n "${GITHUB_ACTIONS:-}" ] || { echo "refusing: this test changes the real user systemd; it runs on GitHub Actions only (CI and GITHUB_ACTIONS set)" >&2; exit 2; }

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO" || exit 1   # every node -e requires ./engine/..., relative to here
fails=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fails=1; }

U="$(id -u)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$U}"
_um_state="$(systemctl --user is-system-running 2>/dev/null || true)"
if [ "$_um_state" != "running" ] && [ "$_um_state" != "degraded" ]; then
  echo "FAIL  no systemd user manager ($_um_state); the workflow's linger step sets it up"; exit 1
fi

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/test-pause-check-6667.XXXXXXXXXX")" || { echo "FAIL  no temp dir"; exit 1; }
[ -n "$ROOT" ] && [ -d "$ROOT" ] || { echo "FAIL  no temp dir"; exit 1; }
H="$ROOT/kosmos-home"
mkdir -p "$H/bin" "$H/logs"
# board-run: the #4918 stub. board-revive: the real install/kosmos (it names this home's unit itself).
cat > "$H/bin/kosmos" <<SH
#!/bin/bash
if [ "\${1:-}" = "board-run" ]; then
  [ -f "\$KOSMOS_HOME/board.stopped" ] && exit 0
  printf '%s' "\$\$" > "\$KOSMOS_HOME/board.pid"
  while true; do sleep 1; done
fi
exec /bin/bash "$REPO/install/kosmos" "\$@"
SH
chmod +x "$H/bin/kosmos"

BOARD="$(node -e 'console.log(require("./engine/linuxboard").boardUnitName(process.argv[1]))' "$H")"
TIMER="$(node -e 'console.log(require("./engine/linuxboard").pauseCheckNames(process.argv[1]).timer)' "$H")"
CHECK="$(node -e 'console.log(require("./engine/linuxboard").pauseCheckNames(process.argv[1]).service)' "$H")"
DIR="$HOME/.config/systemd/user"
cleanup() {
  for u in "$TIMER" "$CHECK" "$BOARD"; do
    systemctl --user disable --now "$u" >/dev/null 2>&1 || true
    rm -f "$DIR/$u"
  done
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  rm -rf "${ROOT:?}"
}
trap cleanup EXIT

node -e '
  const r = require("./engine/linuxboard").installBoard(process.argv[1], 18889);
  if (!r || r.ok !== true || !r.pauseCheck || r.pauseCheck.ok !== true) { console.error(JSON.stringify(r)); process.exit(3); }
' "$H" && ok "installBoard installed the board and its pause check" || bad "installBoard did not install both"
[ "$(systemctl --user is-enabled "$TIMER" 2>/dev/null)" = enabled ] && systemctl --user is-active "$TIMER" >/dev/null 2>&1 \
  && ok "the pause check's timer is enabled and running ($TIMER)" || bad "the timer is not enabled and running"

active() { systemctl --user is-active "$BOARD" >/dev/null 2>&1; }
# The monotonic start time of the check's last run: it changes each time the timer fires it.
last_check() { systemctl --user show -p ExecMainStartTimestampMonotonic --value "$CHECK" 2>/dev/null; }
# wait_check_run <seconds>: until the check has run again since now (0) or the time is up (1).
wait_check_run() {
  local before i; before="$(last_check)"
  for i in $(seq 1 "$1"); do
    [ "$(last_check)" != "$before" ] && [ "$(systemctl --user show -p ActiveState --value "$CHECK")" != activating ] && return 0
    sleep 1
  done
  return 1
}
systemctl --user start "$BOARD" || bad "the board would not start"
sleep 2
active && ok "the board runs under systemd" || bad "the board is not running"

# --- 1. A killed update's pause ---------------------------------------------------------------------------------
# What an update leaves when it is killed mid-pause: the marker, its own name (a pid that has ended, a /proc token),
# newer than the board's last start. The board was stopped by the update before it died. The timer is held off while
# the control runs, or a firing in that window would clear the pause and turn the control red for no defect.
systemctl --user stop "$TIMER"
: > "$H/board.started-at"; touch -d '1 hour ago' "$H/board.started-at"
sh -c 'exit 0' & DEAD=$!; wait "$DEAD" 2>/dev/null
: > "$H/board.stopped"; : > "$H/board.stopped.by-install.$DEAD.proc:1234:bootid"
systemctl --user stop "$BOARD"
# CONTROL: systemd alone keeps it down (ConditionPathExists cannot read the name), which is the defect.
systemctl --user start "$BOARD" >/dev/null 2>&1 || true
sleep 1
COND="$(systemctl --user show -p ConditionResult --value "$BOARD" 2>/dev/null)"
! active && [ "$COND" = no ] && ok "control: systemd alone refuses to start the board under a killed update's pause" \
  || bad "control: the board started without the pause check (active=$(active && echo yes || echo no), ConditionResult=$COND)"
# Now nothing but the timer, started again: up to 75 s for it to fire, then a few for the board.
systemctl --user start "$TIMER" || bad "the timer would not start again"
came=no
for i in $(seq 1 85); do active && { came=yes; break; }; sleep 1; done
if [ "$came" = yes ] && [ ! -e "$H/board.stopped" ] && ls "$H"/board.stopped.stranded.* >/dev/null 2>&1; then
  ok "the timer cleared the killed update's pause by itself and the board came back (${i}s)"
else
  bad "the board did not come back (came=$came, marker=$([ -e "$H/board.stopped" ] && echo kept || echo gone))"
  journalctl --user -u "$CHECK" --no-pager 2>/dev/null | tail -15 || true
fi
grep -q 'pause-check: cleared a stranded update pause' "$H/logs/board-watchdog.log" 2>/dev/null \
  && ok "the clear is logged" || bad "the clear was not logged"

# --- 2. A person's stop ------------------------------------------------------------------------------------------
: > "$H/board.stopped"
systemctl --user stop "$BOARD"
if wait_check_run 75; then
  ok "the timer fired the check again with a person's stop in place"
  sleep 3
  [ -e "$H/board.stopped" ] && ! active && ok "a person's stop held through the check: the board stayed down" \
    || bad "a person's stop did not hold (marker=$([ -e "$H/board.stopped" ] && echo kept || echo gone), active=$(active && echo yes || echo no))"
  [ "$(systemctl --user show -p ExecMainStatus --value "$CHECK")" = 0 ] && ok "the check exits 0 on a person's stop" \
    || bad "the check failed on a person's stop (status $(systemctl --user show -p ExecMainStatus --value "$CHECK"))"
else
  bad "the timer did not fire the check within 75 s, so the person's-stop arm proves nothing"
fi

# --- 3. removeBoard takes the pause check with it ---------------------------------------------------------------
node -e 'const r = require("./engine/linuxboard").removeBoard(process.argv[1]); if (!r || !r.ok) { console.error(JSON.stringify(r)); process.exit(3); }' "$H" \
  && ok "removeBoard returned ok" || bad "removeBoard did not return ok"
gone=yes
for u in "$TIMER" "$CHECK" "$BOARD"; do [ -e "$DIR/$u" ] && gone=no; done
systemctl --user is-active "$TIMER" >/dev/null 2>&1 && gone=no
[ "$gone" = yes ] && ok "the board, the check and its timer are gone after removeBoard" || bad "something was left after removeBoard"

[ "$fails" = 0 ] && echo "pause check live: 0 failures" || echo "pause check live: FAILURES"
exit "$fails"
