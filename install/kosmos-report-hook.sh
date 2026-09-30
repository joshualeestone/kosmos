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
#   Stop              -> idle     (never erases a DELIBERATE blocked/needs_you or
#                        an auto blocked; DOES clear a standing auto needs_you, a
#                        permission prompt, once the turn moves on; #900/#1949/#2456)
#   StopFailure       -> blocked --on "provider api (<kind>)" --owner provider
#   SessionEnd        -> stopped
#
# ⚠️ THE TABLE ABOVE IS THE WHOLE TABLE, AND IT USED TO BE SPLIT. StopFailure
# and SessionEnd sat BELOW the prose block that followed, so a sentence reading
# "every line above" was true of five rows and silently false of seven (#1466).
#
# EVERY ONE OF THE SEVEN passes --auto, and that is the point rather than a
# detail: --auto means THE MACHINE WROTE THIS, not the agent (install/kosmos,
# above cmd_report). This hook is the machine. It was once passed on the Stop
# line alone, because it was added for #900's rule rather than for what it
# means, and selfreport.record now PERSISTS that mark (#1453).
#
# The guard fires for `auto === true && (state === 'idle' || 'working' ||
# 'needs_you')` (#900 refused `idle`; #1949 added `working`; #2456 added an auto
# `needs_you` clobber-guard). It refuses those over a standing PROTECTED wait --
# a deliberate blocked/needs_you, a legacy unmarked line, or an auto `blocked` --
# but NOT over a standing auto `needs_you`, which a permission prompt writes and
# which the following auto idle/working is meant to clear. What --auto also
# changes is that the record can now say who wrote a line.
#
# 🛑 THE GUARD REFUSES AN AUTOMATIC `idle`, `working`, OR `needs_you` OVER A
# PROTECTED WAIT, AND NO MORE. `working` was added in #1949 because this hook
# fires it on EVERY PreToolUse, so an allowed automatic `working` erased a
# standing needs_you within seconds; #2456 added `needs_you` so a permission
# prompt cannot CLOBBER a deliberate one. Do NOT widen it to `started`/`stopped`
# (one-time transitions) or to an INCOMING auto `blocked` (a provider outage that
# should surface even over a standing wait): a rule that refused every automatic
# write would strand the agent blocked forever. Two escapes preserve that: an
# AGENT-written report of ANY state still lands (the discriminator is `auto`, not
# the word), and the "protected wait" carve-out means a standing AUTO `needs_you`
# -- the permission prompt itself -- is NOT protected, so the following auto
# idle/working clears it once the turn moves on.
#
# 🛑 AND THE SEVENTH WAS MISSING FOR A DAY, WHICH IS WHY THE COUNT IS WRITTEN
# OUT HERE. The `started` call is inside a COMMAND SUBSTITUTION, because it is
# the synchronous delivery check rather than a fire-and-forget send:
#     STARTED_OUT=$("$KOSMOS" report started --auto 2>&1)
# `report-hook-auto-1453.test.js` matched call sites by the shell separator in
# front of them and a substitution opens with `("`, which was in neither of its
# two patterns -- so BOTH read 6 and AGREED, and the file treated that agreement
# as proof it had found them all. Two patterns sharing one mechanism cannot
# disagree about that mechanism's blind spot (#1466, Renet Tilley).
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
# FAIL-SAFE: a reporting bug must never break an agent. Every path exits 0,
# with ONE deliberate exception (#4671): the kill-all guard below exits 2 on a
# PreToolUse that would stop every process the person owns, which blocks
# that one tool call. It matches only those shapes, and a failure inside it
# falls through to the normal, non-blocking path.
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
  if [ -f "$HERE/../../bin/kosmos" ] && [ -x "$HERE/../../bin/kosmos" ] && [ -f "$HERE/../server.js" ]; then
    printf '%s' "$HERE/../../bin/kosmos"; return
  fi
  # Source layout: the CLI is this script's sibling.
  if [ -f "$HERE/kosmos" ] && [ -x "$HERE/kosmos" ]; then printf '%s' "$HERE/kosmos"; return; fi
  # 🛑 DEPLOYED ELSEWHERE (#1467). Both rungs above are RELATIVE to $HERE, so a
  # copy of this hook placed anywhere else -- which is how a fix was deployed on
  # 2026-08-28 -- resolved to EMPTY and every report returned success while doing
  # nothing, for all 18 agents, silently. A hook is a file other people copy;
  # resolving only from its own home is the wrong assumption for one.
  #
  # These fallbacks are location-INDEPENDENT and deliberately ordered last, so a
  # real installed or source layout still wins and this changes nothing for them.
  # 🛑 THESE TWO RUNGS PROBE FOR THE VERB, THE $HERE RUNGS DO NOT, AND THAT
  # ASYMMETRY IS THE POINT. A $HERE rung found the CLI by its RELATIONSHIP to
  # this file, so it is the right binary by construction. These two are GUESSES
  # at a conventional location, and on this very machine the guess is wrong:
  # ~/.local/bin/kosmos is a bundle from before the verb existed. Returning it
  # SHADOWS a working `kosmos` on PATH and turns reporting off for a session
  # that could have had it. Card #561 asked for exactly this: resolve a binary
  # VERIFIED to speak `report`, never one that merely exists.
  #
  # The probe is the same test the SessionStart guard below uses, for the same
  # reason: a CLI from before the verb answers its generic list, and grepping
  # the word survives exit codes being equal. THEY ARE. Both exit 2, measured.
  #
  # ⚠️ Cost is bounded to the case where we are guessing: a real installed or
  # source layout returns above and never reaches these lines, so no properly
  # deployed machine pays a subprocess on its hot path.
  speaks_report() { [ -f "$1" ] && [ -x "$1" ] || command -v "$1" >/dev/null 2>&1 || return 1
                    "$1" report 2>&1 | grep -q needs_you; }
  if [ -f "$HOME/.local/bin/kosmos" ] && [ -x "$HOME/.local/bin/kosmos" ] && speaks_report "$HOME/.local/bin/kosmos"; then
    printf '%s' "$HOME/.local/bin/kosmos"; return
  fi
  if command -v kosmos >/dev/null 2>&1 && speaks_report kosmos; then printf 'kosmos'; return; fi
  # ⚠️ Still empty rather than a guess. The caller refuses on an empty resolve,
  # which is the honest outcome; inventing a path would fail further from here.
  printf ''
}
KOSMOS="$(resolve_kosmos)"

JQ="$(command -v jq 2>/dev/null || true)"
if [ -z "$JQ" ] && [ -f /opt/homebrew/bin/jq ] && [ -x /opt/homebrew/bin/jq ]; then JQ=/opt/homebrew/bin/jq; fi
# #4671: tests drive the no-jq path on a Mac that has jq (a clean Mac has none).
if [ -n "${KOSMOS_REPORT_HOOK_NO_JQ:-}" ]; then JQ=''; fi

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

# --- #4671: never let an agent stop every process the person owns ------------
# On 2026-09-29 a review subagent on a Kosmos Mac ran a throwaway node script that
# sent SIGKILL to process id minus one, which means every process this user may
# signal. It ended the person's whole login session: every agent, the board, the
# Kosmos app, their open apps. This blocks a tool call (exit 2, the reason on
# stderr) whose command or written code holds one of these LITERAL shapes:
#   - a shell kill whose target is minus one (also quoted, or fed to xargs);
#   - code sending a signal to minus one (node, Python, C, Ruby, Perl, an argv array);
#   - pkill or killall limited only by a user (-u/-U, no name or pattern), or
#     with a match-everything pattern; a pgrep like that in a text that also kills;
#   - pkill/killall of loginwindow or WindowServer (the session, by name);
#   - launchctl bootout of a whole gui/user/login domain, or its reboot verb.
# A redirect or trailing flags after the command do not hide it.
# Allowed: a named pid, SIGHUP to one pid, a group kill, kill 0, pkill/killall by
# name or pattern (also with -u), signal 0 (it sends nothing), bootout of one service.
# 🛑 IT DOES NOT STOP THE 2026-09-29 SCRIPT ITSELF: that one took the minus one
# from a list at run time. No text match can see a computed pid;
# report-hook-killguard-4671.test.js pins that as a known gap.
# 🛑 IT IS A SEATBELT, NOT A SANDBOX. Shell has more ways to say "everything" than
# a text match can list. Known to pass: `ps -U me | xargs kill`, `pkill -f '.+'`,
# `printf '%s' <minus one> | xargs kill`, and any shape not listed above. Known to
# be refused although harmless: `pkill -n -u me`, `killall -s -u me` (a dry run),
# and a mention inside a command (`git commit -m`, `grep`), which the message
# tells the agent to reword.
# Reads: with jq, only what runs or is written (tool_input command, cmd, script,
# code, args, content, new_string, new_source, edits[].new_string), for ANY tool;
# the written content of a .md or .markdown file is not checked (a document is not
# run; a .txt can be run with sh, so it is), but a runnable field always is.
# Without jq, the raw input (wider; a mention or a deleted line can be refused).
# The operator can turn it off for an agent by starting it with
# KOSMOS_KILL_GUARD=off; an agent cannot change its own hook's environment.
# Not guarded at all: Windows agents (the node hook, engine/kosmos-report-hook.js)
# and Codex, Gemini and Grok agents, which have no such hook.
_kg_text() { # what the guard reads
  if [ -n "$JQ" ]; then
    printf '%s' "$INPUT" | "$JQ" -r '
      (.tool_input | objects) as $t
      | (($t.file_path // $t.notebook_path // "") | if type == "string" then test("\\.(md|markdown)$"; "i") else false end) as $doc
      | [ $t.command, $t.cmd, $t.script, $t.code, ($t.args | if type == "array" then map(strings) | join(" ") else . end) ]
        + (if $doc then [] else [ $t.content, $t.new_string, $t.new_source,
                                   ($t.edits | arrays | .[] | objects | .new_string) ] end)
      | map(strings) | join("\n")' 2>/dev/null
  else
    printf '%s' "$INPUT"
  fi
}
_kill_all_reason() { # $1 the text; prints the reason and succeeds when it would stop everything
  local B='(^|[^A-Za-z0-9_.-]|\\[nrt])' SP='([[:space:]]|\\t)+' Q="(\\\\?[\"'])?"
  # E: nothing after the operand but the end of the command. A double quote counts only where a raw JSON
  # string ends (followed by , or }), so `pkill -u "$USER" node` is not read as ending at "$USER".
  local T="([[:space:]]|\$|\\\\[nrt]|[;&|)<>\`\"'\\\\])" E="([[:space:]]|\\\\[rt])*(\$|\\\\[rn]|[;&|)]|[0-9]*[<>]|\"[,}])"
  # FL: any flags before the one that matters (a signal like -TERM or -9 included); the user flag itself is
  # lowercase letters then u/U, so a signal NAME such as -HUP or -USR1 is never read as a user flag.
  local NEG1="${Q}-1${Q}" FL="(-[A-Za-z0-9]+${SP})*" NZ='([^0[:space:]]|0[^[:space:])])'
  # OP: one user or pattern operand, quoted or not, or a $( ... ). Note `(${SP})?`, never `${SP}?`:
  # that expands to `(...)+?`, which POSIX ERE leaves undefined and BSD grep reads as "at least one".
  local OP="${Q}(\\\$\\([^)]*\\)|[^[:space:]\\\;&|)\"'(-][^[:space:]\\\;&|)\"'(]*)${Q}"
  local EF="((${SP})-[A-Za-z0-9]+)*${E}"   # trailing flags only (killall -u me -v still kills everything)
  # A signal option other than 0: signal 0 sends nothing, so `kill -0 -1` is left alone.
  local SIG="(-s${SP}[A-Za-z1-9][A-Za-z0-9]*|-n${SP}[1-9][0-9]*|--|-([A-Za-mo-rt-z1-9][A-Za-z0-9]*|[sn][A-Za-z0-9]+))"
  local shkill="${B}kill${SP}(${SIG}${SP})+([^-[:space:];&|][^[:space:];&|]*${SP})*${NEG1}${T}"
  local xkill="${B}(echo|printf)${SP}(--${SP})?${NEG1}${T}[^;&\\]*xargs[^;&\\]*${B}kill|xargs[^|;]*${B}kill[^|;]*<<<(${SP})?${NEG1}"
  local code="((${B}|(globalThis|global|window|self)\\.)([Pp]rocess|os|syscall|unix|libc|posix)|require\\([^)]*\\))(\\.|::)[Kk]ill(pg)?[[:space:]]*\\([[:space:]]*-[[:space:]]*1[[:space:]]*(\\)|,[[:space:]]*${NZ})|${B}kill[[:space:]]*\\([[:space:]]*-1[[:space:]]*,[[:space:]]*${NZ}|${B}Process\\.kill[[:space:]]*\\([^,()]+,[[:space:]]*-1[[:space:]]*\\)|${B}kill(${SP}|[[:space:]]*\\()[-A-Za-z0-9\"'\\\\]+[[:space:]]*(,|=>)[[:space:]]*-1([^0-9]|\$)"
  local KW="\\\\?[\"']([^\"',]*/)?kill\\\\?[\"']" M1="\\\\?[\"']-1\\\\?[\"']"
  local argv="\\[[[:space:]]*${KW}[[:space:]]*,[^]]*${M1}|${KW}[[:space:]]*,[[:space:]]*\\[[^]]*${M1}"   # an argv, not any object
  local user="${B}(pkill|killall)${SP}${FL}-[a-z]*[uU](${SP})?${OP}${EF}"
  local every="${B}(pkill|killall)${SP}${FL}(-m${SP})?(\\\\?[\"'](\\.(\\*)?|\\^)?\\\\?[\"']|\\.(\\*)?|\\^)${EF}"
  # A pgrep limited only by a user (or matching everything) counts when the same text also holds a kill:
  # the plumbing between them (a loop, a variable, $( ), xargs, backticks) is not modelled on purpose.
  local pgall="${B}pgrep${SP}${FL}(-[a-z]*[uU](${SP})?${OP}|-[a-z]*f${SP}(\\\\?[\"'](\\.(\\*)?|\\^)?\\\\?[\"']|\\.(\\*)?|\\^))((${SP})-[A-Za-z0-9]+)*([[:space:]]|\\\\[rt])*(\$|\\\\[rn]|[;&|)\`]|[0-9]*[<>]|\"[,}])"
  local kword="${B}(kill|xargs${SP}([^|;]*${SP})?kill)(${SP}|\$)"
  # Ending the session by name: the login window and the window server.
  local sess="${B}(pkill|killall)${SP}${FL}${Q}(loginwindow|WindowServer)${Q}${T}"
  local uid="(\\\$\\(id -u[^)]*\\)|\\\$\\{?UID\\}?|[0-9]+)"
  local lctl="${B}launchctl${SP}(reboot|bootout${SP}${Q}(gui|user|login)/${Q}${uid}${Q}${E})"
  local _t="$1"
  if printf '%s' "$_t" | grep -Eq -- "$shkill|$xkill|$code|$argv"; then echo "a signal to process id -1 (every process you own)"
  elif printf '%s' "$_t" | grep -Eq -- "$user|$every"; then echo "a kill that matches every process you own"
  elif printf '%s' "$_t" | grep -Eq -- "$pgall" && printf '%s' "$_t" | grep -Eq -- "$kword"; then echo "a kill fed by a pgrep that matches every process you own"
  elif printf '%s' "$_t" | grep -Eq -- "$sess"; then echo "a kill of the login window or window server (it ends your login session)"
  elif printf '%s' "$_t" | grep -Eq -- "$lctl"; then echo "a launchctl command that ends your whole login session or the computer"
  else return 1; fi
}
if [ "$EVENT" = PreToolUse ] && [ "${KOSMOS_KILL_GUARD:-}" != off ]; then
  _KG_TEXT="$(_kg_text)"
  if [ -n "$_KG_TEXT" ] && _KG_WHY="$(_kill_all_reason "$_KG_TEXT" 2>/dev/null)" && [ -n "$_KG_WHY" ]; then
    printf 'Kosmos blocked this %s call: it contains %s. On this computer that ends the whole session of the person you work for: every agent, the Kosmos board, and their open apps (kosmos#4671). Stop only exact process ids you started yourself and checked. If you are only writing ABOUT such a command, reword it.\n' \
      "$(json_field '.tool_name' 'tool_name')" "$_KG_WHY" >&2
    exit 2
  fi
fi

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
    if [ -z "$KOSMOS" ] || [ ! -f "$KOSMOS" ] || [ ! -x "$KOSMOS" ]; then
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
    STARTED_OUT=$("$KOSMOS" report started --auto 2>&1); STARTED_RC=$?
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
