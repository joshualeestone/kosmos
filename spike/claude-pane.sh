#!/bin/bash
# #4904 spike, phase D: what tmux reports as the running command for the REAL Claude Code CLI on Linux (no login).
# The board and the supervisor classify a pane by this (agent-supervisor.sh ~193): a shell there reads as a crashed agent.
set -u
C=$(command -v claude) || { echo "[D] claude not installed"; exit 0; }
echo "[D] claude at $C -> $(readlink -f "$C")"
echo "[D] version: $(claude --version 2>&1 | head -1)"
tmux new-session -d -s ccspike -x 200 -y 50 "$C"
sleep 8
echo "[D] pane_current_command: $(tmux display -p -t ccspike '#{pane_current_command}')"
echo "[D] pane pid tree: $(ps -o pid,comm,args --ppid "$(tmux display -p -t ccspike '#{pane_pid}')" 2>/dev/null | tr '\n' '|' | cut -c1-300)"
echo "[D] pane shows:"; tmux capture-pane -p -t ccspike | grep -v '^\s*$' | head -15 | sed 's/^/[D]   /'
tmux kill-server 2>/dev/null; true
