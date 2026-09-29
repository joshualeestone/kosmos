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
if [ ! -e "$RUNTIME_HOME/plugins" ] && [ ! -e "$RUNTIME_HOME/config.toml" ]; then
  ok "plugins and account config were not copied into the private home"
else
  bad "plugin or config state leaked into the private home"
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

[ "$FAILS" -eq 0 ] && { echo "test-supervisor-codex-isolation-4592: OK"; exit 0; }
echo "test-supervisor-codex-isolation-4592: $FAILS FAILED"
exit 1
