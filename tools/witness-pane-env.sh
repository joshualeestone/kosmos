#!/bin/bash
# Witness, on REAL tmux, that the supervisor hands a pane its own account.
#
#   tools/witness-pane-env.sh [path/to/agent-supervisor.sh]
#
# ⚠️ WHY A WITNESS AND NOT ONLY A TEST. The supervisor's tests run it against
# a fake tmux that records argv. That double cannot see the property this
# script exists for: tmux does NOT hand a client's environment to a session it
# makes on an already-running server, so a value the launchd job carries
# reaches the pane only through new-session -e. The stubbed suite was green
# for the whole life of that bug (#586); this is what would have failed.
#
# The shape: a tmux server on a private socket is started under account A.
# Then the supervisor is run the way launchd runs it, with CLAUDE_CONFIG_DIR
# set to account B, against that running server, with a fake claude that
# writes what its pane sees. Exit 0 if the pane saw B, 1 if it saw anything
# else. Run it against an old supervisor first and watch it fail: a witness
# that has never failed has not been shown to see the bug.
#
# Touches nothing shared: its own socket (-L), its own temp dir, killed at exit.
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SUP="${1:-$HERE/bin/agent-supervisor.sh}"
TMUX="${TMUX_BIN:-$(command -v tmux || echo /opt/homebrew/bin/tmux)}"
[ -x "$TMUX" ] || { echo "no tmux at $TMUX"; exit 2; }
[ -r "$SUP" ] || { echo "no supervisor at $SUP"; exit 2; }
SOCK="paneenv-$$"
D="$(mktemp -d "${TMPDIR:-/tmp}/witness-pane-env.XXXXXX")"
cleanup() {
  "$TMUX" -L "$SOCK" kill-server 2>/dev/null
  if [ -n "${SUPPID:-}" ]; then kill "$SUPPID" 2>/dev/null; wait "$SUPPID" 2>/dev/null; fi
  rm -rf "$D"
}
trap cleanup EXIT

cat > "$D/tmux" <<W
#!/bin/bash
exec "$TMUX" -L "$SOCK" "\$@"
W
cat > "$D/claude" <<W
#!/bin/bash
printenv CLAUDE_CONFIG_DIR > "$D/pane-saw"; echo "rc=\$?" >> "$D/pane-saw"
sleep 30
W
chmod +x "$D/tmux" "$D/claude"
mkdir -p "$D/work"

# The server exists before the agent's job runs, and it was started by
# somebody on account A (a first agent, or a person's terminal).
env CLAUDE_CONFIG_DIR=/acct/A "$TMUX" -L "$SOCK" new-session -d -s seed 'sleep 60' || exit 2
sleep 1
# The job, as launchd runs it: account B in its environment.
env CLAUDE_CONFIG_DIR=/acct/B bash "$SUP" witness "$D/work" "$D/claude" "$D/tmux" >"$D/sup.log" 2>&1 &
SUPPID=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$D/pane-saw" ] && break; sleep 1; done
[ -s "$D/pane-saw" ] || { echo "the pane never ran claude; supervisor said:"; cat "$D/sup.log"; exit 2; }
SAW="$(head -1 "$D/pane-saw")"
echo "server started under /acct/A, job carried /acct/B, the pane saw: $SAW ($(tail -1 "$D/pane-saw"))"
[ "$SAW" = /acct/B ] && { echo "ok: the pane runs on the job's own account"; exit 0; }
echo "FAIL: the pane is on the wrong account"; exit 1
