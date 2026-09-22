#!/bin/bash
# #3430: a codex agent's pane must read the CODEX_HOME the account was set up in, even when that
# home comes from the tmux SERVER's global environment rather than this supervisor's own env or
# the plist.
#
# The bug (sibling of #3417): a board cold-starts the tmux server under CODEX_HOME=<account>. A
# default-account codex agent's plist sets no CODEX_HOME and the supervisor (a launchd job)
# inherits none either, so the codex-dismiss shim and the pane fall back inconsistently. `tmux
# new-session` inherits the server GLOBAL env, so the pane runs with CODEX_HOME=<account> --
# and because codex stores its AUTH in $CODEX_HOME/auth.json, a pane pointed at the wrong home
# reads the wrong (or no) auth and runs UNAUTHENTICATED, silently, with no prompt.
#
# The fix: agent-supervisor.sh resolves the effective CODEX_HOME (own env, else the tmux server
# global via `show-environment -g`) on the codex arm and PINS it explicitly in the pane, and
# hands the SAME value to the codex-dismiss shim. This drives a COPY of the real supervisor's
# codex arm against a stub tmux whose `show-environment -g` reports a sandbox home, with the
# supervisor's OWN CODEX_HOME unset, and asserts new-session was launched with
# -e CODEX_HOME=<server-global>.
#
# 🛑 SANDBOX EVERY ROOT. All temp dirs ride the ONE trap.
set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

SB="$(mktemp -d)"
SRV_HOME="$SB/codex-work1"     # the CODEX_HOME the (stub) tmux SERVER global points at -- the leak
trap 'rm -rf "${SB:-}"' EXIT

mkdir -p "$SB/bin" "$SB/work" "$SRV_HOME"
cp bin/agent-supervisor.sh "$SB/bin/agent-supervisor.sh"

# Stub tmux: no live session (so the supervisor proceeds to launch), a server GLOBAL CODEX_HOME
# that reports the leak dir, and a new-session recorder. show-environment for CLAUDE_CONFIG_DIR
# returns unknown (this is a codex agent), so the Claude arm resolves nothing.
cat > "$SB/tmux" <<'STUB'
#!/bin/sh
case "$1" in
  has-session)      exit 1 ;;
  show-environment)
    case "$3" in
      CODEX_HOME) printf 'CODEX_HOME=%s\n' "$STUB_SERVER_CODEX_HOME" ;;
      *)          printf 'unknown variable: %s\n' "$3" ;;
    esac
    exit 0 ;;
  new-session)      printf '%s\n' "$@" > "$STUB_DIR/new-session.args"; exit 0 ;;
  *)                exit 0 ;;
esac
STUB
chmod 755 "$SB/tmux"

# CONTROL: the pane args do not exist until the supervisor runs (proves the assertion below is
# not vacuous).
if [ -f "$SB/new-session.args" ]; then bad "control: new-session args already exist before the run"; else ok "control: no launch until the supervisor runs"; fi

# Run the CODEX arm (7th arg = codex) with the supervisor's OWN CODEX_HOME + CLAUDE_CONFIG_DIR
# unset -- so EFFECTIVE_CODEX_HOME must come from the tmux server global (the whole point).
env -u CODEX_HOME -u CLAUDE_CONFIG_DIR \
  STUB_DIR="$SB" STUB_SERVER_CODEX_HOME="$SRV_HOME" AGENT_WORKFORCE_WAIT_POLL_SECS=1 \
  bash "$SB/bin/agent-supervisor.sh" codexleaktest "$SB/work" /usr/bin/true "$SB/tmux" "$SB/start.log" "" codex > "$SB/out.log" 2>&1 || true

ARGS="$SB/new-session.args"
if [ -s "$ARGS" ]; then ok "the supervisor reached new-session (the codex launch)"; else bad "new-session never happened: $(tail -5 "$SB/out.log")"; fi

# The pane is pinned to the server-global CODEX_HOME, so codex reads the right auth.json.
if grep -qxF "CODEX_HOME=$SRV_HOME" "$ARGS" 2>/dev/null; then
  ok "#3430: the codex pane was launched with -e CODEX_HOME=<server-global>"
else
  bad "new-session did not pin CODEX_HOME to the server-global dir: $(tr '\n' ' ' < "$ARGS" 2>/dev/null | head -c 300)"
fi

# It is a codex launch (bypass flag present), so this is the arm we meant to test.
if grep -qxF -- "--dangerously-bypass-approvals-and-sandbox" "$ARGS" 2>/dev/null; then
  ok "the launch is the codex arm (bypass-approvals flag present)"
else
  bad "this is not the codex arm: $(tr '\n' ' ' < "$ARGS" 2>/dev/null | head -c 300)"
fi

# DISCRIMINATING CONTROL: a CLAUDE agent (no codex arm) must NOT get the server-global CODEX_HOME
# pinned by this block (the block is codex-arm-only). Re-run as claude and confirm no CODEX_HOME rides.
env -u CODEX_HOME -u CLAUDE_CONFIG_DIR \
  STUB_DIR="$SB" STUB_SERVER_CODEX_HOME="$SRV_HOME" AGENT_WORKFORCE_WAIT_POLL_SECS=1 \
  bash "$SB/bin/agent-supervisor.sh" claudeleaktest "$SB/work" /usr/bin/true "$SB/tmux" "$SB/start.log" > "$SB/out-claude.log" 2>&1 || true
if grep -qE "^CODEX_HOME=" "$SB/new-session.args" 2>/dev/null; then
  bad "a claude agent got CODEX_HOME pinned -- the block is not codex-arm-scoped"
else
  ok "a claude agent does NOT get CODEX_HOME pinned (block is correctly codex-arm-only)"
fi

[ "$FAILS" -eq 0 ] && { echo "test-supervisor-codexhome-leak-3430: OK"; exit 0; } || { echo "test-supervisor-codexhome-leak-3430: $FAILS FAILED"; exit 1; }
