#!/bin/bash
# #2808 class-1 / #2129: the supervisor RE-APPLIES folder-trust + bypass pre-accept on
# every (re)launch, not just at create.
#
# engine/create.js writes trustFolder + preacceptBypass once, at CREATE. A restart
# re-runs bin/agent-supervisor.sh, NOT create.js, and --dangerously-skip-permissions
# does not answer the folder-trust dialog -- so before this fix a restarted agent could
# park on the #2129 trust prompt. This drives a COPY of the real supervisor against a
# stub tmux, with the engine pointer aimed at the REAL engine (so the real
# engine/ensure-launch-trust.js runs end to end) and the trust/settings/data roots
# sandboxed, and asserts the supervisor's Claude arm wrote both keys BEFORE the launch.
#
# 🛑 SANDBOX EVERY ROOT. The default-account trust write targets ~/.claude.json and the
# bypass write ~/.claude/settings.json; without the seams below this test would write the
# operator's real config (the a-test-of-the-real-env-branch hazard). All temp dirs ride
# the ONE trap (a second `trap ... EXIT` replaces the first, measured).
set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

SB="$(mktemp -d)"
DATA="$(mktemp -d)"
CFG="$SB/claude.json"          # AGENT_WORKFORCE_CLAUDE_CONFIG target (default-account trust write)
SET="$SB/settings.json"        # AGENT_WORKFORCE_CLAUDE_SETTINGS target (bypass pre-accept write)
trap 'rm -rf "${SB:-}" "${DATA:-}"' EXIT

mkdir -p "$SB/bin" "$SB/work"
cp bin/agent-supervisor.sh "$SB/bin/agent-supervisor.sh"
# The board writes this beside the supervisor: an absolute path to the REAL engine, so
# $_eng resolves and the real ensure-launch-trust.js (+ trust.js + its deps) runs.
printf '%s\n' "$PWD/engine" > "$SB/bin/engine-path"
# Stub tmux: record what new-session was asked for, so we can assert the launch happened
# AND that the trust write landed before it (the config exists by the time we read it).
cat > "$SB/tmux" <<'STUB'
#!/bin/sh
case "$1" in
  has-session) exit 1 ;;
  new-session) printf '%s\n' "$@" > "$STUB_DIR/new-session.args"; exit 0 ;;
  *) exit 0 ;;
esac
STUB
chmod 755 "$SB/tmux"

# CONTROL: nothing is trusted until the supervisor runs (proves the assertions below are
# not vacuous -- a fresh sandbox has no config, so a real launch here would fire #2129).
if [ -f "$CFG" ]; then bad "control: the sandbox config already exists before the run"; else ok "control: no trust config until the supervisor runs"; fi

# Run the Claude arm (CLAUDE=/usr/bin/true, no model).
# 🛑 UNSET CLAUDE_CONFIG_DIR + CODEX_HOME. The supervisor passes ${CLAUDE_CONFIG_DIR:-}
# to the helper as its configDir; if the test inherits a real CLAUDE_CONFIG_DIR from the
# invoking session, the helper writes that REAL account config instead of the sandbox
# seams (the a-test-of-the-real-env-branch hazard - measured: it wrote the operator's
# ~/.claude-account-c/.claude.json). `env -u` removes them so the helper takes the
# default-account path and lands in AGENT_WORKFORCE_CLAUDE_CONFIG/SETTINGS below.
env -u CLAUDE_CONFIG_DIR -u CODEX_HOME \
  AGENT_WORKFORCE_DATA="$DATA" \
  AGENT_WORKFORCE_CLAUDE_CONFIG="$CFG" \
  AGENT_WORKFORCE_CLAUDE_SETTINGS="$SET" \
  STUB_DIR="$SB" AGENT_WORKFORCE_WAIT_POLL_SECS=1 \
  bash "$SB/bin/agent-supervisor.sh" retrusttest "$SB/work" /usr/bin/true "$SB/tmux" "$SB/start.log" > "$SB/out.log" 2>&1 || true

ARGS="$SB/new-session.args"
if [ -s "$ARGS" ]; then ok "the supervisor reached new-session (the launch)"; else bad "new-session never happened: $(tail -5 "$SB/out.log")"; fi

# The whole fix: the folder-trust key for the agent's workdir landed in the sandbox
# config, written by the supervisor BEFORE the launch above.
WORK_REAL="$(cd "$SB/work" && pwd -P)"
if [ -f "$CFG" ] && node -e '
  const fs=require("fs"), p=process.argv[1], k=process.argv[2];
  const d=JSON.parse(fs.readFileSync(p,"utf8"));
  const e=d.projects && d.projects[k];
  process.exit(e && e.hasTrustDialogAccepted===true ? 0 : 1);
' "$CFG" "$WORK_REAL" 2>/dev/null; then
  ok "#2129: the supervisor re-applied the folder-trust key for the workdir before launch"
else
  bad "no folder-trust key for $WORK_REAL in $CFG: $(cat "$CFG" 2>/dev/null | tr -d '\n' | head -c 300)"
fi

# And the one-time Bypass-Permissions acceptance, so --dangerously-skip-permissions does
# not park the agent on that consent on a fresh config dir.
if [ -f "$SET" ] && node -e '
  const fs=require("fs");
  const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  process.exit(d.skipDangerousModePermissionPrompt===true ? 0 : 1);
' "$SET" 2>/dev/null; then
  ok "the supervisor re-applied the bypass pre-accept before launch"
else
  bad "no bypass pre-accept in $SET: $(cat "$SET" 2>/dev/null | tr -d '\n' | head -c 300)"
fi

# The engine pointer must not leak into any log the operator or a sweep might read.
if grep -q "$PWD/engine" "$SB/out.log" "$SB/start.log" 2>/dev/null; then bad "the engine path leaked into a log"; else ok "the engine path stays out of the logs"; fi

[ "$FAILS" -eq 0 ] && { echo "test-supervisor-retrust-2808: OK"; exit 0; } || { echo "test-supervisor-retrust-2808: $FAILS FAILED"; exit 1; }
