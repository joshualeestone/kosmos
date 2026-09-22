#!/bin/bash
# #3430: a default-account codex agent's pane must read the DEFAULT codex home ($HOME/.codex,
# where default signin leaves auth.json and where create.js writes default-account codex trust
# via defaultAgentCodexHome()), NOT the tmux server-global CODEX_HOME it would otherwise inherit.
#
# The bug (sibling of #3417, but the MIRROR fix, not a copy): a board cold-started under
# CODEX_HOME=<accountX> leaks it into a default codex pane via `tmux new-session`. Codex auth
# lives in $HOME/.codex, NOT <accountX>, and codex has no launch-time write-realign (unlike
# Claude's ensure-launch-trust). So the pane must be pointed at the DEFAULT home, not the leak.
# The v1 of this fix wrongly PINNED the leaked server-global -- which is the value the pane
# already inherited, so it changed nothing and left the agent unauthenticated (Pete + ICK).
#
# The fix OVERRIDES the pane's CODEX_HOME to defaultAgentCodexHome() (AGENT_WORKFORCE_CODEX_HOME
# test seam, else $HOME/.codex) for a default codex agent, defeating the leak. This drives a COPY
# of the real supervisor's codex arm with a server-global leak set to a DIFFERENT dir than the
# default home, and asserts the pane is pinned to the DEFAULT home, not the leak.
#
# 🛑 SANDBOX EVERY ROOT. All temp dirs ride the ONE trap.
set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

SB="$(mktemp -d)"
DEFAULT_HOME="$SB/default-codex"   # where auth lives (defaultAgentCodexHome, via the test seam)
LEAK_HOME="$SB/leaked-codex"       # the tmux server-global CODEX_HOME the pane would inherit -- WRONG
trap 'rm -rf "${SB:-}"' EXIT

mkdir -p "$SB/bin" "$SB/work" "$DEFAULT_HOME" "$LEAK_HOME"
cp bin/agent-supervisor.sh "$SB/bin/agent-supervisor.sh"

# Stub tmux: no live session, a server-global CODEX_HOME reporting the LEAK dir (to prove the fix
# does not read it), and a new-session recorder.
cat > "$SB/tmux" <<'STUB'
#!/bin/sh
case "$1" in
  has-session)      exit 1 ;;
  show-environment)
    case "$3" in
      CODEX_HOME) printf 'CODEX_HOME=%s\n' "$STUB_SERVER_CODEX_HOME" ;;
      *)          printf 'unknown variable: %s\n' "$3" ;;
    esac; exit 0 ;;
  new-session)      printf '%s\n' "$@" > "$STUB_DIR/new-session.args"; exit 0 ;;
  *)                exit 0 ;;
esac
STUB
chmod 755 "$SB/tmux"

# CONTROL: the pane args do not exist until the supervisor runs.
if [ -f "$SB/new-session.args" ]; then bad "control: new-session args already exist before the run"; else ok "control: no launch until the supervisor runs"; fi

# Run the CODEX arm (7th arg = codex) with own CODEX_HOME + CLAUDE_CONFIG_DIR unset, the default
# home pointed at DEFAULT_HOME (the seam), and the server-global leak set to a DIFFERENT dir.
env -u CODEX_HOME -u CLAUDE_CONFIG_DIR \
  AGENT_WORKFORCE_CODEX_HOME="$DEFAULT_HOME" \
  STUB_DIR="$SB" STUB_SERVER_CODEX_HOME="$LEAK_HOME" AGENT_WORKFORCE_WAIT_POLL_SECS=1 \
  bash "$SB/bin/agent-supervisor.sh" codexleaktest "$SB/work" /usr/bin/true "$SB/tmux" "$SB/start.log" "" codex > "$SB/out.log" 2>&1 || true

ARGS="$SB/new-session.args"
if [ -s "$ARGS" ]; then ok "the supervisor reached new-session (the codex launch)"; else bad "new-session never happened: $(tail -5 "$SB/out.log")"; fi

# THE FIX: the pane reads the DEFAULT home (where auth lives), so codex is authenticated.
if grep -qxF "CODEX_HOME=$DEFAULT_HOME" "$ARGS" 2>/dev/null; then
  ok "#3430: the codex pane was pinned to the DEFAULT home (where auth.json lives)"
else
  bad "the pane was not pinned to the default codex home: $(tr '\n' ' ' < "$ARGS" 2>/dev/null | head -c 300)"
fi

# DISCRIMINATING (this is the v1-bug guard): the pane must NOT read the leaked server-global home.
if grep -qxF "CODEX_HOME=$LEAK_HOME" "$ARGS" 2>/dev/null; then
  bad "the pane was pinned to the LEAKED server-global home -- the v1 wrong-home-pin bug (Pete/ICK)"
else
  ok "the pane does NOT read the leaked server-global home (the leak is overridden, not pinned)"
fi

# It is a codex launch (bypass flag), so this is the arm we meant to test.
if grep -qxF -- "--dangerously-bypass-approvals-and-sandbox" "$ARGS" 2>/dev/null; then
  ok "the launch is the codex arm (bypass-approvals flag present)"
else
  bad "this is not the codex arm: $(tr '\n' ' ' < "$ARGS" 2>/dev/null | head -c 300)"
fi

# DISCRIMINATING CONTROL: a CLAUDE agent must NOT get CODEX_HOME pinned by this block.
env -u CODEX_HOME -u CLAUDE_CONFIG_DIR \
  AGENT_WORKFORCE_CODEX_HOME="$DEFAULT_HOME" \
  STUB_DIR="$SB" STUB_SERVER_CODEX_HOME="$LEAK_HOME" AGENT_WORKFORCE_WAIT_POLL_SECS=1 \
  bash "$SB/bin/agent-supervisor.sh" claudeleaktest "$SB/work" /usr/bin/true "$SB/tmux" "$SB/start.log" > "$SB/out-claude.log" 2>&1 || true
if grep -qE "^CODEX_HOME=" "$SB/new-session.args" 2>/dev/null; then
  bad "a claude agent got CODEX_HOME pinned -- the block is not codex-arm-scoped"
else
  ok "a claude agent does NOT get CODEX_HOME pinned (block is correctly codex-arm-only)"
fi

[ "$FAILS" -eq 0 ] && { echo "test-supervisor-codexhome-leak-3430: OK"; exit 0; } || { echo "test-supervisor-codexhome-leak-3430: $FAILS FAILED"; exit 1; }
