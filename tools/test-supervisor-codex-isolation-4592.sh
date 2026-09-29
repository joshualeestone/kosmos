#!/bin/bash
# #4592: a Codex agent receives a Kosmos-owned home, not the selected account's
# plugin-bearing home. Everything is synthetic and under one scratch root.
set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

SB="$(mktemp -d)"
trap 'rm -rf "${SB:-}"' EXIT
PERSON_HOME="$SB/person-codex"
DATA_PARENT="$SB/data"
RUNTIME_HOME="$DATA_PARENT/Kosmos/codex-homes/pluginprobe"
PLUGIN="$PERSON_HOME/plugins/cache/openai-bundled/browser/local"
mkdir -p "$SB/bin" "$SB/work" "$PLUGIN/.codex-plugin" "$PLUGIN/hooks" "$PERSON_HOME"
chmod 700 "$PERSON_HOME"
printf '%s\n' '{"auth_mode":"apikey","OPENAI_API_KEY":"fixture-not-a-secret"}' > "$PERSON_HOME/auth.json"
chmod 600 "$PERSON_HOME/auth.json"
printf '%s\n' '{"name":"browser","version":"1.0.0","description":"test stand-in"}' > "$PLUGIN/.codex-plugin/plugin.json"
printf '%s\n' '{"hooks":{"SessionStart":[{"command":"fixture-hook"}]}}' > "$PLUGIN/hooks/hooks.json"
printf '%s\n' '{"latest_version":"0.149.1"}' > "$PERSON_HOME/version.json"
cp "${SUPERVISOR_UNDER_TEST:-bin/agent-supervisor.sh}" "$SB/bin/agent-supervisor.sh"
printf '%s\n' "$PWD/engine" > "$SB/bin/engine-path"

# The fake tmux records the real supervisor's complete new-session vector. It
# also resolves the CODEX_HOME handed to the fake pane and records whether that
# launched agent can see the planted hook.
cat > "$SB/tmux" <<'STUB'
#!/bin/bash
case "$1" in
  has-session) exit 1 ;;
  show-environment) exit 1 ;;
  new-session)
    printf '%s\n' "$@" > "$STUB_DIR/new-session.args"
    home=""; prev=""
    for arg in "$@"; do
      if [ "$prev" = -e ]; then case "$arg" in CODEX_HOME=*) home="${arg#CODEX_HOME=}" ;; esac; fi
      prev="$arg"
    done
    if [ -f "$home/plugins/cache/openai-bundled/browser/local/hooks/hooks.json" ]; then
      echo seen > "$STUB_DIR/hook.result"
    else
      echo isolated > "$STUB_DIR/hook.result"
    fi
    exit 0 ;;
  *) exit 0 ;;
esac
STUB
chmod 755 "$SB/tmux"

CODEX_HOME="$PERSON_HOME" AGENT_WORKFORCE_DATA="$DATA_PARENT" \
  STUB_DIR="$SB" AGENT_WORKFORCE_WAIT_POLL_SECS=1 \
  bash "$SB/bin/agent-supervisor.sh" pluginprobe "$SB/work" /usr/bin/true "$SB/tmux" "$SB/start.log" "" codex > "$SB/out.log" 2>&1 || true

ARGS="$SB/new-session.args"
if grep -qxF "CODEX_HOME=$RUNTIME_HOME" "$ARGS" 2>/dev/null; then
  ok "the launched pane receives its per-agent Kosmos CODEX_HOME"
else
  bad "the pane did not receive the private home: $(tr '\n' ' ' < "$ARGS" 2>/dev/null | head -c 300)"
fi
if [ "$(cat "$SB/hook.result" 2>/dev/null)" = isolated ]; then
  ok "the launched agent cannot see the planted person-home plugin hook"
else
  bad "the launched agent saw the planted person-home hook"
fi
if [ -L "$RUNTIME_HOME/auth.json" ] && [ "$(readlink "$RUNTIME_HOME/auth.json")" = "$PERSON_HOME/auth.json" ]; then
  ok "the private home links only the selected account credential"
else
  bad "the private home did not link the selected account credential"
fi
if [ ! -e "$RUNTIME_HOME/plugins" ] \
  && grep -Fq "[projects.\"$(cd "$SB/work" && pwd -P)\"]" "$RUNTIME_HOME/config.toml" 2>/dev/null \
  && grep -Fq 'trust_level = "trusted"' "$RUNTIME_HOME/config.toml" 2>/dev/null \
  && ! grep -Fq 'model_provider' "$RUNTIME_HOME/config.toml" 2>/dev/null; then
  ok "only launch-folder trust, not account plugins or settings, enters the private home"
else
  bad "private home trust is absent or account config leaked"
fi
if [ "$(stat -f %Lp "$RUNTIME_HOME" 2>/dev/null || stat -c %a "$RUNTIME_HOME" 2>/dev/null)" = 700 ]; then
  ok "the private home is owner-only"
else
  bad "the private home is not mode 700"
fi

# Codex 0.149.1's refresh path opens auth.json with truncate+write. Reproduce
# that exact filesystem operation and prove it follows, rather than replaces,
# the link. The fixture value is not a live credential.
node -e 'const fs=require("fs"); const p=process.argv[1]; const fd=fs.openSync(p,"w",0o600); fs.writeFileSync(fd,"refreshed-fixture\n"); fs.closeSync(fd)' "$RUNTIME_HOME/auth.json"
if [ -L "$RUNTIME_HOME/auth.json" ]; then
  ok "a refresh-shaped truncate/write preserves the auth link"
else
  bad "a refresh-shaped write replaced the auth link"
fi
if [ "$(cat "$PERSON_HOME/auth.json")" = refreshed-fixture ]; then
  ok "the refresh-shaped write updates the authoritative account file"
else
  bad "the refresh-shaped write forked the account credential"
fi

# Re-launch the same existing agent on another selected account. The supervisor
# is the migration seam for old launch jobs, so no generated plist rewrite is
# involved and the runtime link must be replaced in place.
SECOND_HOME="$SB/second-codex"
mkdir -p "$SECOND_HOME"
printf '%s\n' '{"auth_mode":"apikey","OPENAI_API_KEY":"second-fixture"}' > "$SECOND_HOME/auth.json"
CODEX_HOME="$SECOND_HOME" AGENT_WORKFORCE_DATA="$DATA_PARENT" \
  STUB_DIR="$SB" AGENT_WORKFORCE_WAIT_POLL_SECS=1 \
  bash "$SB/bin/agent-supervisor.sh" pluginprobe "$SB/work" /usr/bin/true "$SB/tmux" "$SB/start.log" "" codex > "$SB/switch.log" 2>&1 || true
if [ -L "$RUNTIME_HOME/auth.json" ] && [ "$(readlink "$RUNTIME_HOME/auth.json")" = "$SECOND_HOME/auth.json" ]; then
  ok "an existing agent's runtime link follows an account switch"
else
  bad "an existing agent kept the old account after a switch"
fi

# A default account has no CODEX_HOME in its old launch job. The current
# AGENT_WORKFORCE_CODEX_HOME seam stands in for its normal HOME/.codex source.
DEFAULT_HOME="$SB/default-codex"
mkdir -p "$DEFAULT_HOME"
printf '%s\n' '{"auth_mode":"apikey","OPENAI_API_KEY":"default-fixture"}' > "$DEFAULT_HOME/auth.json"
env -u CODEX_HOME AGENT_WORKFORCE_CODEX_HOME="$DEFAULT_HOME" AGENT_WORKFORCE_DATA="$DATA_PARENT" \
  STUB_DIR="$SB" AGENT_WORKFORCE_WAIT_POLL_SECS=1 \
  bash "$SB/bin/agent-supervisor.sh" defaultprobe "$SB/work" /usr/bin/true "$SB/tmux" "$SB/start.log" "" codex > "$SB/default.log" 2>&1 || true
DEFAULT_RUNTIME="$DATA_PARENT/Kosmos/codex-homes/defaultprobe"
if [ -L "$DEFAULT_RUNTIME/auth.json" ] && [ "$(readlink "$DEFAULT_RUNTIME/auth.json")" = "$DEFAULT_HOME/auth.json" ]; then
  ok "an existing default-account launch keeps its sign-in through isolation"
else
  bad "the default-account migration lost or changed its selected sign-in"
fi

# Missing source auth stays missing. It must not reuse a prior account, copy a
# credential, or fall back to the person's plugin-bearing home.
NOAUTH_HOME="$SB/no-auth-codex"
mkdir -p "$NOAUTH_HOME"
CODEX_HOME="$NOAUTH_HOME" AGENT_WORKFORCE_DATA="$DATA_PARENT" \
  STUB_DIR="$SB" AGENT_WORKFORCE_WAIT_POLL_SECS=1 \
  bash "$SB/bin/agent-supervisor.sh" noauthprobe "$SB/work" /usr/bin/true "$SB/tmux" "$SB/start.log" "" codex > "$SB/noauth.log" 2>&1 || true
if [ ! -e "$DATA_PARENT/Kosmos/codex-homes/noauthprobe/auth.json" ] && [ ! -L "$DATA_PARENT/Kosmos/codex-homes/noauthprobe/auth.json" ]; then
  ok "an unsigned-in account stays unsigned in, with no credential fallback"
else
  bad "a missing account credential was invented or carried over"
fi

# A hostile or stale runtime-home symlink must never make the auth replacement
# remove the selected account's only credential. This is the exact self-link
# shape: both auth paths resolve through the same physical directory.
SELFLINK_HOME="$SB/selflink-codex"
mkdir -p "$SELFLINK_HOME" "$DATA_PARENT/Kosmos/codex-homes"
printf '%s\n' 'selflink-fixture' > "$SELFLINK_HOME/auth.json"
ln -s "$SELFLINK_HOME" "$DATA_PARENT/Kosmos/codex-homes/selflinkprobe"
CODEX_HOME="$SELFLINK_HOME" AGENT_WORKFORCE_DATA="$DATA_PARENT" \
  STUB_DIR="$SB" AGENT_WORKFORCE_WAIT_POLL_SECS=1 \
  bash "$SB/bin/agent-supervisor.sh" selflinkprobe "$SB/work" /usr/bin/true "$SB/tmux" "$SB/start.log" "" codex > "$SB/selflink.log" 2>&1 || true
if [ "$(cat "$SELFLINK_HOME/auth.json" 2>/dev/null)" = selflink-fixture ]; then
  ok "a runtime-home self-link cannot remove the selected account credential"
else
  bad "the runtime-home self-link removed or changed the selected account credential"
fi

# A second agent on the same account gets a different runtime home. This is the
# distinction between per-agent isolation and one shared Kosmos home.
CODEX_HOME="$PERSON_HOME" AGENT_WORKFORCE_DATA="$DATA_PARENT" \
  STUB_DIR="$SB" AGENT_WORKFORCE_WAIT_POLL_SECS=1 \
  bash "$SB/bin/agent-supervisor.sh" otherprobe "$SB/work" /usr/bin/true "$SB/tmux" "$SB/start.log" "" codex > "$SB/out2.log" 2>&1 || true
if grep -qxF "CODEX_HOME=$DATA_PARENT/Kosmos/codex-homes/otherprobe" "$ARGS" 2>/dev/null; then
  ok "two agents selecting one account receive different runtime homes"
else
  bad "the second agent did not receive its own runtime home"
fi

# The installed engine pointer is what gives the copied supervisor its shared
# runtime-home derivation. Without it, launching with CODEX_HOME= would make
# real Codex 0.149.1 fall back to ~/.codex and restore the person's plugins.
# Refuse before tmux instead.
rm -f "$SB/bin/engine-path" "$ARGS"
CODEX_HOME="$PERSON_HOME" AGENT_WORKFORCE_DATA="$DATA_PARENT" \
  STUB_DIR="$SB" AGENT_WORKFORCE_WAIT_POLL_SECS=1 \
  bash "$SB/bin/agent-supervisor.sh" noengineprobe "$SB/work" /usr/bin/true "$SB/tmux" "$SB/start.log" "" codex > "$SB/noengine.log" 2>&1
NOENGINE_RC=$?
if [ "$NOENGINE_RC" -ne 0 ] && [ ! -e "$ARGS" ] \
  && grep -Fq 'could not resolve its private Codex home; the agent was not started' "$SB/noengine.log"; then
  ok "a missing engine or node refuses the Codex launch instead of passing an empty home"
else
  bad "a missing engine or node reached tmux or was not explained (rc $NOENGINE_RC)"
fi

[ "$FAILS" -eq 0 ] && { echo "test-supervisor-codex-isolation-4592: OK"; exit 0; }
echo "test-supervisor-codex-isolation-4592: $FAILS FAILED"
exit 1
