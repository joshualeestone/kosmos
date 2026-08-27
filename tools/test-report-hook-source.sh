#!/bin/bash
# The #1058 guard, arm by arm: a compaction must not clear a deliberate
# `blocked`, and a genuinely new run must still report `started`.
#
# 🛑 WHY THIS FILE EXISTS. #1058 shipped as 30 lines of shell in
# install/kosmos-report-hook.sh with NO TEST. The behaviour it changes is
# invisible: the failure is a red state QUIETLY DISAPPEARING from the board,
# which is exactly the class of defect nobody notices until an agent has been
# waiting on a person for an hour looking busy.
#
# ⭐ AND THE ALLOWLIST IS THE PART WORTH PINNING. The fix keys on the ONE value
# anybody has observed (`startup`) and treats every other value as a
# continuation. That is deliberate: an unknown future value then degrades
# toward NOT erasing a waiting state. A denylist of guessed values would fail
# the other way and lose the only red the board has. If someone "simplifies"
# this to a denylist, arm 3 goes red.
#
# Driven through KOSMOS_REPORT_CLI, the hook's own seam, with a stub CLI that
# records what it was asked to do. Nothing here touches a real board.
set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

HOOK="install/kosmos-report-hook.sh"
[ -r "$HOOK" ] || { echo "FAIL  $HOOK not found"; exit 1; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

# The stub CLI. Bare `report` must mention needs_you or the hook's own version
# guard refuses before reaching the code under test.
cat > "$T/kosmos" <<'STUB'
#!/bin/bash
if [ "$#" -eq 1 ] && [ "$1" = "report" ]; then
  echo "usage: kosmos report <started|working|idle|needs_you|blocked|stopped>"
  exit 0
fi
printf '%s\n' "$*" >> "${KOSMOS_STUB_LOG:?}"
STUB
chmod +x "$T/kosmos"

# Each case gets a fresh throttle dir and pane key, so one arm cannot suppress
# the next through the hook's once-per-session marker.
fire() { # $1 = payload json ; echoes what the stub was asked to do
  local log="$T/log.$$.$RANDOM"; : > "$log"
  KOSMOS_REPORT_CLI="$T/kosmos" KOSMOS_STUB_LOG="$log" \
  TMPDIR="$T/tmp.$RANDOM" TMUX_PANE="%$RANDOM" \
    bash "$HOOK" <<< "$1" >/dev/null 2>&1
  # the report is fired in a background subshell on purpose (non-blocking),
  # so give it a moment to land rather than racing it.
  sleep 1
  cat "$log" 2>/dev/null
}

got="$(fire '{"hook_event_name":"SessionStart","source":"startup"}')"
case "$got" in
  *"report started"*) ok "source=startup DOES report started -- a new run must clear a stale state" ;;
  *) bad "source=startup did not report started (got: '$got'). A restarted agent would inherit the old run's state" ;;
esac

got="$(fire '{"hook_event_name":"SessionStart","source":"compact"}')"
case "$got" in
  "") ok "source=compact reports NOTHING -- #1058, the deliberate blocked survives" ;;
  *) bad "source=compact still reported '$got'; a compaction erases a waiting state again" ;;
esac

got="$(fire '{"hook_event_name":"SessionStart","source":"resume"}')"
case "$got" in
  "") ok "source=resume reports NOTHING -- a resume is a continuation too" ;;
  *) bad "source=resume reported '$got'" ;;
esac

# 🔑 THE ALLOWLIST ARM. A value nobody has ever seen must be treated as a
# continuation, because the safe direction is to keep a red state, not to
# clear one. This is the arm that catches a denylist rewrite.
got="$(fire '{"hook_event_name":"SessionStart","source":"some-future-value"}')"
case "$got" in
  "") ok "an UNOBSERVED source is treated as a continuation (allowlist, not denylist)" ;;
  *) bad "an unknown source reported '$got' -- this is a denylist now, and the next Claude Code release can silently start erasing blocks" ;;
esac

# ⚠️ BACK-COMPAT. An older Claude Code sends no `source` at all. That must keep
# today's behaviour rather than silently changing what an unknown version does.
got="$(fire '{"hook_event_name":"SessionStart"}')"
case "$got" in
  *"report started"*) ok "NO source field still reports started (older Claude Code, unchanged)" ;;
  *) bad "a payload with no source stopped reporting started (got: '$got')" ;;
esac

# CONTROL: the harness can produce the dangerous answer. Without this arm, a
# stub that never logs anything would make every "reports NOTHING" arm pass.
got="$(fire '{"hook_event_name":"UserPromptSubmit"}')"
case "$got" in
  *"report working"*) ok "CONTROL: the stub DOES record when the hook reports, so silence above means something" ;;
  *) bad "CONTROL FAILED: the harness recorded nothing for UserPromptSubmit either (got: '$got'), so the silence arms prove nothing" ;;
esac

echo "report-hook source: $FAILS failures"
exit $([ "$FAILS" -eq 0 ] && echo 0 || echo 1)
