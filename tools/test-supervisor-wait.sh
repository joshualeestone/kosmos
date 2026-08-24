#!/bin/bash
# The not-ours wait says so, on a cadence, and never quietly gives up (#579).
#
# Drives the REAL bin/agent-supervisor.sh against a stub tmux whose
# has-session holds the name for a fixed number of polls and then releases
# it -- the leaked-fixture shape that held `bl2` for 19.8 hours with one
# warning and 14,225 silent traces. The two seams this uses
# (AGENT_WORKFORCE_WAIT_POLL_SECS, _ESCALATE_SECS) exist for exactly this
# file; production never sets them.
set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT

# ── the stub tmux ────────────────────────────────────────────────────────────
# has-session: answers "held" until the counter reaches its limit, then the
# holder is gone. show-options: never ours. list-panes: what the holder
# runs, so the escalation can name it. new-session: fails, which is the
# script's own documented clean exit -- the wait behaviour is the whole
# subject here, not the launch.
cat > "$SB/tmux" <<'STUB'
#!/bin/sh
C="$STUB_DIR/count"
case "$1" in
  has-session)
    n=$(cat "$C" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$C"
    [ "$n" -le "$STUB_HOLD" ] && exit 0 || exit 1 ;;
  show-options) exit 1 ;;
  list-panes) echo "vim"; exit 0 ;;
  new-session) exit 1 ;;
  *) exit 0 ;;
esac
STUB
chmod 755 "$SB/tmux"

# The supervisor takes tmux as its fourth positional (the plist contract);
# the stub rides that argument, so nothing here depends on PATH tricks.
run_supervisor() { # $1 hold-polls  $2 escalate-secs  $3 logfile
  : > "$SB/count"
  mkdir -p "$SB/work"
  STUB_DIR="$SB" STUB_HOLD="$1" \
  AGENT_WORKFORCE_WAIT_POLL_SECS=1 AGENT_WORKFORCE_WAIT_ESCALATE_SECS="$2" \
  bash bin/agent-supervisor.sh stolen "$SB/work" /usr/bin/true "$SB/tmux" "$SB/start.log" 2> "$3"
}

# ── 1. a held name escalates, named, on the cadence ─────────────────────────
run_supervisor 8 3 "$SB/held.log" || true
WARNS=$(grep -c 'is already running and is not ours' "$SB/held.log" || true)
ESCS=$(grep -c 'STILL WAITING' "$SB/held.log" || true)
if [ "$WARNS" -eq 1 ]; then ok "the first warning still appears exactly once"; else bad "warned $WARNS times (want 1): $(cat "$SB/held.log")"; fi
if [ "$ESCS" -ge 2 ]; then ok "the wait escalated repeatedly ($ESCS times), not once and never again"; else bad "escalated $ESCS times (want >=2): $(cat "$SB/held.log")"; fi
if grep -q 'held by a session we did not create' "$SB/held.log"; then ok "the escalation NAMES the failure"; else bad "the escalation does not name what is wrong"; fi
if grep -q 'running: vim' "$SB/held.log"; then ok "the escalation names what is holding the name"; else bad "the holder is not named: $(grep 'STILL WAITING' "$SB/held.log" | head -1)"; fi
if grep -q 'we will not, because it may be somebody' "$SB/held.log"; then ok "it says why it will not kill, so nobody 'fixes' the wait into a kill"; else bad "the do-not-kill reasoning is gone"; fi

# ── 2. the wait still ENDS when the holder ends: no quiet give-up, no stuck loop
# The run above finished at all (run_supervisor returned) because after
# STUB_HOLD polls the holder vanished and the script moved on to its own
# documented new-session exit. A wait that never re-checked would still be
# running and this test would hang rather than fail -- so completion IS the
# assertion, made explicit here.
ok "the wait released the moment the holder ended (the run completed)"

# ── 3. a short hold stays quiet: escalation is for the long tail, not noise ──
run_supervisor 2 600 "$SB/short.log" || true
if ! grep -q 'STILL WAITING' "$SB/short.log"; then ok "a brief collision produces the one warning and no escalation"; else bad "a two-second hold escalated: $(cat "$SB/short.log")"; fi

if [ "$FAILS" -eq 0 ]; then echo "supervisor wait: says so, named, on cadence, and releases"; fi
exit "$FAILS"
