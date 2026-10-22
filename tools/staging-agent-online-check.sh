#!/usr/bin/env bash
# staging-agent-online-check.sh - kosmos#2036 / #2129, the AGENT-SPAWN half of the
# staging gate.
#
# 🔑 WHY THIS EXISTS. The #2063 board-experience gate (tools/staging-experience-check.sh)
# proves a fresh no-token BROWSER can reach the board after an update - it closes the
# #2023 outage class (a cookieless session 403ing every /api/*). It does NOT exercise
# AGENT SPAWN. #2129 was exactly that gap: Kosmos-spawned agents wedged at the Claude
# Code trust-folder prompt and never came online, while the board itself served fine.
# The board gate would have PASSED a #2129 build. This check closes that gap: on a
# staging build, in a fresh state, it CREATES a Claude agent and an OpenAI agent and
# confirms each comes ONLINE (reachable), never wedged at trust. Promote only if it
# passes. That is the honest fix-forward: staging did not catch #2129 as-built; this
# EXTENDS it so it would.
#
# kosmos#6906: THIS CREATES REAL AGENTS ON THE TARGET BOARD, one per provider, named
# verify2129-<claude|openai>-<time>-<pid> so they never collide with a person's agent, and REMOVES them when it ends
# (DELETE /api/agent/<name>/removal, the board's own Remove agent), then clears what removal keeps with the board's own
# delete-leftover (DELETE /api/agent/<name>/leftover, #514): the job file and worker folder go to the Trash, and the
# Removed list loses its row (#6922, #6915). A removal or clear that fails is said, with what to do by hand. So it runs on a
# populated board too: the boards releases are promoted from are fleet boards, and the old refusal there meant this
# gate never ran at a promote. Each arm must also ANSWER a first message in its own thread (a stored entry `from` its
# session name, after the send): online alone does not show an agent can take a turn.
#
#   bash tools/staging-agent-online-check.sh [port]
#
# Exit codes are CENTERED ON THE CLAUDE ARM (Splinter, 2026-09-04): #2129 fixes the Claude
# spawn wedge definitively; a separate OpenAI/Codex spawn issue may remain and must NOT block
# shipping the Claude fix + the OpenAI-only gating.
# Exit 0 both providers came ONLINE (state idle|working, confirmed on 2 consecutive polls) and answered a first message.
#      1 DO-NOT-PROMOTE (proven bad build, non-forceable): the CLAUDE agent wedged at the trust
#        prompt (#2129) or another first-run question (anything but a usage or rate limit), stayed stopped, hit auth_failed, or its create
#        was refused with a real provider sign-in failure. The #2129 Claude fix is not working.
#      2 cannot-tell (HOLD, forceable after a hand check): no enforcing board (no board.token),
#        a provider not signed in, a board whose agents cannot be counted, a non-numeric port, an
#        unexpected create-400, or an agent that NEVER appeared in /api/status (a shape mismatch
#        / contract drift), or an agent that came online but did not answer its first message in
#        time (slow, rate-limited, or the thread unreadable), or an agent still waiting on a usage or rate limit (or
#        rate_limited) when the online window ends: the account, not the build. Also: the Claude arm is online but the
#        OpenAI arm could not be determined. Stopped by INT, TERM, HUP or PIPE part way (its agents are still removed).
#        The invariant: cannot-tell never reads as a pass.
#      3 PARTIAL - the CLAUDE arm is ONLINE but the OpenAI/Codex arm FAILED to come online. This
#        may be a separate codex-spawn issue #2129 does not fix. The promoter SURFACES which arm
#        failed and routes the decision (forceable); it must NOT auto-hold the whole promote,
#        because the Claude fix + OpenAI gating are net-positive and shippable on their own.
set -uo pipefail

PORT="${1:-${KOSMOS_PORT:-}}"
say() { printf '%s\n' "$*"; }

# --- store.ROOT + board.token, resolved the same way setup.sh / staging-experience-check
# do (bundled node reading engine/store) so it cannot drift. Overridable for the test. ---
ROOT="${KOSMOS_STORE_ROOT:-}"
NODE="${KOSMOS_HOME:-}/runtime/bin/node"
[ -x "$NODE" ] || NODE="$(command -v node 2>/dev/null || true)"
STORE="${KOSMOS_HOME:-}/app/engine/store"
[ -f "$STORE.js" ] || STORE="$(cd "$(dirname "$0")/.." && pwd)/engine/store"
if [ -z "$ROOT" ]; then
  if [ -n "$NODE" ] && [ -x "$NODE" ]; then
    ROOT="$("$NODE" -e 'process.stdout.write(require(process.argv[1]).ROOT)' "$STORE" 2>/dev/null || true)"
  fi
fi
if [ -z "$ROOT" ]; then
  say "cannot resolve store.ROOT (no bundled node / store module) - cannot tell"; exit 2
fi
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  say "no usable node to parse board JSON - cannot tell"; exit 2
fi

TOKEN="$(cat "$ROOT/board.token" 2>/dev/null || true)"
if [ -z "$TOKEN" ]; then
  say "no board.token at $ROOT -> not an enforcing installed board."
  say "  (a from-source / sandbox board cannot test the update experience - #2036's blind spot)"
  exit 2
fi

# --- per-account port: uid 501 -> 16180, else 16180+1+(uid%3999); KOSMOS_PORT/arg win. ---
if [ -z "$PORT" ]; then
  _uid="$(/usr/bin/id -u 2>/dev/null || echo 501)"
  if [ "$_uid" = "501" ]; then PORT=16180; else PORT=$((16180 + 1 + (_uid % 3999))); fi
fi
# A non-numeric PORT (a fat-fingered KOSMOS_PORT/arg) would be interpolated into the curl
# URL and fail obscurely; refuse it as cannot-tell up front (promote validates the positional
# port too, but a direct KOSMOS_PORT env reaches here unchecked).
case "$PORT" in ''|*[!0-9]*) say "port '${PORT}' is not numeric - cannot tell"; exit 2 ;; esac
URL="http://127.0.0.1:${PORT}"

# --- token OFF argv (a mode-600 header file); argv is world-readable via ps (#1970). ---
HF=""; CREATED_NAMES=""; MAYBE_NAMES=""
cleanup() {
  # kosmos#6906: remove every agent this check created, BEFORE the token file goes. A removal
  # that fails is said loudly with the name to remove by hand; it does not change the verdict.
  trap '' INT TERM HUP PIPE   # a signal, a dropped ssh, or a reader that has gone (a promote's tee on Ctrl-C) must not abandon the rest
  local nm todo="$CREATED_NAMES" maybe="$MAYBE_NAMES"
  CREATED_NAMES=""; MAYBE_NAMES=""   # once only: an INT/TERM runs this, then the EXIT trap runs it again
  for nm in $todo; do remove_agent "$nm"; done
  for nm in $maybe; do remove_agent "$nm" if-listed; done
  [ -n "$HF" ] && rm -f "$HF" 2>/dev/null
  [ -n "${_BODYF:-}" ] && rm -f "$_BODYF" 2>/dev/null
}
trap cleanup EXIT
# Stopped part way: its agents are still removed, and the answer is cannot-tell. HUP (a dropped ssh) and PIPE (the reader
# gone) too, or they exit 129 and 141, which an unqueued KOSMOS_PROMOTE_AGENT_GATE_CMD reads as a refusal (#6922).
trap 'cleanup; exit 2' INT TERM HUP PIPE
HF="$(mktemp 2>/dev/null || echo "/tmp/kaoc.$$.hdr")"
: > "$HF"; chmod 600 "$HF" 2>/dev/null
printf 'x-kosmos-board-token: %s\n' "$TOKEN" > "$HF"

# The HTTP transport. Defaults to real curl; a test injects a file-backed fixture via
# KOSMOS_AOC_CURL (a DI seam, like KOSMOS_STORE_ROOT above). It receives curl's exact
# argv and must: write the body to the -o file and print the HTTP code to stdout.
#
# 🛑 These set the GLOBALS HTTP_CODE and RESP_BODY; they do NOT print the body. Callers
# MUST invoke them as a plain statement (`api_get /x`) and then read $HTTP_CODE / $RESP_BODY
# - NEVER as `V="$(api_get /x)"`. A command substitution runs the function in a SUBSHELL,
# so the HTTP_CODE it sets there never reaches the caller and every fetch reads as <none>.
CURL="${KOSMOS_AOC_CURL:-curl}"
HTTP_CODE=""; RESP_BODY=""
_BODYF="$(mktemp 2>/dev/null || echo "/tmp/kaoc.$$.body")"
# A transient transport blip (a busy board, or this host's known localhost-TCP flake)
# must not read as "board unreachable" and abort the whole gate - retry a no-code / 000
# result a few times before believing it. A real down board still fails after the tries.
api_get() {
  local route="$1" tries=0
  while :; do
    : > "$_BODYF"
    HTTP_CODE="$("$CURL" -sS --max-time 20 -H @"$HF" -o "$_BODYF" -w '%{http_code}' "$URL$route" 2>/dev/null || true)"
    case "$HTTP_CODE" in ""|000) ;; *) break ;; esac
    tries=$((tries+1)); [ "$tries" -ge 4 ] && break; sleep 1
  done
  RESP_BODY="$(cat "$_BODYF" 2>/dev/null)"
}
api_post() {
  local route="$1" json="$2"
  # NO retry here (unlike api_get): POST /api/agents is NOT idempotent - a retry after a lost
  # response could create a DUPLICATE agent. A lost/empty POST response leaves HTTP_CODE
  # empty, which the caller reads as non-200 -> cannot-tell (2), the safe direction.
  : > "$_BODYF"
  HTTP_CODE="$("$CURL" -sS --max-time 30 -H @"$HF" -H 'content-type: application/json' \
    -X POST --data "$json" -o "$_BODYF" -w '%{http_code}' "$URL$route" 2>/dev/null || true)"
  RESP_BODY="$(cat "$_BODYF" 2>/dev/null)"
}

# kosmos#6906: "yes" / "no" / "?" for whether the last /api/status read (RESP_BODY) lists session name $1.
listed() {
  printf '%s' "$RESP_BODY" | "$NODE" -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{process.stdout.write("?");return}
      const a=j.agents||j.cards||j.fleet||(Array.isArray(j)?j:null);if(!a){process.stdout.write("?");return}
      process.stdout.write(a.some(c=>(c.sessionName||c.session||c.name||"")===process.argv[1])?"yes":"no")})' "$1"
}
# kosmos#6922: after its removal, clear what is left of one of THIS gate's throwaway agents with the board's own
# delete-leftover (DELETE /api/agent/<name>/leftover, #514): its launchd job file and worker folder go to the Trash, the
# Removed list loses its row, and the name is free. The board's Remove agent deletes nothing (engine/remove.js: removal is
# reversible), and a job file left in ~/Library/LaunchAgents is what a full validation's #3011 guard reads. The name is
# sent as the typed confirmation: the route asks for it only when the Trash cannot take the files, and these are the
# gate's own throwaway agents, which hold nothing. Only a name this gate makes is ever cleared.
# The two paths (job file, worker folder) this machine's engine gives a gate agent, one per line; empty if it cannot say.
# Used only when the board cannot clear it: to delete the files here instead, or to say which to delete by hand.
paths_of() {
  "$NODE" -e 'const c=require(process.argv[1]+"/create");if(typeof c.plistPath!=="function")process.exit(3);process.stdout.write(c.plistPath(process.argv[2])+"\n"+c.workerDir(process.argv[2]))' "$(dirname "$STORE")" "$1" 2>/dev/null
}
# One field of the JSON in $_BODYF ('' if absent or unreadable). job.label is the launchd label, and only for a launchd job.
body_field() {
  "$NODE" -e 'let j;try{j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))||{}}catch{process.exit(0)}
    const f=process.argv[2];let v=f==="label"?(j.job&&!j.job.unit&&!j.job.task?j.job.label:""):f==="steps"?(Array.isArray(j.steps)?"yes":""):j[f];
    if(v===undefined||v===null)process.exit(0);
    // The typed words go back exactly as the board gave them; everything else is for a message, so one line.
    process.stdout.write(f==="typeToConfirm"?String(v):String(v).replace(/\s+/g," ").slice(0,300))' "$_BODYF" "$1" 2>/dev/null
}
# Removal disabled the job's launchd label (that is how it stays off) and a clear does not re-enable it; a gate name is
# never made again, so flip the override back rather than leave it disabled. The label is the BOARD's (its leftover
# plan), never one derived here, so a board under another world or launch folder cannot make this enable a stranger.
# Never in a sandboxed run (AGENT_WORKFORCE_LAUNCH set, as the tests do): `enable` writes launchd's own database.
reenable_label() {
  case "$1" in com.kosmos.agent.verify2129-*) ;; *) return ;; esac
  if [ -z "${AGENT_WORKFORCE_LAUNCH:-}" ] && command -v launchctl >/dev/null 2>&1; then
    launchctl enable "gui/$(id -u)/$1" >/dev/null 2>&1
  fi
}
tidy_agent() {
  local nm="$1" code outcome because toTrash steps body pp plist dir label typed gcode tries=0 waited=""
  case "$nm" in verify2129-claude-*|verify2129-openai-*) ;; *) return ;; esac
  case "${nm#verify2129-*-}" in *[!0-9-]*|'') return ;; esac
  # The board's own plan first, ONE try (this runs in cleanup, where a second Ctrl-C is ignored): the label it will boot
  # out, and the words it wants typed (its display name; the session name when it has none, as gate agents do).
  : > "$_BODYF"
  gcode="$("$CURL" -sS --max-time 20 -H @"$HF" -o "$_BODYF" -w '%{http_code}' "$URL/api/agent/$nm/leftover" 2>/dev/null || true)"
  label=""; typed=""
  if [ "$gcode" = 200 ]; then label="$(body_field label)"; typed="$(body_field typeToConfirm)"; fi
  body="$("$NODE" -e 'process.stdout.write(JSON.stringify({typed:process.argv[1]}))' "${typed:-$nm}")"
  # A transport blip (no code, or 000) is tried once more: a second DELETE after one that DID land finds "nothing of" it,
  # which below counts as cleared. A plan refusal (400, no steps) is asked once more after 3 s: the two that can pass in
  # a moment are "is running" while its pane closes and "could not check ... right now" (review 4). Once each: this runs
  # inside cleanup, where a second Ctrl-C is ignored (review 2).
  while :; do
    : > "$_BODYF"
    code="$("$CURL" -sS --max-time 60 -H @"$HF" -H 'Content-Type: application/json' -X DELETE --data "$body" -o "$_BODYF" -w '%{http_code}' "$URL/api/agent/$nm/leftover" 2>/dev/null || true)"
    case "$code" in
      ""|000) [ "$tries" -ge 1 ] && break; tries=$((tries+1)); sleep 1 ;;
      400) [ -z "$waited" ] && [ -z "$(body_field steps)" ] || break
           case "$(body_field because)" in "nothing of "*) break ;; esac
           waited=1; sleep 3
           # The plan again before the second DELETE: after a refusal the first GET had no label and no typed words,
           # and a board that now cannot Trash the files asks for its shown name (review 6).
           : > "$_BODYF"
           gcode="$("$CURL" -sS --max-time 20 -H @"$HF" -o "$_BODYF" -w '%{http_code}' "$URL/api/agent/$nm/leftover" 2>/dev/null || true)"
           if [ "$gcode" = 200 ]; then
             label="$(body_field label)"; typed="$(body_field typeToConfirm)"
             body="$("$NODE" -e 'process.stdout.write(JSON.stringify({typed:process.argv[1]}))' "${typed:-$nm}")"
           fi ;;
      *) break ;;
    esac
  done
  outcome="$(body_field outcome)"; because="$(body_field because)"; toTrash="$(body_field toTrash)"; steps="$(body_field steps)"
  # No plan (its GET failed, or an old board): the label this machine's engine gives the name, which reenable_label
  # still requires to be a gate agent's.
  if [ -z "$label" ] && [ -z "${AGENT_WORKFORCE_LAUNCH:-}" ]; then pp="$(paths_of "$nm")" && label="$(basename "${pp%%$'\n'*}" .plist)"; fi
  if [ "$code" = 200 ] && [ "$outcome" = deleted ]; then
    reenable_label "$label"
    if [ "$toTrash" = true ]; then say "cleared '$nm': its files are in the Trash, and the name is free."
    else say "cleared '$nm': its files are deleted (the Trash could not take them), and the name is free."; fi
    return
  fi
  local here=""
  case "$because" in
    "nothing of "*)
      # The board finds nothing. If this machine's engine finds the files, the board looks elsewhere (another world or
      # launch folder): they are deleted here, below. Only an empty disk on both sides is cleared (review 5).
      pp="$(paths_of "$nm")" || pp=""; plist="${pp%%$'\n'*}"; dir="${pp#*$'\n'}"
      if [ -n "$pp" ] && { [ -e "$plist" ] || [ -e "$dir" ]; }; then here=1
      elif [ "$tries" -gt 0 ]; then
        # The first DELETE landed and its answer was lost: the retry finds it already cleared.
        reenable_label "$label"
        say "cleared '$nm' (the first answer was lost; the retry found nothing left), and the name is free."
        return
      else
        # The board answered 200 for this one, so it wrote files somewhere: none found means the board looks elsewhere.
        say "WARNING: the board made '$nm' but finds nothing of it left on disk: check ~/Library/LaunchAgents for com.kosmos.agent.$nm*"
        return
      fi ;;
  esac
  local why="DELETE leftover -> HTTP ${code:-<none>}, ${outcome:-no outcome}${because:+: $because}"
  # Only these let the gate delete the files itself (below): no answer, a board without this route (404), an error part
  # way (5xx), a PARTIAL, or a refusal carrying `steps`, which del() gives only once its plan passed and an act failed
  # (every move, or the community standing). A refusal WITHOUT steps is the plan's own judgement, and some are safety
  # ones the gate cannot see (the session still running, tmux unreadable, an account move holding it), so its files
  # are left alone (reviews 2 and 3); so is any other answer (401, 409, a 200 it cannot read).
  local act="$here"
  case "$code" in
    ""|000|404|5[0-9][0-9]) act=1 ;;
    200) [ "$outcome" = partial ] && act=1 ;;
    400) [ -n "$steps" ] && act=1 ;;
  esac
  if [ -z "$act" ]; then
    pp="$(paths_of "$nm" | tr '\n' ' ')"
    if [ "$code" = 200 ]; then
      # Only deleted and partial answer 200, so the board acted, but its answer is not one the gate can read.
      say "WARNING: the board answered 200 for '$nm' but the gate could not read what it did (${outcome:-no outcome}), so its files were left: check ${pp:-its com.kosmos.agent plist and worker folder}, and delete what is still there."
      return
    fi
    say "WARNING: could not clear '$nm' ($why), so its files were left: once it is not running, on its page, Delete what is left, or delete ${pp:-its com.kosmos.agent plist and worker folder} by hand."
    return
  fi
  # No answer, a board without this route (404), an error part way (5xx), or a PARTIAL: the board did not judge the
  # agent unsafe to clear, and the job file must not stay in LaunchAgents (the #3011 guard), so the gate deletes what is
  # still there itself, as before #6922: the paths from this machine's engine, each checked against the name.
  pp="$(paths_of "$nm")" || pp=""
  plist="${pp%%$'\n'*}"; dir="${pp#*$'\n'}"
  local had=""
  if [ -n "$pp" ]; then
    case "${plist##*/}" in "com.kosmos.agent.$nm"*.plist) [ -f "$plist" ] && { had=1; rm -f "$plist"; } ;; esac
    [ "${dir##*/}" = "$nm" ] && [ -d "$dir" ] && { had=1; rm -rf "$dir"; }
  fi
  if [ -z "$pp" ] || [ -e "$plist" ] || [ -e "$dir" ]; then
    say "WARNING: could not clear '$nm' ($why), and could not delete its files here: on its page, Delete what is left, or delete ${plist:-its com.kosmos.agent plist} and ${dir:-its worker folder} by hand."
  elif [ -n "$had" ]; then
    # No plan from the board (an older board, or its GET failed): the job file just checked against the name gives it.
    reenable_label "${label:-$(basename "$plist" .plist)}"
    if [ "$outcome" = partial ]; then say "WARNING: could not clear '$nm' fully ($why), so its job file and worker folder were deleted here instead."
    else say "WARNING: could not clear '$nm' ($why), so its job file and worker folder were deleted here instead. Its row stays in the Removed list."; fi
  elif [ "$outcome" = partial ]; then
    # Nothing on disk: the board got as far as the files and stopped after them (tokens, or the community account).
    reenable_label "$label"
    say "WARNING: could not clear '$nm' fully ($why). Its files are gone; what is left is what that sentence names."
  else
    # No answer, 404 or 5xx, and nothing at this machine's paths: the board's files may be elsewhere (review 5).
    say "WARNING: could not clear '$nm' ($why), and found no files at $plist or $dir: check ~/Library/LaunchAgents for com.kosmos.agent.$nm* and delete it by hand."
  fi
}
# kosmos#6906: remove one agent this check created, and say whether it is gone from /api/status.
remove_agent() {
  local nm="$1" code still
  # if-listed: a create whose answer never came (lost, timed out, interrupted) may or may not have made the agent, so
  # it is removed only when the board lists it. A create that answered 200 is removed whatever the list says.
  if [ "${2:-}" = if-listed ]; then
    local tries=0 seen=""
    # A create whose answer was lost may still be finishing: ask for a minute (KOSMOS_AOC_LOST_TRIES x _GAP, for tests).
    local ltries="${KOSMOS_AOC_LOST_TRIES:-6}" lgap="${KOSMOS_AOC_LOST_GAP:-10}"
    case "$ltries" in ''|*[!0-9]*) ltries=6 ;; esac; case "$lgap" in ''|*[!0-9]*) lgap=10 ;; esac
    while [ "$tries" -lt "$ltries" ]; do
      api_get /api/status
      [ "$HTTP_CODE" = "200" ] && [ "$(listed "$nm")" = "yes" ] && { seen=1; break; }
      tries=$((tries + 1)); [ "$tries" -lt "$ltries" ] && sleep "$lgap"
    done
    # Never seen: it may not exist, or the board may not have listed it yet. Its files are left alone (deleting them under
    # a live agent is worse than leaving them), and said.
    if [ -z "$seen" ]; then
      local pp; pp="$(paths_of "$nm" | tr '\n' ' ')"
      say "WARNING: a create of '$nm' got no answer and the board never listed it; it may still be made. Check for it on the board and at ${pp:-its com.kosmos.agent plist and worker folder}."
      return
    fi
  fi
  : > "$_BODYF"
  code="$("$CURL" -sS --max-time 60 -H @"$HF" -X DELETE -o "$_BODYF" -w '%{http_code}' "$URL/api/agent/$nm/removal" 2>/dev/null || true)"
  local outcome; outcome="$("$NODE" -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).outcome||""))}catch{}' "$_BODYF")"
  if [ "$code" = "200" ] && [ "$outcome" != "removed" ]; then
    # The board answers 200 for a PARTIAL removal too (it could not stop it, or stop it starting again): the agent may
    # still run, so its files are left alone.
    local pp; pp="$(paths_of "$nm" | tr '\n' ' ')"
    say "WARNING: could not remove '$nm' fully (outcome '${outcome:-?}'): it may still run. Remove it on its page under Remove, then delete ${pp:-its com.kosmos.agent plist and worker folder}."
    return
  fi
  if [ "$code" != "200" ]; then
    local pp; pp="$(paths_of "$nm" | tr '\n' ' ')"
    say "WARNING: could not remove '$nm' (DELETE removal -> HTTP ${code:-<none>}): remove it by hand, on its page under Remove, then delete ${pp:-its com.kosmos.agent plist and worker folder}."
    return
  fi
  api_get /api/status
  still="$(listed "$nm")"
  # Files only once the board CONFIRMS it no longer lists the agent: an unreadable list is not a confirmation.
  [ "$still" = "no" ] && tidy_agent "$nm"
  case "$still" in
    no)  say "removed '$nm' (gone from /api/status)." ;;
    yes) say "WARNING: removed '$nm' (HTTP 200) but it is still listed in /api/status: check it on the board." ;;
    *)   local pp; pp="$(paths_of "$nm" | tr '\n' ' ')"
         say "WARNING: removed '$nm' (HTTP 200) but /api/status could not be read to confirm it is gone, so its files were left: delete ${pp:-its com.kosmos.agent plist and worker folder} once it is off the board." ;;
  esac
}

# kosmos#6906: send the agent one message and wait for its answer in its own thread (an entry `from` its session
# name; the person's own message has from null). 0 answered / 2 cannot tell (not sent, or no answer in time).
REPLY_SECS="${KOSMOS_AGENT_REPLY_TIMEOUT:-180}"
case "$REPLY_SECS" in ''|*[!0-9]*) REPLY_SECS=180 ;; esac
first_reply() {
  local prov="$1" sess="$2" body sent_ms got end
  body="$("$NODE" -e 'process.stdout.write(JSON.stringify({text:"A release check (kosmos#6906): reply here with the single word ready, and do nothing else: no posts, no files, no other messages."}))')"
  sent_ms="$("$NODE" -e 'process.stdout.write(String(Date.now()))')"
  api_post "/api/agent/$sess/thread" "$body"
  if [ "$HTTP_CODE" != "200" ]; then
    say "  [$prov] could not send '$sess' its first message (HTTP ${HTTP_CODE:-<none>}) - cannot tell"; return 2
  fi
  say "  [$prov] sent '$sess' its first message - waiting for an answer (up to ${REPLY_SECS}s)..."
  end=$(( $(date +%s) + REPLY_SECS ))   # wall clock: each read can itself take up to its --max-time
  while [ "$(date +%s)" -lt "$end" ]; do
    api_get "/api/agent/$sess/thread"
    if [ "$HTTP_CODE" = "200" ]; then
      # Only a STORED reply counts: a row from the agent with no `kind` (the board adds kind:"question" rows from the
      # agent while it waits on a prompt, engine/chat.js withQuestionRow), dated at or after the send (5 s of slack
      # for second-rounded stamps), so an old row or a question on screen never reads as an answer.
      got="$(printf '%s' "$RESP_BODY" | "$NODE" -e '
        let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return}
          const since=Number(process.argv[2])-5000;
          const m=(Array.isArray(j.messages)?j.messages:[]).filter(x=>x&&x.from===process.argv[1]&&!x.kind&&Date.parse(x.at)>=since);
          if(m.length)process.stdout.write(String(m[m.length-1].text||"").replace(/\s+/g," ").slice(0,80)||"(an empty answer)")})' "$sess" "$sent_ms")"
      if [ -n "$got" ]; then say "  [$prov] '$sess' ANSWERED its first message: '$got'"; return 0; fi
    fi
    sleep "$POLL_INT"
  done
  say "  [$prov] '$sess' came online but did not answer its first message within ${REPLY_SECS}s (slow, rate-limited, or the thread unreadable) - cannot tell"
  return 2
}

# --- confirm the board answers at all ---
api_get /api/accounts; ACCTS="$RESP_BODY"
if [ "$HTTP_CODE" != "200" ]; then
  say "GET /api/accounts -> HTTP ${HTTP_CODE:-<none>} (board not reachable/authorized here) - cannot tell"; exit 2
fi

# --- discover one CONNECTED account dir per provider (node parses the JSON) ---
# Prints "anthropic\t<dir>" and/or "openai\t<dir>" for providers with a live-connected
# account. A provider with no connected account is omitted -> we cannot test it fresh.
# Feed the board body to node via a printf pipe (not an unquoted heredoc): printf never
# interprets its argument, so a hostile field in a build-under-test's response cannot be
# expanded by the shell. Same pattern as the create/status parses below.
PROV_DIRS="$(printf '%s' "$ACCTS" | "$NODE" -e '
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
  let j; try{ j=JSON.parse(s) }catch{ process.exit(0) }
  const rows = Array.isArray(j) ? j : (j.accounts || j.rows || []);
  const seen={};
  for (const r of rows) {
    const prov = r.provider || r.kind || "";
    if (prov!=="anthropic" && prov!=="openai") continue;
    // The real GET /api/accounts connection shape (server.js /api/accounts + subscription.js
    // STATE.CONNECTED="connected"): connection.state is the cross-provider signal
    // ("connected"/"none"/"unknown"); Claude rows also carry a derived badge (observed.js:
    // "working"/"signed_in_unverified" mean live). There is NO `connected` boolean and no
    // badge value "connected". Key on state, accepting the Claude live badges too.
    const conn = r.connection || {};
    const st = String(conn.state || "");
    const badge = String(conn.badge || "");
    const ok = st==="connected" || badge==="working" || badge==="signed_in_unverified";
    if (!ok) continue;
    const dir = r.dir || r.account || r.accountDir || "";
    if (!seen[prov]) { seen[prov]=1; process.stdout.write(prov+"\t"+dir+"\n"); }
  }
})')"

get_dir() { printf '%s\n' "$PROV_DIRS" | awk -F'\t' -v p="$1" '$1==p{print $2; exit}'; }
ANTHROPIC_DIR="$(get_dir anthropic)"
OPENAI_DIR="$(get_dir openai)"

MISSING=""
[ -z "$ANTHROPIC_DIR" ] && MISSING="$MISSING anthropic"
[ -z "$OPENAI_DIR" ] && MISSING="$MISSING openai"
if [ -n "$MISSING" ]; then
  say "no signed-in account for:$MISSING - sign both providers in on the fresh staging machine first."
  say "  (this gate needs a connected Claude AND OpenAI account to create one agent each) - cannot tell"
  exit 2
fi

# --- count the board's agents (fail closed when they cannot be counted) ---
api_get /api/status; STATUS0="$RESP_BODY"
if [ "$HTTP_CODE" != "200" ]; then
  say "GET /api/status -> HTTP ${HTTP_CODE:-<none>} - cannot tell"; exit 2
fi
# Count existing agents. Emit ERR (not 0) when the body does not parse OR carries no
# recognized agent list, so an unreadable /api/status FAILS CLOSED below rather than reading
# as "0 agents" on a board we cannot actually count.
N_EXISTING="$(printf '%s' "$STATUS0" | "$NODE" -e '
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
  let j; try{ j=JSON.parse(s) }catch{ process.stdout.write("ERR"); return }
  let a;
  if (Array.isArray(j)) a=j;
  else if (Array.isArray(j.agents)) a=j.agents;
  else if (Array.isArray(j.cards)) a=j.cards;
  else if (Array.isArray(j.fleet)) a=j.fleet;
  else { process.stdout.write("ERR"); return }
  process.stdout.write(String(a.length));
})')"
# FAIL CLOSED: a 200 we cannot count (contract drift, unparseable) is refused - never spawn test
# agents on a board whose agents we cannot read, since the removal check reads the same list.
case "$N_EXISTING" in
  ''|*[!0-9]*)
    say "GET /api/status returned 200 but no readable agent list (got '${N_EXISTING}') - cannot count the fleet."
    say "  refusing to create test agents on a board we cannot read (fail closed) - cannot tell"; exit 2 ;;
esac
say "this board carries ${N_EXISTING} agent(s); the agents this check creates are removed when it ends."

# --- create one agent per provider and confirm it comes ONLINE ---
STAMP="$(date +%s)"
POLL_SECS="${KOSMOS_AGENT_ONLINE_TIMEOUT:-180}"
POLL_INT="${KOSMOS_AGENT_ONLINE_POLL_INT:-5}"
# Numeric-guard the poll vars (same discipline as PORT). A non-numeric TIMEOUT
# is only safer, but a non-numeric OR ZERO POLL_INT makes `waited=$((waited + POLL_INT))` never
# advance -> the poll loops forever (a hang). Fall back to the defaults on anything invalid.
case "$POLL_SECS" in ''|*[!0-9]*) POLL_SECS=180 ;; esac
case "$POLL_INT"  in ''|0|*[!0-9]*) POLL_INT=5 ;; esac

# create_and_wait <provider> <account-dir> -> echoes verdict, returns 0 online / 1 red / 2 cannot
create_and_wait() {
  local prov="$1" dir="$2" nm body sess
  # kosmos#6906: at most 32 characters. The board refuses a name over 32 ("keep it to 32 characters or fewer"), and the
  # old verify2129-<provider>-<time>-<pid> was longer, so every create here was refused as a 400 and read cannot-tell.
  local short; case "$prov" in anthropic) short=claude ;; *) short="$prov" ;; esac
  nm="verify2129-${short}-${STAMP}-$(( $$ % 1000 ))"   # at most 32, and two runs never share a name
  # notifyCreated:false: a gate agent is not one of the person's, so it must not raise the public agents-created count.
  # community:false (#6908): nor take part in the community (no account to retire, no posts).
  body="$("$NODE" -e 'process.stdout.write(JSON.stringify({name:process.argv[1],provider:process.argv[2],account:process.argv[3],role:"pm",notifyCreated:false,community:false}))' "$nm" "$prov" "$dir")"
  # Registered BEFORE the create as a MAYBE: a lost or interrupted response may still have made it, and cleanup removes
  # a maybe only when the board lists it (only this run makes a name with this STAMP and pid).
  MAYBE_NAMES="$MAYBE_NAMES $nm"
  local resp; api_post /api/agents "$body"; resp="$RESP_BODY"
  # A 400 is the board refusing: nothing was made. A 200 made it: confirmed at once (before anything else can be
  # interrupted), and removed whatever the list says.
  case "$HTTP_CODE" in
    200) CREATED_NAMES="$CREATED_NAMES $nm"; MAYBE_NAMES="${MAYBE_NAMES% $nm}" ;;
    400) MAYBE_NAMES="${MAYBE_NAMES% $nm}" ;;
  esac
  if [ "$HTTP_CODE" = "400" ]; then
    local err400; err400="$(printf '%s' "$resp" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).error||s)}catch{process.stdout.write(s)}})')"
    # A 400 is only a DO-NOT-PROMOTE signal when it names a real provider sign-in failure
    # (#1903/#2128/#2130). Any other 400 is more likely a gate/board contract drift (an
    # unexpected body/role/field) than a broken build, so it is cannot-tell (forceable),
    # never a non-forceable refusal on what may be a bug in this gate.
    # case-insensitive: case is the fleet's most-repeated false-zero, and a mis-cased match
    # here would misroute a real sign-in refusal (1) to cannot-tell (2).
    local err_lc; err_lc="$(printf '%s' "$err400" | tr '[:upper:]' '[:lower:]')"
    case "$err_lc" in
      *sign-in*|*"sign in"*|*signin*)
        say "  [$prov] create REFUSED (HTTP 400): $err400 - a real provider sign-in failure (#2128/#2130 class)"; return 1 ;;
      *)
        say "  [$prov] create got HTTP 400 for an unexpected reason: $err400"
        say "    -> more likely a gate/board contract drift than a broken build - cannot tell"; return 2 ;;
    esac
  fi
  if [ "$HTTP_CODE" != "200" ]; then
    say "  [$prov] create -> HTTP ${HTTP_CODE:-<none>} (not the #2129 class; board/create erroring)"; return 2
  fi
  # session slug the board assigned (fall back to the name we asked for).
  sess="$(printf '%s' "$resp" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return};process.stdout.write((j.result&&j.result.name)||j.name||"")})')"
  [ -z "$sess" ] && sess="$nm"
  # The gate removes only the name it asked for. A board that answers with another name is not trusted with a removal,
  # and what it made cannot be told apart from an agent somebody else has: cannot-tell.
  if [ "$sess" != "$nm" ]; then
    say "  [$prov] the board answered '$sess' for a create of '$nm' - cannot tell (only '$nm' is removed)"; return 2
  fi
  say "  [$prov] created '$sess' - polling for online (up to ${POLL_SECS}s)..."

  # online_streak: require idle|working on TWO CONSECUTIVE polls before calling it online. This
  # guards the one path where a #2129 build could read as PASS - a trust-wedged agent whose card
  # shows a transient idle/working for one poll BEFORE the trust prompt registers as needs_you.
  # A genuinely online agent stays online across a poll interval; a transient-idle-then-wedge
  # shows needs_you on the next poll and is caught. Any non-online read resets the streak.
  local waited=0 st because seen=0 online_streak=0 ever_online=0
  while [ "$waited" -lt "$POLL_SECS" ]; do
    local snap; api_get /api/status; snap="$RESP_BODY"
    # find this session's card; print "state\tbecause"
    local line; line="$(printf '%s' "$snap" | "$NODE" -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        let j;try{j=JSON.parse(s)}catch{return}
        const a=j.agents||j.cards||j.fleet||(Array.isArray(j)?j:[]);
        const want=process.argv[1];
        for(const c of (a||[])){
          const sn=c.sessionName||c.session||c.name||"";
          if(sn===want){ const cl=c.classify||c; process.stdout.write((cl.state||"")+"\t"+(cl.because||"")); return }
        }
      })' "$sess")"
    st="${line%%$'\t'*}"; because="${line#*$'\t'}"
    [ -n "$st" ] && seen=1   # we found this session's card at least once
    case "$st" in
      idle|working)
        online_streak=$((online_streak + 1)); ever_online=1
        if [ "$online_streak" -ge 2 ]; then
          say "  [$prov] ONLINE (state=$st, confirmed on 2 consecutive polls) - the #2129 class is not present."
          first_reply "$prov" "$sess"; return $?
        fi
        say "  [$prov] reads $st - confirming it stays online across a poll (guards a transient idle before a trust wedge)..." ;;
      needs_you)
        online_streak=0
        # case-insensitive trust match (case is the fleet's most-repeated false-zero); a
        # mis-cased "Trust"/"Folder" must still be recognised as the #2129 wedge.
        local because_lc; because_lc="$(printf '%s' "$because" | tr '[:upper:]' '[:lower:]')"
        case "$because_lc" in
          *trust*|*folder*)
            say "  [$prov] WEDGED at the trust prompt (#2129): '$because'"; return 1 ;;
          *)
            say "  [$prov] needs_you (not trust): '$because' - treating as not-online"; ;;
        esac ;;
      auth_failed)
        online_streak=0
        say "  [$prov] auth_failed: '$because' (a sign-in failure, e.g. #2128/#2130 class)"; return 1 ;;
      rate_limited)
        online_streak=0 ;;   # the account's limit, not the build: judged at the end of the window (cannot-tell)
      *)
        online_streak=0 ;;
    esac
    sleep "$POLL_INT"; waited=$((waited + POLL_INT))
  done
  # Distinguish the two timeouts so a shape mismatch is self-diagnosing rather than a
  # silent, un-forceable exit 1: an agent that NEVER appeared in /api/status is far more
  # likely a board-shape mismatch (this gate reads agents[] cards keyed on sessionName
  # with a top-level state field) than a real #2129 wedge. Say which, so an operator can tell a
  # broken gate from a broken build.
  if [ "$seen" = 0 ]; then
    # The card NEVER matched (or matched with no readable state). That is ambiguous between a
    # board-shape mismatch / gate-vs-board contract drift and a build so broken the agent never
    # spawns - NOT a proven #2129 trust wedge (a real wedge appears as a needs_you card). So it
    # is cannot-tell (HOLD, forceable after a hand check), never a non-forceable refusal on what
    # may be a bug in this gate.
    say "  [$prov] created agent '$sess' NEVER appeared in /api/status within ${POLL_SECS}s."
    say "    -> a board-shape mismatch / contract drift, or an agent that never spawned - NOT a proven"
    say "       #2129 wedge (that appears as a needs_you card). This gate expects an agents[] card with"
    say "       sessionName + a top-level state. Cannot tell - verify the shape on the running board."
    return 2
  fi
  # It appeared and reached idle/working at least once, but never on TWO consecutive polls
  # within the window - a slow or flapping come-online, NOT a proven bad build. Treat it as
  # cannot-tell (HOLD, forceable): a genuinely-good-but-slow build must not get a refusal that
  # --force cannot clear. (A longer KOSMOS_AGENT_ONLINE_TIMEOUT gives it more room.)
  if [ "$ever_online" = 1 ]; then
    say "  [$prov] reached ${st:-online} but never on 2 consecutive polls within ${POLL_SECS}s (slow/flapping) - cannot tell (HOLD)."
    return 2
  fi
  # kosmos#6906: still waiting on a question at the end. A usage or rate limit is the account on a working fleet board,
  # not the build: cannot-tell (forceable).
  if [ "$st" = "rate_limited" ]; then
    say "  [$prov] its account is rate-limited at ${POLL_SECS}s: '$because' - the account, not the build: cannot tell (HOLD)."
    return 2
  fi
  # Only a usage or rate limit: any other first-run prompt a build brings in is the #2129 class itself (a refusal).
  if [ "$st" = "needs_you" ]; then
    case "$(printf '%s' "$because" | tr '[:upper:]' '[:lower:]')" in
      *"usage limit"*|*"rate limit"*|*"out of usage"*|*"quota ran out"*)   # the board's own phrasings (engine/status.js)
        say "  [$prov] still waiting on a usage or rate limit at ${POLL_SECS}s: '$because' - the account, not the build: cannot tell (HOLD)."
        return 2 ;;
    esac
    say "  [$prov] still waiting on a question that is not the trust prompt at ${POLL_SECS}s: '$because' - a first-run wedge: do not promote."
    return 1
  fi
  # It appeared but NEVER reached idle/working (stuck 'stopped') - a real not-online, a do-not-promote.
  say "  [$prov] did NOT come online within ${POLL_SECS}s (last state='${st:-<none>}')"; return 1
}

say "staging-agent-online-check: creating one Claude + one OpenAI agent on $URL, confirming each comes online and answers a first message, then removing them."
create_and_wait anthropic "$ANTHROPIC_DIR"; CLAUDE_RC=$?
create_and_wait openai "$OPENAI_DIR"; OPENAI_RC=$?

# Aggregation, CENTERED ON THE CLAUDE ARM (Splinter, 2026-09-04): Angel's #2129 fix
# definitively fixes the CLAUDE spawn wedge; it may NOT fix a separate OpenAI/Codex ("Susan")
# spawn issue, which is chased as its own card and must NOT block shipping the Claude fix +
# the OpenAI-only gating. So a Claude-arm failure hard-refuses, but a Claude-OK / OpenAI-FAIL
# result is a distinct exit 3 that the promoter SURFACES and routes (forceable), never an
# auto-hold. Precedence:
#   CLAUDE_RC 1  -> exit 1  (the Claude fix did not work: proven bad build, non-forceable)
#   CLAUDE_RC 2  -> exit 2  (cannot tell if the Claude fix works: HOLD, forceable)
#   CLAUDE_RC 0:
#     OPENAI_RC 0 -> exit 0 (both online: promote)
#     OPENAI_RC 1 -> exit 3 (Claude ONLINE, OpenAI/Codex FAILED: a possible separate codex
#                            issue #2129 does not fix - SURFACE + route, do not auto-hold)
#     OPENAI_RC 2 -> exit 2 (Claude ONLINE, OpenAI cannot-tell: HOLD, forceable)
if   [ "$CLAUDE_RC" -eq 1 ]; then
  say "FAIL: the CLAUDE agent did not come online (trust wedge / auth / timeout). DO NOT PROMOTE - the #2129 Claude fix is not working in this build."
  exit 1
elif [ "$CLAUDE_RC" -eq 2 ]; then
  say "CANNOT-TELL: could not determine the CLAUDE arm (board/create error, shape mismatch, or no enforcing board). Not a pass; not a proven failure."
  exit 2
else
  case "$OPENAI_RC" in
    0) say "PASS: both a Claude and an OpenAI agent came ONLINE and answered a first message. The #2129 agent-spawn class is not present in this build."; exit 0 ;;
    1) say "PARTIAL: the CLAUDE arm is ONLINE (the #2129 fix works), but the OpenAI/Codex arm FAILED to come online."
       say "  This may be a SEPARATE codex-spawn issue that #2129 does not fix - NOT a reason to auto-hold the whole promote."
       say "  Surface to the operator with WHICH arm failed; the Claude fix + OpenAI gating are shippable. Promote is a routed decision (--force after a ruling)."
       exit 3 ;;
    *) say "CANNOT-TELL: the CLAUDE arm is ONLINE but the OpenAI arm could not be determined (board/create error, shape mismatch). HOLD."
       exit 2 ;;
  esac
fi
