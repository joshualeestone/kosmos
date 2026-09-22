#!/bin/bash
# #3417: the supervisor must trust the config dir the PANE ACTUALLY READS, even when
# that dir comes from the tmux SERVER's global environment rather than this supervisor's
# own env or the plist.
#
# The bug: a board cold-starts the tmux server under CLAUDE_CONFIG_DIR=<account>. A
# "default account" agent's plist sets no CLAUDE_CONFIG_DIR and the supervisor (a launchd
# job) inherits none either, so create.js + ensure-launch-trust write folder-trust to the
# DEFAULT ~/.claude.json. But `tmux new-session` inherits the server GLOBAL env, so the
# pane runs with CLAUDE_CONFIG_DIR=<account> and Claude Code reads <account>/.claude.json --
# which has no trust entry. Every new agent re-hits the folder-trust prompt (#2129 class,
# one layer deeper: the tmux-server-global env).
#
# The fix: agent-supervisor.sh resolves the effective config dir (own env, else the tmux
# server global via `show-environment -g`, else empty), PINS it explicitly into the pane,
# and hands the SAME value to ensure-launch-trust. This drives a COPY of the real
# supervisor against a stub tmux whose `show-environment -g` reports a sandbox account dir
# (the leak), with the supervisor's OWN CLAUDE_CONFIG_DIR unset, and asserts BOTH that the
# folder-trust key landed in that SERVER-GLOBAL dir (NOT the default file) AND that
# new-session was launched with -e CLAUDE_CONFIG_DIR=<server-global>.
#
# 🛑 SANDBOX EVERY ROOT. The server-global dir and the default-account seams are all under
# a mktemp'd sandbox, so this never touches the operator's real config.
set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

SB="$(mktemp -d)"
DATA="$(mktemp -d)"
SRV_CCD="$SB/work1"            # the account dir the (stub) tmux SERVER global points at -- the leak
CFG="$SB/claude.json"         # AGENT_WORKFORCE_CLAUDE_CONFIG: the DEFAULT-account file. It must STAY EMPTY.
SET="$SB/settings.json"       # AGENT_WORKFORCE_CLAUDE_SETTINGS: the default settings seam.
trap 'rm -rf "${SB:-}" "${DATA:-}"' EXIT

mkdir -p "$SB/bin" "$SB/work" "$SRV_CCD"
cp bin/agent-supervisor.sh "$SB/bin/agent-supervisor.sh"
printf '%s\n' "$PWD/engine" > "$SB/bin/engine-path"

# Stub tmux: no live session (so the supervisor proceeds to launch), a server GLOBAL
# CLAUDE_CONFIG_DIR that reports the leak dir, and a new-session recorder.
cat > "$SB/tmux" <<'STUB'
#!/bin/sh
case "$1" in
  has-session)      exit 1 ;;
  show-environment) printf 'CLAUDE_CONFIG_DIR=%s\n' "$STUB_SERVER_CCD"; exit 0 ;;
  new-session)      printf '%s\n' "$@" > "$STUB_DIR/new-session.args"; exit 0 ;;
  *)                exit 0 ;;
esac
STUB
chmod 755 "$SB/tmux"

# CONTROL: nothing is trusted in the leak dir until the supervisor runs (proves the key
# assertion below is not vacuous -- a fresh sandbox has no config).
if [ -f "$SRV_CCD/.claude.json" ]; then bad "control: the server-global config already exists before the run"; else ok "control: no trust in the server-global dir until the supervisor runs"; fi

# Run the Claude arm with the supervisor's OWN CLAUDE_CONFIG_DIR unset -- so EFFECTIVE_CCD
# must come from the tmux server global (the whole point). CODEX_HOME unset too.
env -u CLAUDE_CONFIG_DIR -u CODEX_HOME \
  AGENT_WORKFORCE_DATA="$DATA" \
  AGENT_WORKFORCE_CLAUDE_CONFIG="$CFG" \
  AGENT_WORKFORCE_CLAUDE_SETTINGS="$SET" \
  STUB_DIR="$SB" STUB_SERVER_CCD="$SRV_CCD" AGENT_WORKFORCE_WAIT_POLL_SECS=1 \
  bash "$SB/bin/agent-supervisor.sh" ccdleaktest "$SB/work" /usr/bin/true "$SB/tmux" "$SB/start.log" > "$SB/out.log" 2>&1 || true

ARGS="$SB/new-session.args"
if [ -s "$ARGS" ]; then ok "the supervisor reached new-session (the launch)"; else bad "new-session never happened: $(tail -5 "$SB/out.log")"; fi

# (a) THE PANE IS PINNED to the server-global dir, so the leak cannot apply silently.
if grep -qxF "CLAUDE_CONFIG_DIR=$SRV_CCD" "$ARGS" 2>/dev/null; then
  ok "the pane was launched with -e CLAUDE_CONFIG_DIR=<server-global>"
else
  bad "new-session did not pin CLAUDE_CONFIG_DIR to the server-global dir: $(tr '\n' ' ' < "$ARGS" 2>/dev/null | head -c 300)"
fi

# (b) THE TRUST WRITE FOLLOWED THE PANE: the folder-trust key for the workdir landed in the
# SERVER-GLOBAL dir's .claude.json (what the pane reads), not the default file. The project
# key is derived by trust.js's own canonicalOnDisk so it cannot diverge from the writer.
if [ -f "$SRV_CCD/.claude.json" ] && node -e '
  const fs=require("fs"), nodePath=require("path");
  const { canonicalOnDisk } = require(process.argv[3] + "/trust");
  const key = canonicalOnDisk(process.argv[2]).split(nodePath.sep).join("/");
  const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  const e=d.projects && d.projects[key];
  process.exit(e && e.hasTrustDialogAccepted===true ? 0 : 1);
' "$SRV_CCD/.claude.json" "$SB/work" "$PWD/engine" 2>/dev/null; then
  ok "#3417: the folder-trust key landed in the SERVER-GLOBAL dir (where the pane reads)"
else
  bad "no folder-trust key in $SRV_CCD/.claude.json: $(cat "$SRV_CCD/.claude.json" 2>/dev/null | tr -d '\n' | head -c 300)"
fi

# (c) DISCRIMINATING CONTROL: the trust did NOT go to the DEFAULT file. Without the fix,
# ensure-launch-trust receives an empty configDir and writes here -- so this staying empty
# is exactly what proves the fix redirected the write to the dir the pane reads.
if [ -f "$CFG" ] && node -e '
  const fs=require("fs"), nodePath=require("path");
  const { canonicalOnDisk } = require(process.argv[3] + "/trust");
  const key = canonicalOnDisk(process.argv[2]).split(nodePath.sep).join("/");
  const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  const e=d.projects && d.projects[key];
  process.exit(e && e.hasTrustDialogAccepted===true ? 0 : 1);
' "$CFG" "$SB/work" "$PWD/engine" 2>/dev/null; then
  bad "the trust write went to the DEFAULT file too -- the leak dir did not win"
else
  ok "the default-account file did NOT receive the trust (the write followed the pane, not the default)"
fi

# The engine pointer must not leak into any log.
if grep -q "$PWD/engine" "$SB/out.log" "$SB/start.log" 2>/dev/null; then bad "the engine path leaked into a log"; else ok "the engine path stays out of the logs"; fi

[ "$FAILS" -eq 0 ] && { echo "test-supervisor-ccd-leak-3417: OK"; exit 0; } || { echo "test-supervisor-ccd-leak-3417: $FAILS FAILED"; exit 1; }
