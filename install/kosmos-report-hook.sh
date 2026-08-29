#!/usr/bin/env bash
# The Layer 1 writer for the report interface (#188's third verb, #253's
# vocabulary, verb shipped in #526, productized by #561): Claude Code hooks
# hand this script an event on stdin, and it maps the event to one of the six
# report words so the board reads an agent's state from the agent's own
# record instead of scraping its pane.
#
# The mapping (verified against the hooks docs and this fleet's production
# hooks on 2026-08-24):
#   SessionStart      -> started, but ONLY when `source` is `startup` (#1058):
#                        a compaction or resume must not clear a waiting state
#   UserPromptSubmit  -> working  "answering a prompt"
#   PreToolUse        -> working  "running <tool>"  (throttled heartbeat)
#   PermissionRequest -> needs_you, with the command in the sentence
#                        (fires BEFORE the box renders; the Notification
#                        hook is ~6 seconds late by design and is unused)
#   Stop              -> idle --auto (never erases a standing blocked/needs_you, #900)
#
# EVERY line above passes --auto, and that is the point rather than a detail:
# --auto means THE MACHINE WROTE THIS, not the agent (install/kosmos, above
# cmd_report). This hook is the machine. It used to be passed on the Stop line
# alone, because it was added for #900's rule rather than for what it means, so
# five of these six reports were indistinguishable from an agent typing them,
# and selfreport.record now PERSISTS that mark (#1453).
#
# It changes no behaviour for the other five: #900's guard is scoped to
# `auto === true && state === 'idle'` and refuses nothing else. What it changes
# is that the record can now say who wrote a line.
#
# 🛑 SO IF YOU EVER WIDEN THAT GUARD BEYOND `idle`, THESE FIVE BECOME
# REFUSABLE. The guard's own comment explains why it must stay narrow: a rule
# that refused every automatic write would strand the agent blocked forever.
# report-hook-auto-1453.test.js asserts every `report` line here carries
# --auto, so a seventh cannot quietly reopen the gap.
#   StopFailure       -> blocked --on "provider api (<kind>)" --owner provider
#   SessionEnd        -> stopped
#
# 🔑 THE CLI IS THE ONE THIS SCRIPT SHIPPED WITH, resolved from the script's
# own location, never searched for. The first hand-installed version of this
# script searched PATH-then-fallbacks and found a STALE installed bundle
# whose CLI predates the report verb -- and every report NO-OPPED SILENTLY,
# which is the one outcome #561 forbids: a board with no reports looks
# exactly like a board of idle agents. Shipping the script beside its CLI
# makes version skew structurally impossible; the verify step below is the
# loud guard for every arrangement that breaks the pairing anyway.
#
#   installed  this file is $KOSMOS_HOME/app/bin/kosmos-report-hook.sh
#              (app/ swaps on update, so fixes propagate; the path itself is
#              stable, which is what settings.json needs); the CLI is
#              $KOSMOS_HOME/bin/kosmos.
#   source     this file is <repo>/install/kosmos-report-hook.sh; the CLI
#              is <repo>/install/kosmos, right beside it.
#   override   KOSMOS_REPORT_CLI, for tests.
#
# 🛑 FAIL LOUDLY, ONCE, AT THE RIGHT MOMENT. On SessionStart -- the one
# event whose stdout carries a systemMessage to the person, and the one
# moment that fires exactly once per session -- a CLI that is missing or
# does not speak `report` produces a VISIBLE sentence in the session, not a
# silent exit. Every other event stays quiet on failure because its stdout
# belongs to other machinery (on PermissionRequest it is the DECISION
# channel), and because the SessionStart sentence has already said it.
#
# FAIL-SAFE: a reporting bug must never break an agent. Every path exits 0.
#
# THROTTLE: PreToolUse on a busy agent fires constantly. A per-pane marker
# keeps the working heartbeat to one line per 60s; state CHANGES always
# report immediately and reset the marker.

set -u

SELF="${BASH_SOURCE[0]}"
while [ -L "$SELF" ]; do
  D="$(cd "$(dirname "$SELF")" && pwd)"
  SELF="$(readlink "$SELF")"
  case "$SELF" in /*) ;; *) SELF="$D/$SELF" ;; esac
done
HERE="$(cd "$(dirname "$SELF")" && pwd)"

resolve_kosmos() {
  if [ -n "${KOSMOS_REPORT_CLI:-}" ]; then printf '%s' "$KOSMOS_REPORT_CLI"; return; fi
  # Installed layout: app/bin -> $KOSMOS_HOME two levels up, CLI in bin/.
  if [ -x "$HERE/../../bin/kosmos" ] && [ -f "$HERE/../server.js" ]; then
    printf '%s' "$HERE/../../bin/kosmos"; return
  fi
  # Source layout: the CLI is this script's sibling.
  if [ -x "$HERE/kosmos" ]; then printf '%s' "$HERE/kosmos"; return; fi
  # 🛑 DEPLOYED ELSEWHERE (#1467). Both rungs above are RELATIVE to $HERE, so a
  # copy of this hook placed anywhere else -- which is how a fix was deployed on
  # 2026-08-28 -- resolved to EMPTY and every report returned success while doing
  # nothing, for all 18 agents, silently. A hook is a file other people copy;
  # resolving only from its own home is the wrong assumption for one.
  #
  # These fallbacks are location-INDEPENDENT and deliberately ordered last, so a
  # real installed or source layout still wins and this changes nothing for them.
  if [ -x "$HOME/.local/bin/kosmos" ]; then printf '%s' "$HOME/.local/bin/kosmos"; return; fi
  if command -v kosmos >/dev/null 2>&1; then printf 'kosmos'; return; fi
  # ⚠️ Still empty rather than a guess. The caller refuses on an empty resolve,
  # which is the honest outcome; inventing a path would fail further from here.
  printf ''
}
KOSMOS="$(resolve_kosmos)"

JQ="$(command -v jq 2>/dev/null || true)"
if [ -z "$JQ" ] && [ -x /opt/homebrew/bin/jq ]; then JQ=/opt/homebrew/bin/jq; fi

INPUT=$(cat 2>/dev/null || true)
if [ -n "$JQ" ]; then
  EVENT=$(printf '%s' "$INPUT" | "$JQ" -r '.hook_event_name // empty' 2>/dev/null)
else
  # No jq on this Mac: the event name is still recoverable with sed, and a
  # clean Mac is exactly the machine this install targets. Tool names are
  # nice-to-have and degrade to "a tool" below.
  EVENT=$(printf '%s' "$INPUT" | sed -n 's/.*"hook_event_name"[[:space:]]*:[[:space:]]*"\([A-Za-z]*\)".*/\1/p' | head -1)
fi
[ -n "$EVENT" ] || exit 0

json_field() { # $1 jq path, $2 sed key fallback
  if [ -n "$JQ" ]; then printf '%s' "$INPUT" | "$JQ" -r "$1 // empty" 2>/dev/null
  else printf '%s' "$INPUT" | sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1; fi
}

# --- #1099: what does a compaction actually send as `source`? ------------------
# 🛑 ONE FIELD, AND THE NARROWNESS IS THE WHOLE DESIGN. #1058's guard reports
# `started` only when `source` is `startup`, and nobody has ever observed what a
# compaction or a resume sends. If a compaction sends `startup`, that guard never
# fires and a deliberate `blocked` is erased silently, with the card closed.
#
# ⚠️ THE OBVIOUS VERSION OF THIS IS DANGEROUS AND I PROPOSED IT FIRST. Logging
# the whole payload looks equally simple and is not: line 194 reads
# `.tool_input.command`, so a full-payload log captures EVERY BASH COMMAND EVERY
# AGENT RUNS, fleet-wide, into a new durable file -- paths, credential locations,
# whatever anyone types. Splinter read the hook and caught it; I had checked the
# mechanism and never asked what the payload contained.
# ⇒ This logs the EVENT NAME and the ONE FIELD the card asks about. No command,
# no paths, no arguments. One word per event.
#
# 📌 OFF UNLESS ASKED. No variable, no file, no behaviour change. Set
# KOSMOS_SOURCE_LOG to a path to collect it; unset it and the line is inert.
if [ -n "${KOSMOS_SOURCE_LOG:-}" ]; then
  printf '%s\t%s\t%s\n' "$(date -u +%FT%TZ 2>/dev/null || echo '?')" "$EVENT" \
    "$(json_field '.source' 'source')" >> "$KOSMOS_SOURCE_LOG" 2>/dev/null || true
fi

THROTTLE_DIR="${TMPDIR:-/tmp}/kosmos-report-throttle"
MARK="$THROTTLE_DIR/$(printf '%s' "${TMUX_PANE:-nopane}" | tr -c 'A-Za-z0-9_-' '_')"

# ⚠️ NON-BLOCKING, and the reason is the update window: the CLI's report is
# a curl with a 15-second ceiling, and a board that is down, refusing, or
# mid-update-restart would otherwise hold EVERY unthrottled hook (a person's
# own prompt included) at that ceiling -- an agent that stalls for fifteen
# seconds exactly when the board bounces. The subshell-background pair
# detaches the send so the hook returns immediately; the report either
# lands or it does not, and the SessionStart delivery check below is the
# once-per-session place where "does not" is said OUT LOUD instead of
# swallowed. That check is deliberately the one FOREGROUND send, because it
# needs the verdict.
report() { [ -n "$KOSMOS" ] && ( "$KOSMOS" report "$@" >/dev/null 2>&1 </dev/null & ) 2>/dev/null || true; }

heartbeat_due() {
  mkdir -p "$THROTTLE_DIR" 2>/dev/null || return 0
  if [ -f "$MARK" ]; then
    local now last
    now=$(date +%s); last=$(cat "$MARK" 2>/dev/null || echo 0)
    [ $((now - last)) -ge 60 ] || return 1
  fi
  date +%s > "$MARK" 2>/dev/null || true
  return 0
}

# The loud check. Supported CLIs answer `kosmos report` (no state) with a
# usage line that teaches the six words; a CLI from before the verb answers
# its generic verb list, which never contains needs_you. Grepping the words
# is deliberate: it survives exit codes being equal (they are: both exit 2)
# and never parses a version number.
say_loudly() {
  # SessionStart stdout: a systemMessage the person sees in their session.
  printf '{"systemMessage":"%s"}\n' "$1"
}

case "$EVENT" in
  SessionStart)
    if [ -z "$KOSMOS" ] || [ ! -x "$KOSMOS" ]; then
      say_loudly "Kosmos reporting is OFF for this session: no runnable kosmos CLI was found beside the reporting hook${KOSMOS:+ (looked at $KOSMOS)}. The board is falling back to reading the screen."
      exit 0
    fi
    if ! "$KOSMOS" report 2>&1 | grep -q needs_you; then
      say_loudly "Kosmos reporting is OFF for this session: the kosmos CLI at $KOSMOS does not support the report verb (it is older than Kosmos 0.5.11). The board is falling back to reading the screen. Updating Kosmos fixes this."
      exit 0
    fi
    # The DELIVERY check, the third quiet path and the one the two guards
    # above cannot see: a CLI that exists and speaks `report` can still fail
    # to land the line -- the board is down, or the server cannot tie this
    # pane to an agent -- and everywhere else this script swallows that on
    # purpose. Here, once per session, the `started` report is fired FOR
    # REAL and its verdict is checked; a failure surfaces the CLI's own
    # sentence, so the person reads the actual reason (not running / could
    # not match) rather than a genericised one. Passing this check proves
    # the whole chain: script, CLI, server, identity, record.
    rm -f "$MARK" 2>/dev/null || true
      # 🛑 #1058: SessionStart FIRES ON COMPACTION AND RESUME, not only on a new
      # run, and `started` clears a deliberate `blocked` or `needs_you`. So an
      # agent that told the board it was waiting on a person lost that the
      # moment its session compacted, which every long-running agent does.
      # Measured on a live agent's own record: blocked -> SessionStart -> started.
      #
      # 🔑 ONLY `startup` IS A NEW RUN, and this is an ALLOWLIST on purpose.
      # OBSERVED rather than guessed: a real payload captured from claude
      # 2.1.247 in an isolated config carries
      #   {"hook_event_name":"SessionStart","source":"startup",...}
      # I have seen `startup`. I have NOT seen what a compaction or a resume
      # sends, so keying on the value I observed and treating everything else as
      # a continuation makes an unknown future value degrade toward NOT erasing
      # a waiting state. A denylist of guessed values would fail the other way,
      # which is the direction that loses the only red on the board.
      #
      # ⚠️ NO `source` AT ALL means an older Claude Code that never sent one.
      # That still reports `started`, exactly today's behaviour, rather than
      # silently changing what an unknown version does.
      #
      # ⚠️ THE TWO GUARDS ABOVE STILL RAN. They only READ, so a continuation is
      # still told loudly when the CLI is missing or too old. What is skipped is
      # the WRITE, and the delivery check it doubles as, which already ran when
      # this conversation actually started.
      SRC=$(json_field '.source' 'source')
      if [ -n "$SRC" ] && [ "$SRC" != "startup" ]; then
        exit 0
      fi
    STARTED_OUT=$("$KOSMOS" report started 2>&1); STARTED_RC=$?
    if [ "$STARTED_RC" -ne 0 ]; then
      REASON=$(printf '%s' "$STARTED_OUT" | tr '\n\t\r' '   ' | tr -s ' ' | sed 's/^ *//; s/\\/\\\\/g; s/"/\\"/g' | head -c 300)
      say_loudly "Kosmos reporting is OFF for this session: the report could not be recorded. ${REASON:-The CLI did not say why.} The board is falling back to reading the screen."
    fi ;;
  UserPromptSubmit)
    date +%s > "$MARK" 2>/dev/null || true
    report working --auto answering a prompt ;;
  PreToolUse)
    if heartbeat_due; then
      TOOL=$(json_field '.tool_name' 'tool_name'); TOOL="${TOOL:-a tool}"
      report working --auto "running ${TOOL}"
    fi ;;
  PermissionRequest)
    # The sentence carries what is being asked about. The words stay on this
    # Mac (the record); notify.js strips them from anything that leaves.
    TOOL=$(json_field '.tool_name' 'tool_name'); TOOL="${TOOL:-a tool}"
    CMD=$(json_field '.tool_input.command' 'command' | head -c 200)
    rm -f "$MARK" 2>/dev/null || true
    report needs_you --auto "asking permission to use ${TOOL}${CMD:+: $CMD}" ;;
  Stop)
    rm -f "$MARK" 2>/dev/null || true
    # #900: --auto, so this end-of-turn idle cannot erase a `blocked` or
    # `needs_you` the agent filed DURING the turn. Stop fires at the end of
    # every turn, so without this an agent waiting on a person read as idle
    # within seconds of saying so.
    report idle --auto finished responding ;;
  StopFailure)
    KIND=$(json_field '.matcher // .error_type' 'matcher'); KIND="${KIND:-an api error}"
    rm -f "$MARK" 2>/dev/null || true
    report blocked --auto --on "provider api (${KIND})" --owner provider ;;
  SessionEnd)
    rm -f "$MARK" 2>/dev/null || true
    report stopped --auto ;;
esac
exit 0
