#!/bin/bash
# #2140 (persistence-hardening slice): the LAST link in the per-agent model
# chain -- the runtime launch. A chosen model id is validated at create time,
# written verbatim to the launchd plist's model slot ($6), and handed to
# bin/agent-supervisor.sh as MODEL. This proves the supervisor passes that exact
# id INTO the runtime, and that the codex and claude runners use their correct,
# DIFFERENT flags:
#   - codex  -> `-m "$MODEL"`      (with --dangerously-bypass-approvals-and-sandbox)
#   - claude -> `--model "$MODEL"` (with --dangerously-skip-permissions)
# and that an empty MODEL ("Let OpenAI choose") passes NO model flag, so the
# runner picks its own default rather than one we silently substitute.
#
# Harness mirrors test-supervisor-env.sh: a sandbox copy of the real supervisor
# beside a stub tmux that records exactly what `new-session` was asked for. The
# model flag lives in that recorded argv, so the assertions read it directly.
# No engine sibling and no secrets/env, so the token-door + mint preamble is a
# no-op here (that half is test-supervisor-env.sh's job, not this one).
AGENT_WORKFORCE_DATA="$(mktemp -d)"; export AGENT_WORKFORCE_DATA
trap 'rm -rf "$AGENT_WORKFORCE_DATA" "${SBC:-}" "${SBE:-}" "${SBCL:-}"' EXIT

set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

# A stub tmux that records the new-session argv and reports no existing session
# (so the supervisor proceeds to launch), written into a given sandbox dir.
make_sandbox() {
  local dir="$1"
  mkdir -p "$dir/bin" "$dir/work"
  cp bin/agent-supervisor.sh "$dir/bin/agent-supervisor.sh"
  cat > "$dir/tmux" <<'STUB'
#!/bin/sh
case "$1" in
  has-session) exit 1 ;;
  new-session) printf '%s\n' "$@" > "$STUB_DIR/new-session.args"; exit 0 ;;
  *) exit 0 ;;
esac
STUB
  chmod 755 "$dir/tmux"
}

# Run the supervisor once with a given MODEL ($6) and RUNNER ($7).
run_arm() {
  local dir="$1" session="$2" model="$3" runner="$4"
  STUB_DIR="$dir" AGENT_WORKFORCE_WAIT_POLL_SECS=1 \
    bash "$dir/bin/agent-supervisor.sh" "$session" "$dir/work" /usr/bin/true "$dir/tmux" "$dir/start.log" "$model" "$runner" \
    > "$dir/out.log" 2>&1 || true
}

MODEL_ID='gpt-4o-2024-08-06'   # a dated snapshot: proves the exact id survives verbatim

# --- Arm 1: codex + a chosen model -> `-m <id>` verbatim ----------------------
SBC="$(mktemp -d)"; make_sandbox "$SBC"
run_arm "$SBC" oa-model "$MODEL_ID" codex
A="$SBC/new-session.args"
if [ -s "$A" ]; then ok "codex+model: the supervisor reached new-session"; else bad "codex+model: new-session never reached: $(tail -3 "$SBC/out.log")"; fi
if grep -qx -- '-m' "$A"; then ok "codex uses the -m flag"; else bad "codex did not pass -m: $(tr '\n' ' ' < "$A")"; fi
if grep -qxF "$MODEL_ID" "$A"; then ok "codex passes the EXACT chosen model id ($MODEL_ID) verbatim into the runtime"; else bad "the chosen model id did not reach the codex launch: $(tr '\n' ' ' < "$A")"; fi
if grep -qx -- '--dangerously-bypass-approvals-and-sandbox' "$A"; then ok "codex arm launched (its bypass flag is present)"; else bad "codex bypass flag missing (wrong arm?): $(tr '\n' ' ' < "$A")"; fi
if grep -qx -- '--model' "$A"; then bad "codex must use -m, not --model: $(tr '\n' ' ' < "$A")"; else ok "codex does NOT use --model (that is the claude flag)"; fi

# --- Arm 2: codex + empty model -> NO model flag (auto) -----------------------
SBE="$(mktemp -d)"; make_sandbox "$SBE"
run_arm "$SBE" oa-auto "" codex
E="$SBE/new-session.args"
if [ -s "$E" ]; then ok "codex+auto: the supervisor reached new-session"; else bad "codex+auto: new-session never reached: $(tail -3 "$SBE/out.log")"; fi
if grep -qx -- '-m' "$E"; then bad "an empty model must pass NO -m flag (auto), but -m was present: $(tr '\n' ' ' < "$E")"; else ok "empty model passes NO -m flag -- the runner picks its own default, nothing substituted"; fi
if grep -qx -- '--dangerously-bypass-approvals-and-sandbox' "$E"; then ok "codex still launched on the auto path"; else bad "codex auto path did not launch: $(tr '\n' ' ' < "$E")"; fi

# --- Arm 3 (CONTROL): claude + a model -> `--model <id>`, never -m ------------
# The discriminator: the codex `-m` above is codex-SPECIFIC, not a coincidence
# that any runner would produce. A claude agent on the SAME MODEL uses --model.
SBCL="$(mktemp -d)"; make_sandbox "$SBCL"
run_arm "$SBCL" cl-model "$MODEL_ID" claude
C="$SBCL/new-session.args"
if [ -s "$C" ]; then ok "claude+model: the supervisor reached new-session"; else bad "claude+model: new-session never reached: $(tail -3 "$SBCL/out.log")"; fi
if grep -qx -- '--model' "$C"; then ok "claude uses the --model flag"; else bad "claude did not pass --model: $(tr '\n' ' ' < "$C")"; fi
if grep -qxF "$MODEL_ID" "$C"; then ok "claude passes the exact model id verbatim too"; else bad "the model id did not reach the claude launch: $(tr '\n' ' ' < "$C")"; fi
if grep -qx -- '-m' "$C"; then bad "claude must use --model, not -m (proves the codex -m is arm-specific): $(tr '\n' ' ' < "$C")"; else ok "claude does NOT use -m (so codex's -m is genuinely codex-specific)"; fi
if grep -qx -- '--dangerously-skip-permissions' "$C"; then ok "claude arm launched (its permissions flag is present)"; else bad "claude permissions flag missing (wrong arm?): $(tr '\n' ' ' < "$C")"; fi

if [ "$FAILS" -eq 0 ]; then
  echo "test-supervisor-model-2140: ALL PASS"
else
  echo "test-supervisor-model-2140: $FAILS FAILED"
  exit 1
fi
