#!/bin/bash
# #4918: Live integration test for Linux systemd user units on a real systemd environment.
# Tested on ubuntu-latest GitHub runner.
# Verifies:
#   1. Agent keep-alive: agent-supervisor.sh runs under systemd user unit; killing
#      tmux session triggers systemd to revive it within 15s.
#   2. Agent lifecycle: start, stop, disable, remove cleanly manages user units.
#   3. Board keep-alive: board-run under kosmos-board.service relaunches on crash (kill -9).
#   4. Deliberate stop: with board.stopped, board-run exits 0 and Restart=on-failure leaves it down (systemd's
#      automatic restart does not re-check ConditionPathExists, measured here 2026-10-06).
set -euo pipefail
# It writes real units under ~/.config/systemd/user and uses sudo: CI only (#4918 review 2).
[ -n "${CI:-}" ] || { echo "refusing: this test changes the real user systemd and uses sudo; it runs on CI (CI=true)" >&2; exit 2; }

REPO="$(cd "$(dirname "$0")/.." && pwd)"
fails=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fails=1; }

echo "=== Linux Systemd User Unit Live Integration Test (#4918) ==="

U="$(id -u)"
export XDG_RUNTIME_DIR="/run/user/$U"
if [ ! -d "$XDG_RUNTIME_DIR" ]; then
  echo "Setting up XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR"
  sudo mkdir -p "$XDG_RUNTIME_DIR"
  sudo chown "$U:$U" "$XDG_RUNTIME_DIR"
  sudo chmod 700 "$XDG_RUNTIME_DIR"
fi

if ! systemctl --user is-system-running >/dev/null 2>&1; then
  echo "Attempting to enable linger for $USER..."
  sudo loginctl enable-linger "$(id -un)" || true
  for i in $(seq 1 15); do
    if systemctl --user is-system-running >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi

if ! systemctl --user is-system-running >/dev/null 2>&1; then
  echo "systemctl --user status: $(systemctl --user is-system-running 2>&1 || true)"
  echo "WARN: systemd user bus is not running. Live tests require a functioning systemd user session."
  exit 1
fi

ok "systemd user bus active and responding"

TMUX_BIN="$(command -v tmux || true)"
if [ -z "$TMUX_BIN" ]; then
  bad "tmux is not installed or not on PATH"
  exit 1
fi
ok "tmux found at $TMUX_BIN"

TMPDIR_ROOT="$(mktemp -d)"
cleanup() {
  echo "Cleaning up test units and directories..."
  systemctl --user stop kosmos-agent-testagent4918.service >/dev/null 2>&1 || true
  systemctl --user disable kosmos-agent-testagent4918.service >/dev/null 2>&1 || true
  rm -f "$HOME/.config/systemd/user/kosmos-agent-testagent4918.service" || true
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  tmux kill-session -t testagent4918 >/dev/null 2>&1 || true

  if [ -n "${BOARD_UNIT:-}" ]; then
    systemctl --user stop "$BOARD_UNIT" >/dev/null 2>&1 || true
    systemctl --user disable "$BOARD_UNIT" >/dev/null 2>&1 || true
    rm -f "$HOME/.config/systemd/user/$BOARD_UNIT" || true
    systemctl --user daemon-reload >/dev/null 2>&1 || true
  fi

  rm -rf "$TMPDIR_ROOT"
}
trap cleanup EXIT

# -----------------------------------------------------------------------------
# Part 1: Agent keep-alive and revival
# -----------------------------------------------------------------------------
echo "--- Testing Agent Keep-Alive ---"
AGENT_NAME="testagent4918"
export AGENT_WORKFORCE_WORKERS="$TMPDIR_ROOT/workers"
AGENT_DIR="$TMPDIR_ROOT/workers/$AGENT_NAME"
mkdir -p "$AGENT_DIR"
touch "$AGENT_DIR/start.log"

# Create a mock runner that stays alive
MOCK_RUNNER="$TMPDIR_ROOT/mock-runner.sh"
cat > "$MOCK_RUNNER" <<'SH'
#!/bin/bash
while true; do sleep 1; done
SH
chmod +x "$MOCK_RUNNER"

# Generate and install systemd unit for the agent using engine/linuxjob.js
# #4918 review 4: every engine call's own result is asserted, not only its side effects.
if node -e '
  const create = require("./engine/create");
  create.installSupervisor();
  const linuxjob = require("./engine/linuxjob");
  const unitContent = linuxjob.unitFor(
    process.argv[1],
    process.argv[2],
    process.argv[3],
    "",
    "",
    "claude"
  );
  const target = linuxjob.unitPath(process.argv[1]);
  linuxjob.writeUnitFile(target, unitContent);
  const r = linuxjob.start(process.argv[1]);
  if (!r || r.ok !== true) { console.error("start:", JSON.stringify(r)); process.exit(3); }
' "$AGENT_NAME" "$MOCK_RUNNER" "$TMUX_BIN"; then
  ok "linuxjob.start returned ok"
else
  bad "linuxjob.start did not return ok"
fi

# Check if unit is active
sleep 3
if systemctl --user is-active "kosmos-agent-$AGENT_NAME.service" >/dev/null 2>&1; then
  ok "agent unit started and active"
else
  bad "agent unit failed to start: $(systemctl --user status "kosmos-agent-$AGENT_NAME.service" 2>&1)"
fi

# Check if tmux session was created
created=0
for i in $(seq 1 10); do
  if "$TMUX_BIN" has-session -t "$AGENT_NAME" 2>/dev/null; then
    created=1
    ok "agent tmux session created ($AGENT_NAME)"
    break
  fi
  sleep 1
done
if [ "$created" = 0 ]; then
  bad "agent tmux session not found"
  tail -20 "$AGENT_DIR/start.log" || true
fi

# Kill the tmux session and verify systemd revives it
echo "Killing tmux session $AGENT_NAME..."
"$TMUX_BIN" kill-session -t "$AGENT_NAME" 2>/dev/null || true

revived=0
for i in $(seq 1 20); do
  if "$TMUX_BIN" has-session -t "$AGENT_NAME" 2>/dev/null; then
    revived=1
    ok "agent session revived by systemd after ${i}s"
    break
  fi
  sleep 1
done

if [ "$revived" = 0 ]; then
  bad "agent session was NOT revived within 20s"
  journalctl --user -u "kosmos-agent-$AGENT_NAME.service" --no-pager | tail -25 || true
fi

# #4918 review 2: KillMode=process. Stopping the unit stops its supervisor only: the tmux session (and the tmux
# server every agent shares) survives. Under systemd's default KillMode the stop takes the session down with it.
systemctl --user stop "kosmos-agent-$AGENT_NAME.service" >/dev/null 2>&1 || true
sleep 2
if "$TMUX_BIN" has-session -t "$AGENT_NAME" 2>/dev/null; then
  ok "stopping the agent's unit left its tmux session alive (KillMode=process)"
else
  bad "stopping the agent's unit killed its tmux session (the shared tmux server would die with it)"
fi
# And a deliberate stop stays stopped: Restart=always does not revive a unit that was stopped on purpose.
sleep 10
if systemctl --user is-active "kosmos-agent-$AGENT_NAME.service" >/dev/null 2>&1; then
  bad "the agent unit came back after a deliberate stop"
else
  ok "a deliberately stopped agent unit stays stopped (12s)"
fi
"$TMUX_BIN" kill-session -t "$AGENT_NAME" 2>/dev/null || true

# Stop and remove agent unit using engine/linuxjob.js
if node -e '
  const linuxjob = require("./engine/linuxjob");
  const r = linuxjob.remove(process.argv[1]);
  if (!r || r.ok !== true) { console.error("remove:", JSON.stringify(r)); process.exit(3); }
' "$AGENT_NAME"; then
  ok "linuxjob.remove returned ok"
else
  bad "linuxjob.remove did not return ok"
fi

# #4918 review 4: a NAMED world's agent. Its launch key carries "+", which systemd rejects in a unit name, so the
# unit name is escaped; this proves the escaped unit is accepted and runs, then removes it.
WORLD_UNIT="$(KOSMOS_WORLD=w4918 node -e 'console.log(require("./engine/linuxjob").unitName(process.argv[1]))' "$AGENT_NAME")"
if KOSMOS_WORLD=w4918 node -e '
  require("./engine/create").installSupervisor();
  const lj = require("./engine/linuxjob");
  lj.writeUnitFile(lj.unitPath(process.argv[1]), lj.unitFor(process.argv[1], process.argv[2], process.argv[3], "", "", "claude"));
  const r = lj.start(process.argv[1]);
  if (!r || r.ok !== true) { console.error("named-world start:", JSON.stringify(r)); process.exit(3); }
' "$AGENT_NAME" "$MOCK_RUNNER" "$TMUX_BIN"; then
  sleep 3
  if systemctl --user is-active "$WORLD_UNIT" >/dev/null 2>&1; then
    ok "a named world's agent runs under its escaped unit ($WORLD_UNIT)"
  else
    bad "the named world's unit did not come up: $(systemctl --user status "$WORLD_UNIT" 2>&1 | head -5)"
  fi
else
  bad "the named world's agent did not start (unit $WORLD_UNIT)"
fi
KOSMOS_WORLD=w4918 node -e 'require("./engine/linuxjob").remove(process.argv[1])' "$AGENT_NAME" || true
"$TMUX_BIN" kill-server 2>/dev/null || true

sleep 1
if [ ! -f "$HOME/.config/systemd/user/kosmos-agent-$AGENT_NAME.service" ]; then
  ok "agent unit file cleaned up after remove()"
else
  bad "agent unit file still exists after remove()"
fi

# -----------------------------------------------------------------------------
# Part 2: Board keep-alive and deliberate stop
# -----------------------------------------------------------------------------
echo "--- Testing Board Keep-Alive and Stop ---"
MOCK_BOARD_HOME="$TMPDIR_ROOT/kosmos-board-home"
mkdir -p "$MOCK_BOARD_HOME/bin" "$MOCK_BOARD_HOME/logs"

# Stub kosmos script that supports board-run
cat > "$MOCK_BOARD_HOME/bin/kosmos" <<'SH'
#!/bin/bash
H="${KOSMOS_HOME:-$(cd "$(dirname "$0")/.." && pwd)}"
if [ "$1" = "board-run" ]; then
  if [ -f "$H/board.stopped" ]; then
    echo "Stopped marker present, exiting 0"
    exit 0
  fi
  printf '%s' "$$" > "$H/board.pid"
  echo "board-run started pid=$$"
  while true; do sleep 1; done
fi
SH
chmod +x "$MOCK_BOARD_HOME/bin/kosmos"

BOARD_UNIT="$(node -e '
  const linuxboard = require("./engine/linuxboard");
  console.log(linuxboard.boardUnitName(process.argv[1]));
' "$MOCK_BOARD_HOME")"

# Install board unit using engine/linuxboard.js
if node -e '
  const linuxboard = require("./engine/linuxboard");
  const r = linuxboard.installBoard(process.argv[1], 18888);
  if (!r || r.ok !== true) { console.error("installBoard:", JSON.stringify(r)); process.exit(3); }
' "$MOCK_BOARD_HOME"; then
  ok "linuxboard.installBoard returned ok"
else
  bad "linuxboard.installBoard did not return ok"
fi

UNIT_FILE="$HOME/.config/systemd/user/$BOARD_UNIT"
if [ -f "$UNIT_FILE" ]; then
  ok "board unit file written ($BOARD_UNIT)"
else
  bad "board unit file not written"
fi

if grep -q "ConditionPathExists=!" "$UNIT_FILE"; then
  ok "board unit carries ConditionPathExists for board.stopped"
else
  bad "board unit missing ConditionPathExists"
fi

# Start board service
systemctl --user start "$BOARD_UNIT"
sleep 3

if systemctl --user is-active "$BOARD_UNIT" >/dev/null 2>&1; then
  ok "board unit started and active"
else
  bad "board unit failed to start: $(systemctl --user status "$BOARD_UNIT" 2>&1)"
fi

FIRST_PID=""
for i in $(seq 1 10); do
  FIRST_PID="$(cat "$MOCK_BOARD_HOME/board.pid" 2>/dev/null || true)"
  if [ -n "$FIRST_PID" ] && kill -0 "$FIRST_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done
if [ -n "$FIRST_PID" ] && kill -0 "$FIRST_PID" 2>/dev/null; then
  ok "board process running (pid $FIRST_PID)"
else
  bad "board pid file not found or process not alive"
fi

# Crash recovery: kill board process with SIGKILL (without board.stopped)
echo "Simulating crash: kill -9 $FIRST_PID..."
kill -9 "$FIRST_PID" 2>/dev/null || true

restarted=0
for i in $(seq 1 15); do
  NEW_PID="$(cat "$MOCK_BOARD_HOME/board.pid" 2>/dev/null || true)"
  if [ -n "$NEW_PID" ] && [ "$NEW_PID" != "$FIRST_PID" ] && kill -0 "$NEW_PID" 2>/dev/null; then
    restarted=1
    ok "board process restarted automatically by systemd (new pid $NEW_PID) after ${i}s"
    break
  fi
  sleep 1
done

if [ "$restarted" = 0 ]; then
  bad "board process was NOT restarted by systemd after crash"
  journalctl --user -u "$BOARD_UNIT" --no-pager | tail -25 || true
fi

# Deliberate stop: with board.stopped in place, a crash does not bring the board back (ConditionPathExists).
echo "Simulating deliberate stop..."
touch "$MOCK_BOARD_HOME/board.stopped"
STOP_PID="$(cat "$MOCK_BOARD_HOME/board.pid" 2>/dev/null || true)"
[ -n "$STOP_PID" ] && kill -9 "$STOP_PID" 2>/dev/null || true
sleep 12
AFTER_PID="$(cat "$MOCK_BOARD_HOME/board.pid" 2>/dev/null || true)"
if [ -n "$AFTER_PID" ] && [ "$AFTER_PID" != "$STOP_PID" ] && kill -0 "$AFTER_PID" 2>/dev/null; then
  bad "board.stopped did not hold: a new board (pid $AFTER_PID) started after the crash"
else
  ok "board.stopped held: no new board within 12s of the crash, with the unit still installed"
fi
# #4918 review 3: the stub board-run also exits on the marker, so the pid check alone passes without the Condition.
# What ConditionPathExists decides is whether systemd starts the unit at all: after the crash it schedules one
# restart, and the start is refused (ConditionResult=no). Without the Condition every 5s start succeeds and exits.
# What matters is that systemd stops restarting: with board.stopped there, board-run exits 0 and Restart=on-failure
# leaves it down. Measured as NRestarts over 12 more seconds (Restart=always + RestartSec=5 would add 2 or 3).
R1="$(systemctl --user show -p NRestarts --value "$BOARD_UNIT" 2>/dev/null || echo x)"
sleep 12
R2="$(systemctl --user show -p NRestarts --value "$BOARD_UNIT" 2>/dev/null || echo y)"
ST="$(systemctl --user show -p ActiveState --value "$BOARD_UNIT" 2>/dev/null || true)"
if [ "$R1" = "$R2" ] && [ "$ST" != "active" ] && [ "$ST" != "activating" ]; then
  ok "with board.stopped, systemd stopped restarting the board (NRestarts $R1 -> $R2, $ST)"
else
  bad "with board.stopped, systemd kept restarting the board (NRestarts $R1 -> $R2, $ST)"
fi
if node -e '
  const linuxboard = require("./engine/linuxboard");
  const r = linuxboard.removeBoard(process.argv[1]);
  if (!r || r.ok !== true) { console.error("removeBoard:", JSON.stringify(r)); process.exit(3); }
' "$MOCK_BOARD_HOME"; then
  ok "linuxboard.removeBoard returned ok"
else
  bad "linuxboard.removeBoard did not return ok"
fi

sleep 2
if ! systemctl --user is-active "$BOARD_UNIT" >/dev/null 2>&1; then
  ok "board unit stopped and removed cleanly"
else
  bad "board unit still active after removeBoard"
fi

echo "=== All integration tests finished ==="
if [ "$fails" = 0 ]; then
  echo "ALL PASS (test-linux-systemd-live-4918)"
  exit 0
else
  echo "FAILURES (test-linux-systemd-live-4918)"
  exit 1
fi
