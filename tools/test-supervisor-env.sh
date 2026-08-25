#!/bin/bash
# The token doors' handoff (#529): every file under secrets/env/ rides into
# the agent's pane as the variable it is named for, and nothing else in that
# directory does. Drives a COPY of the real bin/agent-supervisor.sh from a
# sandbox laid out like the store (bin/ beside secrets/), against a stub
# tmux that records what new-session was asked for. The engine side is
# engine/tokendoors.test.js; this is the half nobody sees.
set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }
SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
mkdir -p "$SB/bin" "$SB/secrets/env" "$SB/work"
cp bin/agent-supervisor.sh "$SB/bin/agent-supervisor.sh"
printf '%s\n' 'sekrit-discord' > "$SB/secrets/env/DISCORD_BOT_TOKEN"
printf '%s\n' 'sekrit-brave' > "$SB/secrets/env/BRAVE_API_KEY"
printf '%s\n' 'never' > "$SB/secrets/env/lower-case"      # not a variable name
printf '%s\n' 'never' > "$SB/secrets/env/1STARTS_WITH_DIGIT"
printf '%s\n' 'never' > "$SB/secrets/env/BAD.NAME"
: > "$SB/secrets/env/EMPTY_TOKEN"                          # empty: nothing to hand over
cat > "$SB/tmux" <<'STUB'
#!/bin/sh
case "$1" in
  has-session) exit 1 ;;
  new-session) printf '%s\n' "$@" > "$STUB_DIR/new-session.args"; exit 0 ;;
  *) exit 0 ;;
esac
STUB
chmod 755 "$SB/tmux"
STUB_DIR="$SB" AGENT_WORKFORCE_WAIT_POLL_SECS=1 \
  bash "$SB/bin/agent-supervisor.sh" envtest "$SB/work" /usr/bin/true "$SB/tmux" "$SB/start.log" > "$SB/out.log" 2>&1 || true
ARGS="$SB/new-session.args"
if [ -s "$ARGS" ]; then ok "the supervisor reached new-session"; else bad "new-session was never asked for: $(cat "$SB/out.log" | tail -5)"; fi
if grep -qx 'DISCORD_BOT_TOKEN=sekrit-discord' "$ARGS"; then ok "a token door's file rides into the pane as its variable"; else bad "DISCORD_BOT_TOKEN did not reach the pane: $(tr '\n' ' ' < "$ARGS")"; fi
if grep -qx 'BRAVE_API_KEY=sekrit-brave' "$ARGS"; then ok "and a second one beside it, with no edit to the supervisor"; else bad "BRAVE_API_KEY did not reach the pane"; fi
for junk in lower-case 1STARTS_WITH_DIGIT BAD.NAME EMPTY_TOKEN; do
  if grep -q "$junk" "$ARGS"; then bad "$junk was typed into the pane; only variable names with content may ride"; else ok "$junk stays out of the pane"; fi
done
if grep -q 'sekrit' "$SB/out.log" "$SB/start.log" 2>/dev/null; then bad "a token reached a log"; else ok "no token in the supervisor's own output"; fi
[ "$FAILS" -eq 0 ] && echo "supervisor env handoff: all hold" || echo "supervisor env handoff: $FAILS FAILED"
exit "$FAILS"
