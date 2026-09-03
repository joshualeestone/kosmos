#!/bin/bash
# The token doors' handoff (#529): every file under secrets/env/ rides into
# the agent's pane as the variable it is named for, and nothing else in that
# directory does. Drives a COPY of the real bin/agent-supervisor.sh from a
# sandbox laid out like the store (bin/ beside secrets/), against a stub
# tmux that records what new-session was asked for. The engine side is
# engine/tokendoors.test.js; this is the half nobody sees.
# 🛑 SANDBOX THE STORE. #1077 made the supervisor MINT a sender token at launch,
# which turned this from a store-free test into one that writes to the REAL
# store: running it put four tokens into the live sendertokens directory under
# this test's own session name, and they looked exactly like somebody else's
# probe on a sweep.
# ⇒ it copies the supervisor to a sandbox with no engine sibling. That is
# EXACTLY THE INSTALLED LAYOUT (#1139): SUPPORT_DIR/bin has no engine/, so the
# mint was skipped for every real agent and none ever got a token. This file
# had already noticed the skip and read it as convenient for the test rather
# than as what production does. It is now asserted BOTH ways below.
# Same rule every store-using test in this repo already follows: sandbox BEFORE
# anything can resolve the store root.
AGENT_WORKFORCE_DATA="$(mktemp -d)"; export AGENT_WORKFORCE_DATA
# 🛑 ONE TRAP FOR EVERY TEMP DIR IN THIS FILE (#1151). A second `trap ... EXIT`
# REPLACES the first rather than adding to it -- measured, not assumed. This file
# had THREE, so only the last one's dirs were ever removed and the sandbox above
# was left in TMPDIR on every run.
#
# 🔑 The body is evaluated when the trap FIRES, not when it is set, so naming
# variables that do not exist yet is correct and they are picked up if the run
# gets that far. `${VAR:-}` keeps `set -u` happy for the ones it never reaches.
#
# ⇒ ADD A NEW TEMP DIR TO THIS LINE. Do not write another trap.
trap 'rm -rf "$AGENT_WORKFORCE_DATA" "${SB:-}" "${SB2:-}" "${DATA2:-}" "${SB3:-}" "${DATA3:-}"' EXIT

set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }
SB="$(mktemp -d)"   # removed by the single trap above
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

# ---------------------------------------------------------------- #1139
# THE INSTALLED LAYOUT, BOTH WAYS. The sandbox above is shaped like
# SUPPORT_DIR: a bin/ with no engine sibling. That is where every real agent's
# supervisor lives, and there it minted nothing.
#
# 🛑 THE SECOND ARM IS THE ONE THAT MATTERS AND IT MUST FAIL ON THE BROKEN
# ENVIRONMENT, not merely pass on a fixed one. With `engine-path` beside the
# script -- which `create.installSupervisor` now writes in the same refresh
# that installs it -- the mint must reach the pane. Before the fix this arm
# fails by name, because the supervisor only ever looked at `$0/../engine`.
if grep -q '^KOSMOS_AGENT_TOKEN=' "$ARGS"; then
  bad "a token rode into the pane with NO engine beside the script and NO pointer: the resolution is not conditional"
else
  ok "control: no engine sibling and no pointer means no token, rather than a broken one"
fi

SB2="$(mktemp -d)"   # removed by the single trap above
mkdir -p "$SB2/bin" "$SB2/work"
cp bin/agent-supervisor.sh "$SB2/bin/agent-supervisor.sh"
cp "$SB/tmux" "$SB2/tmux"
# What the board writes beside the supervisor: an absolute path to the engine.
printf '%s\n' "$PWD/engine" > "$SB2/bin/engine-path"
# ⚠️ NAMED, not created inline. As a bare command-prefix assignment this made a
# directory that no variable held, so no trap could ever have removed it.
DATA2="$(mktemp -d)"
AGENT_WORKFORCE_DATA="$DATA2" STUB_DIR="$SB2" AGENT_WORKFORCE_WAIT_POLL_SECS=1 \
  bash "$SB2/bin/agent-supervisor.sh" ptrtest "$SB2/work" /usr/bin/true "$SB2/tmux" "$SB2/start.log" > "$SB2/out.log" 2>&1 || true
ARGS2="$SB2/new-session.args"
if [ -s "$ARGS2" ]; then ok "the pointer run reached new-session"; else bad "pointer run never reached new-session: $(tail -3 "$SB2/out.log")"; fi
if grep -qE '^KOSMOS_AGENT_TOKEN=[0-9a-f]+$' "$ARGS2"; then
  ok "#1139: engine-path beside the script mints, in the layout every real agent runs in"
else
  bad "#1139: no token minted with engine-path present -- an installed agent still cannot identify itself: $(grep -c . "$ARGS2") args, $(tail -3 "$SB2/out.log")"
fi
if grep -q "$PWD/engine" "$SB2/out.log" "$SB2/start.log" 2>/dev/null; then bad "the engine path leaked into a log"; else ok "the pointer does not appear in the supervisor's output"; fi

# ---------------------------------------------------------------- #1897
# THE INSTALLED PATH, FAITHFULLY. The SB2 arm above mints -- but only because
# `command -v node` finds node on the TEST's PATH, the one fallback a real agent
# does NOT have: launchd hands the supervisor exactly /usr/bin:/bin:/usr/sbin:/sbin
# and there is no node there. Before #1897 the bundled-node candidate was derived
# from $_app (SUPPORT_DIR/..), which never pointed at the runtime, so with node
# off PATH BOTH candidates were empty and no installed agent ever minted a token.
# This arm strips PATH to the launchd set and lays the bundled node beside app
# the way install/kosmos does (runtime a sibling of app). It asserts a token IS
# present, so it FAILS on the old supervisor and passes only once node is derived
# from the engine pointer that already resolves ($_eng/../../runtime/bin/node).
#
# 🛑 STORE-FREE. sendertoken.js here is a stub whose mint returns a fixed hex
# token, so this proves NODE RESOLUTION without minting a real credential into
# any store -- the real mint is engine/sendertoken's own tests.
SB3="$(mktemp -d)"   # removed by the single trap above
mkdir -p "$SB3/bin" "$SB3/work" "$SB3/root/app/engine" "$SB3/root/runtime/bin"
cp bin/agent-supervisor.sh "$SB3/bin/agent-supervisor.sh"
cp "$SB/tmux" "$SB3/tmux"
cat > "$SB3/root/app/engine/sendertoken.js" <<'STUBJS'
module.exports = { mint: () => ({ ok: true, token: 'deadbeef' }) };
STUBJS
# The bundled node, beside app exactly as the installer lays it out. A real dir
# tree (not a symlinked engine), so `$_eng/../..` resolves to the layout root and
# not to a symlink target's parent.
ln -s "$(command -v node)" "$SB3/root/runtime/bin/node"
printf '%s\n' "$SB3/root/app/engine" > "$SB3/bin/engine-path"
DATA3="$(mktemp -d)"
# 🛑 THE LAUNCHD PATH, exactly -- no node, only coreutils. /bin/bash by absolute
# path so stripping PATH cannot lose the interpreter itself; PATH exported inside
# the subshell so the supervisor and everything it spawns sees the launchd set.
(
  export AGENT_WORKFORCE_DATA="$DATA3" STUB_DIR="$SB3" AGENT_WORKFORCE_WAIT_POLL_SECS=1
  export PATH="/usr/bin:/bin:/usr/sbin:/sbin"
  /bin/bash "$SB3/bin/agent-supervisor.sh" nodetest "$SB3/work" /usr/bin/true "$SB3/tmux" "$SB3/start.log"
) > "$SB3/out.log" 2>&1 || true
ARGS3="$SB3/new-session.args"
if [ -s "$ARGS3" ]; then ok "the launchd-PATH run reached new-session"; else bad "launchd-PATH run never reached new-session: $(tail -3 "$SB3/out.log")"; fi
if grep -qx 'KOSMOS_AGENT_TOKEN=deadbeef' "$ARGS3"; then
  ok "#1897: node derived from the engine pointer mints with NO node on PATH -- the layout every installed agent runs in"
else
  bad "#1897: no token from the bundled node with node off PATH -- an installed agent still cannot identify itself: $(grep -c . "$ARGS3") args, $(tail -3 "$SB3/out.log")"
fi

[ "$FAILS" -eq 0 ] && echo "supervisor env handoff: all hold" || echo "supervisor env handoff: $FAILS FAILED"
exit "$FAILS"
