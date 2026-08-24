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
# else, 2 if the witness itself could not be set up (no tmux, no temp dir, the
# pane never ran): a 2 is not a verdict about the account. Run it against an
# old supervisor first and watch it fail: a witness that has never failed has
# not been shown to see the bug. Measured 2026-08-24 13:00 CDT on tmux 3.6a:
# the pre-#586 supervisor (70eddf3) FAILS with "the pane saw: /acct/A", the
# #587 supervisor passes.
#
# Touches nothing shared: its own socket (-L), its own temp dir, no reading of
# the operator's tmux.conf (-f /dev/null: a -L socket isolates the socket, not
# the config, and a config that extends update-environment would hide the
# mechanism). The supervisor and everything it started are killed at exit.
#
# ⚠️ THE CONTROL IS IN THE SCRIPT, NOT LEFT TO THE OPERATOR. Before the
# supervisor runs, one plain session is made on the seeded server under
# account B WITHOUT -e and must see A. If it sees B, this tmux forwards the
# client's environment on its own and the witness cannot see the bug here:
# exit 2, never "ok".
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SUP="${1:-$HERE/bin/agent-supervisor.sh}"
# Not named TMUX: that is tmux's own exported variable inside a pane, and an
# assignment to it would be inherited by everything this script starts.
TMUX_PATH="${TMUX_BIN:-$(command -v tmux || echo /opt/homebrew/bin/tmux)}"
[ -x "$TMUX_PATH" ] || { echo "no tmux at $TMUX_PATH"; exit 2; }
[ -r "$SUP" ] || { echo "no supervisor at $SUP"; exit 2; }
SOCK="paneenv-$$"
D="$(mktemp -d "${TMPDIR:-/tmp}/witness-pane-env.XXXXXX")" || { echo "could not make a temp dir"; exit 2; }
cleanup() {
  "$TMUX_PATH" -L "$SOCK" kill-server 2>/dev/null
  if [ -n "${SUPPID:-}" ]; then kill -- "-$SUPPID" 2>/dev/null || kill "$SUPPID" 2>/dev/null; wait "$SUPPID" 2>/dev/null; fi
  rm -rf "$D"
}
trap cleanup EXIT

cat > "$D/tmux" <<W
#!/bin/bash
exec "$TMUX_PATH" -L "$SOCK" -f /dev/null "\$@"
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
env CLAUDE_CONFIG_DIR=/acct/A "$TMUX_PATH" -L "$SOCK" -f /dev/null new-session -d -s seed 'sleep 60' || exit 2
sleep 1
# The control: a plain session under B, no -e, on the running server.
env CLAUDE_CONFIG_DIR=/acct/B "$TMUX_PATH" -L "$SOCK" -f /dev/null new-session -d -s control \
  "printenv CLAUDE_CONFIG_DIR > '$D/control-saw'; echo done >> '$D/control-saw'" || exit 2
for _ in 1 2 3 4 5; do grep -q '^done' "$D/control-saw" 2>/dev/null && break; sleep 1; done
CONTROL="$(head -1 "$D/control-saw" 2>/dev/null)"
if [ "$CONTROL" != /acct/A ]; then
  echo "control: a plain session under /acct/B saw '${CONTROL:-<unset>}', not /acct/A."
  echo "this tmux hands the client environment to a session on its own; the witness cannot see the bug here"
  exit 2
fi
# The job, as launchd runs it: account B in its environment.
# In its own process group (job control gives a background job one; macOS has
# no setsid), so the kill at exit takes the supervisor's sleep with it rather
# than leaving it to run out after the temp dir is gone.
set -m
env CLAUDE_CONFIG_DIR=/acct/B bash "$SUP" witness "$D/work" "$D/claude" "$D/tmux" >"$D/sup.log" 2>&1 &
SUPPID=$!
set +m
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$D/pane-saw" ] && break; sleep 1; done
[ -s "$D/pane-saw" ] || { echo "the pane never ran claude; supervisor said:"; cat "$D/sup.log"; exit 2; }
# printenv writes nothing for an unset variable, so the file is "rc=1" alone;
# wait for the rc line so a read between the two writes cannot be half a report.
for _ in 1 2 3 4 5; do grep -q '^rc=' "$D/pane-saw" && break; sleep 1; done
SAW="$(head -1 "$D/pane-saw")"; RC="$(tail -1 "$D/pane-saw")"
case "$SAW" in rc=*) SAW="<unset>" ;; esac
echo "server started under /acct/A, job carried /acct/B, the pane saw: $SAW ($RC)"
[ "$SAW" = /acct/B ] && { echo "ok: the pane runs on the job's own account"; exit 0; }
echo "FAIL: the pane is on the wrong account"; exit 1
