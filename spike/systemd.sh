#!/bin/bash
# #4904 spike, phase C: the agent keep-alive as a systemd USER unit instead of a launchd plist.
# Runs Kosmos's own bin/agent-supervisor.sh with the same five arguments the plist passes, then kills the agent's
# tmux session and watches systemd bring it back. Measurement only.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
U=$(id -u)
sudo loginctl enable-linger "$(id -un)"
export XDG_RUNTIME_DIR=/run/user/$U
for i in $(seq 1 20); do [ -S "$XDG_RUNTIME_DIR/bus" ] && break; sleep 1; done
echo "[C] user bus: $(ls -la $XDG_RUNTIME_DIR/bus 2>&1)"
echo "[C] systemctl --user: $(systemctl --user is-system-running 2>&1)"
W="$RUNNER_TEMP/spike-C/workers/linuxc"; mkdir -p "$W"
TMUXBIN=$(command -v tmux)
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/kosmos-agent-linuxc.service <<UNIT
[Unit]
Description=Kosmos agent linuxc (spike #4904)
[Service]
ExecStart=/bin/bash $REPO/bin/agent-supervisor.sh linuxc $W $REPO/spike/stub-claude.sh $TMUXBIN $W/start.log
WorkingDirectory=$W
Environment=HOME=$HOME
Environment=PATH=$REPO/spike:$(dirname "$TMUXBIN"):/usr/local/bin:/usr/bin:/bin
Environment=LANG=C.UTF-8
Restart=always
RestartSec=5
[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now kosmos-agent-linuxc.service 2>&1 | sed 's/^/[C] /'
sleep 8
echo "[C] unit: $(systemctl --user is-active kosmos-agent-linuxc.service)"
echo "[C] tmux sessions: $(tmux ls 2>&1)"
echo "[C] pane command: $(tmux display -p -t linuxc '#{pane_current_command}' 2>&1)"
echo "[C] supervisor log (tail):"; tail -20 "$W/start.log" 2>&1 | sed 's/^/[C]   /'
echo "[C] --- kill the agent's session; systemd should bring it back"
tmux kill-session -t linuxc 2>&1
for i in $(seq 1 40); do tmux has-session -t linuxc 2>/dev/null && { echo "[C] session BACK after ${i}s"; break; }; sleep 1; done
tmux has-session -t linuxc 2>/dev/null || echo "[C] session NOT back after 40s"
echo "[C] unit after: $(systemctl --user is-active kosmos-agent-linuxc.service); restarts: $(systemctl --user show kosmos-agent-linuxc.service -p NRestarts --value)"
journalctl --user -u kosmos-agent-linuxc.service --no-pager 2>&1 | tail -15 | sed 's/^/[C]   /'
tail -15 "$W/start.log" 2>&1 | sed 's/^/[C] log  /'
systemctl --user disable --now kosmos-agent-linuxc.service >/dev/null 2>&1
tmux kill-server 2>/dev/null; true
