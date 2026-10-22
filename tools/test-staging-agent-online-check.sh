#!/usr/bin/env bash
# test-staging-agent-online-check.sh - red-capable, hermetic coverage for the
# #2036/#2129 agent-spawn gate. This gate's whole value is the create -> online ->
# wedge discrimination, so every arm is proven here:
#   - both agents online (idle/working)            -> PASS  (exit 0)   <- positive control
#   - agents wedged at the trust prompt (#2129)    -> FAIL  (exit 1)   <- the red-capable arm
#   - auth_failed / never-online-in-window         -> FAIL  (exit 1)
#   - create refused (400)                          -> FAIL  (exit 1)
#   - a populated board                             -> PASS  (exit 0), its agents removed (kosmos#6906)
#   - online but no answer to the first message     -> CANNOT-TELL (2) (kosmos#6906)
#   - every created agent is removed, pass or fail; a failed removal is said (kosmos#6906)
#   - the CALLER exports the fixture's variables    -> same answers (#5849 control)
#   - a provider not signed in                      -> CANNOT-TELL (2)
#   - no board.token                                -> CANNOT-TELL (2)
#
# The board is faked by a file-backed transport injected through the gate's KOSMOS_AOC_CURL
# seam (no network, no PATH shimming, no listener). The fixture builds canned JSON with
# pure bash/printf - deliberately NO node subprocess - and tracks created agents in a
# per-case state file, exactly as a real board would across the POST -> /api/status calls.
# Hermetic: immune to this host's localhost-TCP flake and to any sandbox that blocks a
# nested subprocess from reaching a sibling listener.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK="$HERE/staging-agent-online-check.sh"
fail=0
pass() { printf 'PASS  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fail=1; }

# --- the file-backed transport fixture (curl-argv in; body to -o, http code to stdout) ---
FIXDIR="$(mktemp -d "${TMPDIR:-/tmp}/aoc-fix.XXXXXX")"
cat > "$FIXDIR/fakeboard" <<'SH'
#!/usr/bin/env bash
# Fake transport for the agent-online gate. Parses curl's argv, writes the body to the
# -o file and prints the HTTP code to stdout. Pure bash - no node. Scenario via env
# (MOCK_ACCOUNTS/MOCK_AGENT_STATE/MOCK_CREATE/MOCK_PREEXISTING/MOCK_REPLY/MOCK_SEND/MOCK_REMOVE) + created-names
# in MOCK_STATE.
out=""; method="GET"; data=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2;;
    -X) method="$2"; shift 2;;
    --data) data="$2"; shift 2;;
    -H) shift 2;;
    -w) shift 2;;
    --max-time) shift 2;;
    http://*|https://*) url="$1"; shift;;
    -*) shift;;
    *) shift;;
  esac
done
route="/${url#*://*/}"
STATE="${MOCK_STATE:-/tmp/aoc-fakecurl.state}"
emit() { [ -n "$out" ] && printf '%s' "$1" > "$out"; printf '%s' "$2"; }
card() {  # <name> -> a status card JSON for the scenario state
  local nm="$1" st state because
  st="${MOCK_AGENT_STATE:-idle}"
  # Per-provider mode: the created agent names carry the provider (verify2129-claude-... /
  # verify2129-openai-...). claude-ok-openai-wedge = Claude online, OpenAI wedged -> exit 3.
  if [ "$st" = claude-ok-openai-wedge ]; then
    case "$nm" in
      *openai*) st=trust-wedge ;;
      *)        st=idle ;;
    esac
  fi
  # Transition modes driven by POLLNUM (the Nth poll after create; the pre-create fleet-count
  # call does not count). These are the RED-CAPABLE tests for the two-consecutive-online guard:
  #  flip-wedge = idle on poll 1 then a trust wedge -> under a 1-poll guard the agent would be
  #    declared online (a #2129 build ships); the 2-consecutive guard catches it (exit 1 WEDGED).
  #  idle-once  = idle on poll 1 then stopped -> reached online once but never 2-in-a-row ->
  #    slow/flapping -> cannot-tell (exit 2), not a hard refuse.
  case "$st" in
    flip-wedge) if [ "${POLLNUM:-1}" -le 1 ]; then st=idle; else st=trust-wedge; fi ;;
    idle-once)  if [ "${POLLNUM:-1}" -le 1 ]; then st=idle; else st=stopped-forever; fi ;;
  esac
  case "$st" in
    working)         state=working;     because="working";;
    trust-wedge)     state=needs_you;   because="it is asking whether to trust its folder, and the default answer exits";;
    trust-wedge-caps) state=needs_you;  because="It Is Asking Whether To TRUST Its FOLDER";;
    auth)            state=auth_failed; because="its Claude sign-in is not working";;
    stopped-forever) state=stopped;     because="Claude is not running for this one";;
    needs-you-other) state=needs_you;   because="it has hit its usage limit";;
    needs-you-firstrun) state=needs_you; because="it is asking whether to turn on bypass permissions mode";;
    rate-limited)    state=rate_limited; because="its account reported a usage limit";;
    *)               state=idle;        because="it is sitting at its prompt";;
  esac
  # The REAL /api/status card is TOP-LEVEL sessionName/state/because (server.js status route),
  # not nested under classify. Emit that so the gate's real read path (c.classify||c -> c) is
  # what's exercised, not the defensive nested-classify fallback.
  printf '{"sessionName":"%s","state":"%s","because":"%s"}' "$nm" "$state" "$because"
}
case "$route" in
  /api/accounts)
    # The REAL /api/accounts shape (server.js): a row is {provider, dir, connection:{state,...}}.
    # connection.state ("connected"/"none"/"unknown") is the cross-provider signal; Claude rows
    # also carry a derived badge (working/signed_in_unverified/signed_out/...). NOT a `connected`
    # boolean, NOT badge:"connected". This fixture emits the real shape so the parser is tested.
    a="${MOCK_ACCOUNTS:-both}"; rows=""; first=1
    # claude-signedout: Claude present but NOT connected (state none / badge signed_out) - the
    # parser must reject it -> MISSING anthropic -> cannot-tell. Proves the connection check.
    if [ "$a" = claude-signedout ]; then
      rows='{"provider":"anthropic","dir":"/x/.claude","connection":{"state":"none","badge":"signed_out"}}'
      rows="$rows,{\"provider\":\"openai\",\"dir\":\"/x/.codex\",\"connection\":{\"state\":\"connected\"}}"
      emit "{\"accounts\":[$rows]}" 200
    else
      if [ "$a" = both ] || [ "$a" = no-openai ]; then
        rows='{"provider":"anthropic","dir":"/x/.claude","connection":{"state":"connected","badge":"working"}}'; first=0
      fi
      if [ "$a" = both ]; then
        [ "$first" = 1 ] || rows="$rows,"
        rows="$rows{\"provider\":\"openai\",\"dir\":\"/x/.codex\",\"connection\":{\"state\":\"connected\"}}"
      fi
      emit "{\"accounts\":[$rows]}" 200
    fi;;
  /api/status)
    # status-garbage: a 200 with NO recognized agent list - the gate must FAIL CLOSED (exit 2),
    # never read it as "0 agents" and let the fleet guard pass.
    if [ "${MOCK_AGENT_STATE:-idle}" = status-garbage ]; then emit '{"unexpected":"shape"}' 200; exit 0; fi
    # kosmos#6906: unreadable once something has been removed (the gate must then keep that agent's files, and say so).
    if [ "${MOCK_STATUS_AFTER_RM:-}" = garbage ] && [ -s "${STATE}.removed" ]; then emit 'not json' 200; exit 0; fi
    # POLLNUM = the Nth /api/status poll AFTER at least one agent was created. The pre-create
    # fleet-count call sees an empty STATE and does not advance it, so poll 1 is the first real
    # poll (transition modes above rely on this).
    POLLNUM=1
    if [ -s "$STATE" ]; then
      _pc="${STATE}.polls"; POLLNUM=$(cat "$_pc" 2>/dev/null || echo 0); POLLNUM=$((POLLNUM+1)); printf '%s' "$POLLNUM" > "$_pc"
    fi
    pre="${MOCK_PREEXISTING:-0}"; parts=""; first=1; i=0
    while [ "$i" -lt "$pre" ]; do
      [ "$first" = 1 ] || parts="$parts,"; first=0
      parts="$parts{\"sessionName\":\"pre-$i\",\"state\":\"idle\",\"because\":\"pre\"}"
      i=$((i+1))
    done
    # noshow: emit NO card for the created agents (a board-shape mismatch / never-spawned
    # agent), so the gate's card never matches and the poll times out with seen=0.
    if [ -f "$STATE" ] && [ "${MOCK_AGENT_STATE:-idle}" != noshow ]; then
      while IFS= read -r nm; do
        [ -z "$nm" ] && continue
        [ "$first" = 1 ] || parts="$parts,"; first=0
        parts="$parts$(card "$nm")"
      done < "$STATE"
    fi
    emit "{\"agents\":[$parts]}" 200;;
  /api/agents)
    if [ "$method" = POST ]; then
      if [ "${MOCK_CREATE:-ok}" = refuse400 ]; then
        emit '{"error":"its sign-in is not working"}' 400
      elif [ "${MOCK_CREATE:-ok}" = refuse400-other ]; then
        emit '{"error":"that is not a name we can read"}' 400
      else
        nm="$(printf '%s' "$data" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')"
        # kosmos#6906: a gate agent must not raise the public agents-created count (the real board pings unless the
        # body says notifyCreated:false). This fake refuses a create without it, so dropping it turns every arm red.
        case "$data" in *'"notifyCreated":false'*) ;; *) emit '{"error":"the gate must send notifyCreated:false"}' 400; exit 0;; esac
        # kosmos#6908: nor take part in the community; the fake refuses a create without community:false.
        case "$data" in *'"community":false'*) ;; *) emit '{"error":"the gate must send community:false"}' 400; exit 0;; esac
        # The REAL board refuses a name over 32 characters (kosmos#6906: the gate's old names were longer).
        if [ "${#nm}" -gt 32 ]; then emit '{"outcome":"refused","because":"keep it to 32 characters or fewer","field":"name"}' 400; exit 0; fi
        printf '%s\n' "$nm" >> "$STATE"
        # kosmos#6906: what the real create writes to disk (in the case's sandbox): a launchd job file and a worker folder.
        if [ -n "${AGENT_WORKFORCE_LAUNCH:-}" ] && [ -n "${AGENT_WORKFORCE_WORKERS:-}" ]; then
          mkdir -p "$AGENT_WORKFORCE_LAUNCH" "$AGENT_WORKFORCE_WORKERS/$nm"; : > "$AGENT_WORKFORCE_LAUNCH/com.kosmos.agent.$nm.plist"
        elif [ "${MOCK_WRITE_HOME:-}" = 1 ]; then
          # kosmos#6922: unsandboxed, the engine's default layout under the case's own throwaway HOME.
          mkdir -p "$HOME/Library/LaunchAgents" "$HOME/work/workers/$nm"; : > "$HOME/Library/LaunchAgents/com.kosmos.agent.$nm.plist"
        fi
        # kosmos#6906: lost = the board made the agent but the answer never arrived (a timeout): no body, code 000.
        if [ "${MOCK_CREATE:-ok}" = lost ]; then printf '000'; exit 0; fi
        # kosmos#6906: othername = the board made the agent but answers with ANOTHER agent's name (one already on it).
        if [ "${MOCK_CREATE:-ok}" = othername ]; then emit '{"outcome":"created","name":"someone-else"}' 200; exit 0; fi
        # The REAL board returns the result object at TOP LEVEL (server.js sendJson(res,code,result)
        # -> {outcome, name, ...}), NOT nested under a `result` key. Emit that so the gate's
        # top-level `j.name` read path is exercised (its `j.result.name||j.name` fallback stays
        # non-vacuous), matching the /api/status and /api/accounts real-shape fixtures.
        emit "{\"outcome\":\"created\",\"name\":\"$nm\"}" 200
      fi
    else emit '{}' 404; fi;;
  /api/agent/*/thread)
    # kosmos#6906: the first message and its answer. The REAL GET shape is {messages:[{at,text,from}]}: the person's own
    # message has from null, the agent's answer has from = its session name. MOCK_REPLY=none (no answer) / other (an
    # answer from a different name) must not count; MOCK_SEND=refuse refuses the message.
    nm="${route#/api/agent/}"; nm="${nm%/thread}"
    if [ "$method" = POST ]; then
      if [ "${MOCK_SEND:-ok}" = refuse ]; then emit '{"error":"we could not send that"}' 500; exit 0; fi
      printf '%s\n' "$nm" >> "${STATE}.sent"
      emit '{"delivery":{"state":"placed"},"recorded":true}' 200
    else
      msgs=""
      if grep -qx "$nm" "${STATE}.sent" 2>/dev/null; then
        now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        msgs="{\"at\":\"$now\",\"text\":\"A release check: reply ready.\",\"from\":null}"
        case "${MOCK_REPLY:-ready}" in
          none) ;;
          other) msgs="$msgs,{\"at\":\"$now\",\"text\":\"ready\",\"from\":\"someone-else\"}" ;;
          # The real thread adds a kind:"question" row FROM the agent while it waits on a prompt: not an answer. Dated, as a
          # REPORTED question's row is (askedAt); an unreported one carries at:null, which the date filter drops anyway.
          question) msgs="$msgs,{\"at\":\"$now\",\"text\":\"Allow this?\",\"from\":\"$nm\",\"kind\":\"question\"}" ;;
          # A row from the agent dated before the message was sent: not an answer to it.
          old) msgs="$msgs,{\"at\":\"2026-01-01T00:00:00Z\",\"text\":\"ready\",\"from\":\"$nm\"}" ;;
          *) msgs="$msgs,{\"at\":\"$now\",\"text\":\"ready\",\"from\":\"$nm\"}" ;;
        esac
      fi
      emit "{\"messages\":[$msgs]}" 200
    fi;;
  /api/agent/*/removal)
    # kosmos#6906: the board's own Remove agent. Takes the agent off the board (out of STATE, so /api/status stops
    # listing it) and records it; MOCK_REMOVE=fail refuses.
    nm="${route#/api/agent/}"; nm="${nm%/removal}"
    if [ "$method" = DELETE ]; then
      if [ "${MOCK_REMOVE:-ok}" = fail ]; then emit '{"error":"we could not remove that"}' 500; exit 0; fi
      # The real route answers 200 for a PARTIAL removal too (the agent may still run): nothing taken off the board.
      if [ "${MOCK_REMOVE:-ok}" = partial ]; then emit '{"outcome":"partial","because":"we could not stop it starting again"}' 200; exit 0; fi
      grep -vx "$nm" "$STATE" > "${STATE}.tmp" 2>/dev/null; mv "${STATE}.tmp" "$STATE"
      printf '%s\n' "$nm" >> "${STATE}.removed"
      emit '{"outcome":"removed"}' 200
    else emit '{}' 404; fi;;
  /api/agent/*/leftover)
    # kosmos#6922: the board's own delete-leftover (#514). GET is the plan, carrying the BOARD's launchd label
    # (MOCK_LABEL_SUFFIX stands for a board under another world, whose label the gate could not derive). DELETE moves the
    # job file and worker folder to the Trash (deleted here, in the case's sandbox) and answers deleted. A stand-in for
    # the real refusal set (a live session, tmux unreadable, a held move), not a model of it: it refuses while the name
    # is still listed. MOCK_LEFTOVER=refuse (files kept) / partial (files kept) / partial-tokens (files gone, tokens
    # stuck) / nothing / notrash (deleted for good) / lost (the first DELETE gets no answer and does nothing) / landed (the
# first DELETE acts, then its answer is lost) / running and nocheck (the real safety refusals) / noroute (an old board);
    # MOCK_LEFTOVER_TYPED=1 refuses unless the body types the name.
    nm="${route#/api/agent/}"; nm="${nm%/leftover}"
    if [ "$method" = GET ] || [ -z "$method" ]; then
      # typeToConfirm is the agent's shown name when the route asks for it (MOCK_SHOWN stands for a display name).
      ttc=null; [ "${MOCK_LEFTOVER_TYPED:-}" = 1 ] && ttc="\"${MOCK_SHOWN:-$nm}\""
      if [ "${MOCK_LEFTOVER:-ok}" = noroute ]; then emit '{}' 404; exit 0; fi
      # MOCK_PLAN=refused: the real plan answers 200 with ok:false for a refusal; fail: the GET itself fails.
      if [ "${MOCK_PLAN:-}" = refused ]; then emit '{"ok":false,"because":"we could not check whether it is running right now"}' 200; exit 0; fi
      if [ "${MOCK_PLAN:-}" = fail ]; then emit '{"error":"boom"}' 500; exit 0; fi
      emit "{\"ok\":true,\"name\":\"$nm\",\"job\":{\"path\":\"/x/com.kosmos.agent.$nm.plist\",\"label\":\"com.kosmos.agent.$nm${MOCK_LABEL_SUFFIX:-}\"},\"toTrash\":true,\"typeToConfirm\":$ttc}" 200
    elif [ "$method" = DELETE ]; then
      printf '%s\n' "$nm" >> "${STATE}.leftover"
      if [ "${MOCK_LEFTOVER:-ok}" = lost ] && [ "$(grep -cx "$nm" "${STATE}.leftover")" = 1 ]; then printf '000'; exit 0; fi
      if [ "${MOCK_LEFTOVER:-ok}" = noroute ]; then emit '{}' 404; exit 0; fi
      # transient: the first DELETE meets a pane still closing (a plan refusal, no steps); the next one clears.
      if [ "${MOCK_LEFTOVER:-ok}" = transient ] && [ "$(grep -cx "$nm" "${STATE}.leftover")" = 1 ]; then
        emit "{\"outcome\":\"refused\",\"because\":\"$nm is running, so there is nothing left over to delete\"}" 400; exit 0
      fi
      if grep -qx "$nm" "$STATE" 2>/dev/null; then emit "{\"outcome\":\"refused\",\"because\":\"$nm is still on the board\"}" 400; exit 0; fi
      if [ "${MOCK_LEFTOVER_TYPED:-}" = 1 ]; then
        case "$data" in *"\"typed\":\"${MOCK_SHOWN:-$nm}\""*) ;; *) emit "{\"outcome\":\"refused\",\"because\":\"type $nm to confirm; nothing was deleted\"}" 400; exit 0;; esac
      fi
      gone() { rm -f "${AGENT_WORKFORCE_LAUNCH:-/nonexistent}/com.kosmos.agent.$nm.plist"; rm -rf "${AGENT_WORKFORCE_WORKERS:-/nonexistent}/$nm"; }
      if [ "${MOCK_LEFTOVER:-ok}" = landed ]; then
        if [ "$(grep -cx "$nm" "${STATE}.leftover")" = 1 ]; then gone; printf '000'; exit 0; fi
        emit "{\"outcome\":\"refused\",\"because\":\"nothing of $nm is left on this computer, so there is nothing to delete.\"}" 400; exit 0
      fi
      case "${MOCK_LEFTOVER:-ok}" in
        running) emit "{\"outcome\":\"refused\",\"because\":\"$nm is running, so there is nothing left over to delete\"}" 400; exit 0;;
        # Refusals from del() AFTER its plan passed carry steps (every move failed; the community standing reset failed).
        movefail) emit '{"outcome":"refused","because":"we could not move its folder or its auto-start file. None of its files were moved.","steps":[{"step":"its community standing","ok":true},{"step":"its folder","ok":false,"because":"EPERM"}]}' 400; exit 0;;
        held409) emit '{"outcome":"refused","because":"an account move is in progress"}' 409; exit 0;;
        nocheck) emit "{\"outcome\":\"refused\",\"because\":\"we could not check whether $nm is running, so nothing was deleted\"}" 400; exit 0;;
        partial) emit '{"outcome":"partial","because":"we could not move its folder. its auto-start file is gone."}' 200; exit 0;;
        partial-tokens) gone; emit '{"outcome":"partial","because":"we could not revoke its sender tokens. its folder and its auto-start file are gone."}' 200; exit 0;;
        # The real board says this only when it finds no files: as if create had written them where the board does not look.
        nothing) gone; emit "{\"outcome\":\"refused\",\"because\":\"nothing of $nm is left on this computer, so there is nothing to delete.\"}" 400; exit 0;;
        notrash) gone; emit "{\"outcome\":\"deleted\",\"toTrash\":false,\"shown\":\"$nm\"}" 200; exit 0;;
      esac
      gone; emit "{\"outcome\":\"deleted\",\"toTrash\":true,\"shown\":\"$nm\"}" 200
    else emit '{}' 404; fi;;
  *) emit '{}' 404;;
esac
SH
chmod +x "$FIXDIR/fakeboard"

has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

# run_case <label> <expected-exit> [--expect "<substr>"] <VAR=val ...>  (trailing VARs = scenario)
# The optional --expect asserts a substring of the OUTPUT, not just the exit code. This matters
# because several distinct behaviours share an exit code (a trust wedge and a non-trust
# not-online both exit 1; a fail-closed refusal and a never-appeared both exit 2), so an
# exit-code-only assertion is NOT red-capable for the specific branch being tested.
run_case() {
  local label="$1" exp="$2"; shift 2
  local want="" kept=""
  if [ "${1:-}" = "--kept" ]; then kept=1; shift; fi
  if [ "${1:-}" = "--expect" ]; then want="$2"; shift 2; fi
  local root state outp rc
  root="$(mktemp -d "${TMPDIR:-/tmp}/aoc-root.XXXXXX")"; printf 'tok\n' > "$root/board.token"
  state="$(mktemp "${TMPDIR:-/tmp}/aoc-state.XXXXXX")"; : > "$state"
  # kosmos#5849: the caller's own values for these are cleared before the case's are applied, or a case inherits an
  # exported scenario and goes red with nothing naming why. The "CALLER exports" case below is the control for this
  # list: the caller exports every name on it.
  outp="$(env -u KOSMOS_HOME -u KOSMOS_AGENT_REPLY_TIMEOUT -u KOSMOS_WORLD \
    -u MOCK_ACCOUNTS -u MOCK_AGENT_STATE -u MOCK_CREATE -u MOCK_PREEXISTING -u MOCK_REPLY -u MOCK_SEND -u MOCK_REMOVE -u MOCK_STATUS_AFTER_RM -u MOCK_LEFTOVER -u MOCK_LEFTOVER_TYPED -u MOCK_LABEL_SUFFIX -u MOCK_SHOWN -u MOCK_WRITE_HOME -u MOCK_PLAN \
    AGENT_WORKFORCE_LAUNCH="$root/LaunchAgents" AGENT_WORKFORCE_WORKERS="$root/workers" AGENT_WORKFORCE_DATA="$root/data" \
    "$@" MOCK_STATE="$state" KOSMOS_AOC_CURL="$FIXDIR/fakeboard" \
    KOSMOS_STORE_ROOT="$root" KOSMOS_PORT=19999 \
    KOSMOS_AGENT_ONLINE_POLL_INT=1 KOSMOS_AGENT_ONLINE_TIMEOUT=4 KOSMOS_AGENT_REPLY_TIMEOUT=3 \
    bash "$CHECK" 2>&1)"
  rc=$?
  # kosmos#6906: every agent the check created is removed, whatever the verdict (a failed removal is said, and
  # exempts the case from this assertion).
  # ... and nothing of theirs on disk: no job file, no worker folder (kosmos#6906: they broke validations on Mortals).
  local files; files="$(ls "$root/LaunchAgents" "$root/workers" 2>/dev/null | grep verify2129 | tr '\n' ' ')"
  # --kept: the files must still be there (the board refused, and a refusal is never overridden): both agents' job file
  # and worker folder, four entries.
  if [ -n "$kept" ] && [ "$(ls "$root/LaunchAgents" "$root/workers" 2>/dev/null | grep -c verify2129)" != 4 ]; then
    rm -rf "$root" "$state"*; bad "$label: the board refused, but the files did not stay: [$files]"; return
  fi
  if [ -n "$files" ] && ! has "$outp" "could not remove" && ! has "$outp" "so its files were left" && ! has "$outp" "could not delete its files here"; then
    rm -rf "$root" "$state"*; bad "$label: files left on disk after the check: $files"; return
  fi
  if [ -s "$state" ] && ! has "$outp" "could not remove"; then
    local left; left="$(tr '\n' ' ' < "$state" 2>/dev/null)"
    rm -rf "$root" "$state"*; bad "$label: agents left on the board after the check: $left"; return
  fi
  if [ -n "$want" ] && ! has "$outp" "$want"; then
    rm -rf "$root" "$state"*; bad "$label: expected output to contain '$want' | got: $(printf '%s' "$outp" | tr '\n' '~' | tail -c 300)"; return
  fi
  rm -rf "$root" "$state"*
  if [ "$rc" = "$exp" ]; then pass "$label -> exit $rc"; else bad "$label: expected exit $exp, got $rc | out: $(printf '%s' "$outp" | head -3 | tr '\n' '~')"; fi
}

run_case "both agents online (positive control)"        0  MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle
run_case "both agents WORKING"                           0  MOCK_ACCOUNTS=both MOCK_AGENT_STATE=working
run_case "trust wedge (#2129) -> do-not-promote"        1 --expect "WEDGED at the trust prompt" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=trust-wedge
run_case "trust wedge, MIXED CASE -> still caught (1)"   1 --expect "WEDGED at the trust prompt" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=trust-wedge-caps
run_case "auth_failed -> do-not-promote"                1  MOCK_ACCOUNTS=both MOCK_AGENT_STATE=auth
run_case "never online within window -> do-not-promote" 1  MOCK_ACCOUNTS=both MOCK_AGENT_STATE=stopped-forever
# idle on poll 1 then a trust wedge: a 1-poll guard would declare it ONLINE (a #2129 build
# ships); the 2-consecutive guard catches it. Asserting exit 1 + WEDGED fails under a 1-poll guard.
run_case "transient idle then WEDGE -> caught by 2-consecutive (1)" 1 --expect "WEDGED at the trust prompt" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=flip-wedge
# idle on poll 1 then stopped: reached online once but never 2-in-a-row -> slow/flapping ->
# cannot-tell (2, forceable), not a hard refuse. Fails under the old always-exit-1 timeout.
run_case "slow/flapping online (idle once) -> cannot-tell (2)" 2  MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle-once
run_case "create refused (400, sign-in) -> do-not-promote" 1 MOCK_ACCOUNTS=both MOCK_CREATE=refuse400
run_case "unexpected create-400 (not sign-in) -> cannot-tell" 2 MOCK_ACCOUNTS=both MOCK_CREATE=refuse400-other
run_case "agent never appears (shape mismatch) -> cannot-tell" 2 MOCK_ACCOUNTS=both MOCK_AGENT_STATE=noshow
# kosmos#6906: a populated board is checked, not refused: its agents are removed after (the assertion in run_case).
run_case "populated board (5 agents) -> checked, PASS, removed (0)" 0 --expect "removed 'verify2129-openai-" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_PREEXISTING=5
run_case "positive control removes the Claude agent too" 0 --expect "removed 'verify2129-claude-" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle
run_case "online but NO answer to the first message -> cannot-tell (2)" 2 --expect "did not answer its first message" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_REPLY=none
run_case "an answer from ANOTHER name does not count -> cannot-tell (2)" 2 --expect "did not answer its first message" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_REPLY=other
run_case "first message refused -> cannot-tell (2)" 2 --expect "could not send" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_SEND=refuse
run_case "a question row FROM the agent is not an answer -> cannot-tell (2)" 2 --expect "did not answer its first message" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_REPLY=question
run_case "an agent row from BEFORE the send is not an answer -> cannot-tell (2)" 2 --expect "did not answer its first message" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_REPLY=old
run_case "a create whose answer is lost is still removed (2)" 2 MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_CREATE=lost
run_case "waiting on a usage limit -> cannot-tell (2), not a refusal" 2 --expect "usage or rate limit" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=needs-you-other
run_case "waiting on ANOTHER first-run question -> do-not-promote (1)" 1 --expect "first-run wedge" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=needs-you-firstrun
run_case "a rate_limited account -> cannot-tell (2), not a refusal" 2 --expect "rate-limited" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=rate-limited
run_case "a PARTIAL removal (200) leaves its files and is said; the verdict stands (0)" 0 --expect "could not remove 'verify2129-claude-" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_REMOVE=partial
run_case "a FAILED arm still removes its agent (trust wedge, 1)" 1 --expect "removed 'verify2129-claude-" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=trust-wedge
run_case "a removal that fails is said, and the verdict stands (0)" 0 --expect "could not remove" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_REMOVE=fail
# kosmos#6922: what removal keeps is cleared by the board's own delete-leftover, not by the gate deleting files itself.
run_case "a removed agent's leftover is cleared by the board (0)" 0 --expect "cleared 'verify2129-claude-" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle
run_case "the clear types the agent's name when the board asks for it (0)" 0 --expect "cleared 'verify2129-openai-" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_LEFTOVER_TYPED=1
run_case "a board saying the agent is RUNNING: its files are left alone and said (0)" 0 --kept --expect "so its files were left" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_LEFTOVER=running
run_case "a board that cannot check whether it runs: its files are left alone (0)" 0 --kept --expect "so its files were left" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_LEFTOVER=nocheck
run_case "any other answer (409) is a refusal: its files are left alone (0)" 0 --kept --expect "so its files were left" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_LEFTOVER=held409
run_case "a refusal carrying steps (every move failed) is an act that failed: deleted here (0)" 0 --expect "were deleted here instead" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_LEFTOVER=movefail
run_case "a plan refusal that passes in a moment (a pane closing) is asked once more and clears (0)" 0 --expect "cleared 'verify2129-claude-" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_LEFTOVER=transient
run_case "a plan that answers ok:false, then a DELETE that clears, is cleared (0)" 0 --expect "cleared 'verify2129-openai-" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_PLAN=refused
run_case "the typed words are the board's (its shown name), not the session name (0)" 0 --expect "cleared 'verify2129-claude-" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_LEFTOVER_TYPED=1 MOCK_SHOWN=Gate-Display
run_case "a board with no leftover route (404): the gate deletes the files itself (0)" 0 --expect "were deleted here instead" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_LEFTOVER=noroute
run_case "a clear that landed but whose answer was lost counts as cleared (0)" 0 --expect "the retry found nothing left" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_LEFTOVER=landed
run_case "a PARTIAL clear (200) is not read as cleared: the files are deleted here (0)" 0 --expect "were deleted here instead" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_LEFTOVER=partial
run_case "a PARTIAL clear with its files gone names what is left, not the files (0)" 0 --expect "Its files are gone" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_LEFTOVER=partial-tokens
run_case "a clear whose first answer is lost is tried again (0)" 0 --expect "cleared 'verify2129-claude-" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_LEFTOVER=lost
run_case "a clear the Trash could not take says deleted, not in the Trash (0)" 0 --expect "are deleted (the Trash could not take them)" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_LEFTOVER=notrash
run_case "a made agent with nothing left on disk is a warning (0)" 0 --expect "finds nothing of it left" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_LEFTOVER=nothing
# kosmos#5849 control: the CALLER exports every fixture variable and a broken home; a case that names no scenario
# still gets the default one, both agents online and answering.
mkdir -p "$FIXDIR/badhome/runtime/bin"; printf '#!/bin/sh\nexit 0\n' > "$FIXDIR/badhome/runtime/bin/node"; chmod +x "$FIXDIR/badhome/runtime/bin/node"
KOSMOS_HOME="$FIXDIR/badhome" MOCK_ACCOUNTS=no-openai MOCK_AGENT_STATE=auth MOCK_CREATE=refuse400 MOCK_PREEXISTING=5 MOCK_REPLY=none MOCK_SEND=refuse MOCK_REMOVE=fail MOCK_LEFTOVER=running MOCK_LEFTOVER_TYPED=1 MOCK_LABEL_SUFFIX=+x KOSMOS_AGENT_REPLY_TIMEOUT=0 \
  run_case "default scenario, the CALLER exports a broken home and every fixture variable -> still both online" 0
run_case "unreadable /api/status (200, no agent list) -> FAIL CLOSED" 2 --expect "cannot count the fleet" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=status-garbage
run_case "Claude ONLINE, OpenAI WEDGED -> PARTIAL (3, surface not auto-hold)" 3 --expect "PARTIAL" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=claude-ok-openai-wedge
run_case "no openai account -> cannot-tell"             2  MOCK_ACCOUNTS=no-openai MOCK_AGENT_STATE=idle
run_case "Claude present but signed OUT -> cannot-tell"  2  MOCK_ACCOUNTS=claude-signedout MOCK_AGENT_STATE=idle

# kosmos#6906: a board answering a create with ANOTHER name: cannot-tell, its own agent removed, the other never touched.
R="$(mktemp -d "${TMPDIR:-/tmp}/aoc-root.XXXXXX")"; printf 'tok\n' > "$R/board.token"; ST="$(mktemp "${TMPDIR:-/tmp}/aoc-state.XXXXXX")"
printf 'someone-else\n' > "$ST"
env -u KOSMOS_HOME -u KOSMOS_WORLD AGENT_WORKFORCE_LAUNCH="$R/LaunchAgents" AGENT_WORKFORCE_WORKERS="$R/workers" AGENT_WORKFORCE_DATA="$R/data" \
  MOCK_STATE="$ST" KOSMOS_AOC_CURL="$FIXDIR/fakeboard" KOSMOS_STORE_ROOT="$R" KOSMOS_PORT=19999 \
  KOSMOS_AGENT_ONLINE_POLL_INT=1 KOSMOS_AGENT_ONLINE_TIMEOUT=4 KOSMOS_AGENT_REPLY_TIMEOUT=3 MOCK_ACCOUNTS=both MOCK_CREATE=othername \
  bash "$CHECK" >/dev/null 2>&1; rc=$?
if [ "$rc" = 2 ] && ! grep -qx someone-else "${ST}.removed" 2>/dev/null && grep -qx someone-else "$ST" \
   && grep -q '^verify2129-claude-' "${ST}.removed" 2>/dev/null && ! grep -q '^verify2129-' "$ST"; then
  pass "a create answered with ANOTHER name -> cannot-tell (2), only its own agent removed"
else bad "create answered with another name: rc=$rc removed=[$(tr '\n' ' ' < "${ST}.removed" 2>/dev/null)] left=[$(tr '\n' ' ' < "$ST")]"; fi
rm -rf "$R" "$ST"*

# kosmos#6906: TERM part way through (polling a created agent): exit 2 and nothing left on the board.
R="$(mktemp -d "${TMPDIR:-/tmp}/aoc-root.XXXXXX")"; printf 'tok\n' > "$R/board.token"; ST="$(mktemp "${TMPDIR:-/tmp}/aoc-state.XXXXXX")"; : > "$ST"
env -u KOSMOS_HOME -u KOSMOS_WORLD AGENT_WORKFORCE_LAUNCH="$R/LaunchAgents" AGENT_WORKFORCE_WORKERS="$R/workers" AGENT_WORKFORCE_DATA="$R/data" \
  MOCK_STATE="$ST" KOSMOS_AOC_CURL="$FIXDIR/fakeboard" KOSMOS_STORE_ROOT="$R" KOSMOS_PORT=19999 \
  KOSMOS_AGENT_ONLINE_POLL_INT=1 KOSMOS_AGENT_ONLINE_TIMEOUT=60 MOCK_ACCOUNTS=both MOCK_AGENT_STATE=stopped-forever \
  bash "$CHECK" >/dev/null 2>&1 &
pid=$!; n=0
while [ ! -s "$ST" ] && [ "$n" -lt 100 ]; do sleep 0.1; n=$((n+1)); done   # until its first agent exists
sleep 1; kill -TERM "$pid" 2>/dev/null; wait "$pid"; rc=$?
if [ "$rc" = 2 ] && [ -s "${ST}.removed" ] && ! grep -q '^verify2129-' "$ST"; then
  pass "TERM part way through -> exit 2, its agent removed"
else bad "TERM part way: rc=$rc removed=[$(tr '\n' ' ' < "${ST}.removed" 2>/dev/null)] left=[$(tr '\n' ' ' < "$ST")]"; fi
rm -rf "$R" "$ST"*

# kosmos#6922: HUP (a dropped ssh) and PIPE part way: exit 2 like TERM, not 129 or 141, and nothing left on the board.
for sig in HUP PIPE; do
  R="$(mktemp -d "${TMPDIR:-/tmp}/aoc-root.XXXXXX")"; printf 'tok\n' > "$R/board.token"; ST="$(mktemp "${TMPDIR:-/tmp}/aoc-state.XXXXXX")"; : > "$ST"
  env -u KOSMOS_HOME -u KOSMOS_WORLD AGENT_WORKFORCE_LAUNCH="$R/LaunchAgents" AGENT_WORKFORCE_WORKERS="$R/workers" AGENT_WORKFORCE_DATA="$R/data" \
    MOCK_STATE="$ST" KOSMOS_AOC_CURL="$FIXDIR/fakeboard" KOSMOS_STORE_ROOT="$R" KOSMOS_PORT=19999 \
    KOSMOS_AGENT_ONLINE_POLL_INT=1 KOSMOS_AGENT_ONLINE_TIMEOUT=60 MOCK_ACCOUNTS=both MOCK_AGENT_STATE=stopped-forever \
    bash "$CHECK" >/dev/null 2>&1 &
  pid=$!; n=0
  while [ ! -s "$ST" ] && [ "$n" -lt 100 ]; do sleep 0.1; n=$((n+1)); done   # until its first agent exists
  sleep 1; kill -"$sig" "$pid" 2>/dev/null; wait "$pid"; rc=$?
  if [ "$rc" = 2 ] && [ -s "${ST}.removed" ] && ! grep -q '^verify2129-' "$ST"; then
    pass "$sig part way through -> exit 2, its agent removed"
  else bad "$sig part way: rc=$rc removed=[$(tr '\n' ' ' < "${ST}.removed" 2>/dev/null)] left=[$(tr '\n' ' ' < "$ST")]"; fi
  rm -rf "$R" "$ST"*
done

# kosmos#6922: after a clear, the gate re-enables the label removal disabled, by the BOARD's label (its leftover plan; the
# fake's carries a world suffix the gate could not derive), once per provider. Run
# UNsandboxed (no AGENT_WORKFORCE_LAUNCH) under a throwaway HOME, with a stub launchctl first on PATH that only records.
# The control is the same run sandboxed: no enable at all.
for arm in live sandboxed noroute noplan; do
  R="$(mktemp -d "${TMPDIR:-/tmp}/aoc-root.XXXXXX")"; printf 'tok\n' > "$R/board.token"; ST="$(mktemp "${TMPDIR:-/tmp}/aoc-state.XXXXXX")"; : > "$ST"
  mkdir -p "$R/stub"; printf '#!/bin/sh\nprintf "%%s\\n" "$*" >> "%s"\n' "$R/launchctl.log" > "$R/stub/launchctl"; chmod +x "$R/stub/launchctl"
  if [ "$arm" = live ]; then sb=(-u AGENT_WORKFORCE_LAUNCH -u AGENT_WORKFORCE_WORKERS -u AGENT_WORKFORCE_DATA)
  # noroute: a board without the leftover route; the gate deletes the files the fake wrote into the real layout under
  # this HOME, and re-enables the label from the job file it checked (no plan to give one).
  # noplan: the plan's GET fails, the DELETE clears: the label comes from this machine's engine for the name.
  elif [ "$arm" = noplan ]; then sb=(-u AGENT_WORKFORCE_LAUNCH -u AGENT_WORKFORCE_WORKERS -u AGENT_WORKFORCE_DATA MOCK_PLAN=fail)
  elif [ "$arm" = noroute ]; then sb=(-u AGENT_WORKFORCE_LAUNCH -u AGENT_WORKFORCE_WORKERS -u AGENT_WORKFORCE_DATA MOCK_LEFTOVER=noroute MOCK_WRITE_HOME=1)
  else sb=(AGENT_WORKFORCE_LAUNCH="$R/LaunchAgents" AGENT_WORKFORCE_WORKERS="$R/workers" AGENT_WORKFORCE_DATA="$R/data"); fi
  out="$(env -u KOSMOS_HOME -u KOSMOS_WORLD "${sb[@]}" HOME="$R/home" PATH="$R/stub:$PATH" \
    MOCK_STATE="$ST" KOSMOS_AOC_CURL="$FIXDIR/fakeboard" KOSMOS_STORE_ROOT="$R" KOSMOS_PORT=19999 \
    KOSMOS_AGENT_ONLINE_POLL_INT=1 KOSMOS_AGENT_ONLINE_TIMEOUT=4 KOSMOS_AGENT_REPLY_TIMEOUT=3 MOCK_ACCOUNTS=both MOCK_LABEL_SUFFIX=+w1 \
    bash "$CHECK" 2>&1)"; rc=$?
  en="$(grep -cE "^enable gui/$(id -u)/com\.kosmos\.agent\.verify2129-(claude|openai)-[0-9-]+\+w1$" "$R/launchctl.log" 2>/dev/null)"
  other="$(grep -vc '^enable gui/' "$R/launchctl.log" 2>/dev/null)"
  if [ "$arm" = live ] && [ "$rc" = 0 ] && [ "${en:-0}" = 2 ] && [ "${other:-0}" = 0 ] && has "$out" "cleared 'verify2129-claude-"; then
    pass "after a clear, both agents' launchd labels are re-enabled, by the board's exact label"
  elif [ "$arm" = sandboxed ] && [ "$rc" = 0 ] && [ ! -s "$R/launchctl.log" ] && has "$out" "cleared 'verify2129-claude-"; then
    pass "control: a sandboxed run clears too and never calls launchctl"
  elif [ "$arm" = noroute ] && [ "$rc" = 0 ] && [ "$(grep -cE "^enable gui/$(id -u)/com\.kosmos\.agent\.verify2129-(claude|openai)-[0-9-]+$" "$R/launchctl.log" 2>/dev/null)" = 2 ] \
       && [ -z "$(ls "$R/home/Library/LaunchAgents" "$R/home/work/workers" 2>/dev/null | grep verify2129)" ] && has "$out" "were deleted here instead"; then
    pass "a board with no leftover route: the gate deletes the files and re-enables each label from its job file"
  elif [ "$arm" = noplan ] && [ "$rc" = 0 ] && [ "$(grep -cE "^enable gui/$(id -u)/com\.kosmos\.agent\.verify2129-(claude|openai)-[0-9-]+$" "$R/launchctl.log" 2>/dev/null)" = 2 ] && has "$out" "cleared 'verify2129-claude-"; then
    pass "no plan from the board, a clear that works: each label is re-enabled from this machine's engine"
  else bad "launchctl $arm: rc=$rc enable=${en:-0} log=[$(tr '\n' '~' < "$R/launchctl.log" 2>/dev/null)] out=$(printf '%s' "$out" | tail -3 | tr '\n' '~')"; fi
  rm -rf "$R" "$ST"*
done

# kosmos#6906: after a 200 removal the board's list cannot be read: the gate must KEEP that agent's files (an unreadable
# list does not confirm it is gone) and say so; the verdict stands. Asserted on the files themselves.
R="$(mktemp -d "${TMPDIR:-/tmp}/aoc-root.XXXXXX")"; printf 'tok\n' > "$R/board.token"; ST="$(mktemp "${TMPDIR:-/tmp}/aoc-state.XXXXXX")"; : > "$ST"
out="$(env -u KOSMOS_HOME -u KOSMOS_WORLD AGENT_WORKFORCE_LAUNCH="$R/LaunchAgents" AGENT_WORKFORCE_WORKERS="$R/workers" AGENT_WORKFORCE_DATA="$R/data" \
  MOCK_STATE="$ST" KOSMOS_AOC_CURL="$FIXDIR/fakeboard" KOSMOS_STORE_ROOT="$R" KOSMOS_PORT=19999 \
  KOSMOS_AGENT_ONLINE_POLL_INT=1 KOSMOS_AGENT_ONLINE_TIMEOUT=4 KOSMOS_AGENT_REPLY_TIMEOUT=3 MOCK_ACCOUNTS=both MOCK_STATUS_AFTER_RM=garbage \
  bash "$CHECK" 2>&1)"; rc=$?
kept="$(ls "$R/LaunchAgents" "$R/workers" 2>/dev/null | grep -c verify2129)"
if [ "$rc" = 0 ] && [ "$kept" -ge 2 ] && has "$out" "so its files were left"; then
  pass "status unreadable after removal -> its files KEPT and said, verdict 0"
else bad "status unreadable after removal: rc=$rc kept=$kept out=$(printf '%s' "$out" | tail -3 | tr '\n' '~')"; fi
rm -rf "$R" "$ST"*

# kosmos#6906: a create whose answer is lost and which the board NEVER lists: its files may sit under a live agent, so
# they are KEPT and the gate says where to check. Asserted on the files. (The fake makes the agent but hides its card.)
R="$(mktemp -d "${TMPDIR:-/tmp}/aoc-root.XXXXXX")"; printf 'tok\n' > "$R/board.token"; ST="$(mktemp "${TMPDIR:-/tmp}/aoc-state.XXXXXX")"; : > "$ST"
out="$(env -u KOSMOS_HOME -u KOSMOS_WORLD AGENT_WORKFORCE_LAUNCH="$R/LaunchAgents" AGENT_WORKFORCE_WORKERS="$R/workers" AGENT_WORKFORCE_DATA="$R/data" \
  MOCK_STATE="$ST" KOSMOS_AOC_CURL="$FIXDIR/fakeboard" KOSMOS_STORE_ROOT="$R" KOSMOS_PORT=19999 KOSMOS_AOC_LOST_TRIES=2 KOSMOS_AOC_LOST_GAP=0 \
  KOSMOS_AGENT_ONLINE_POLL_INT=1 KOSMOS_AGENT_ONLINE_TIMEOUT=4 KOSMOS_AGENT_REPLY_TIMEOUT=3 MOCK_ACCOUNTS=both MOCK_CREATE=lost MOCK_AGENT_STATE=noshow \
  bash "$CHECK" 2>&1)"; rc=$?
kept="$(ls "$R/LaunchAgents" "$R/workers" 2>/dev/null | grep -c verify2129)"
if [ "$rc" = 2 ] && [ "$kept" -ge 2 ] && has "$out" "never listed it"; then
  pass "a lost create the board never lists -> its files KEPT and said (2)"
else bad "lost create never listed: rc=$rc kept=$kept out=$(printf '%s' "$out" | tail -3 | tr '\n' '~')"; fi
rm -rf "$R" "$ST"*

# no board.token -> cannot-tell (fails before any transport call)
NOTOK="$(mktemp -d "${TMPDIR:-/tmp}/aoc-notok.XXXXXX")"
KOSMOS_STORE_ROOT="$NOTOK" bash "$CHECK" 16180 >/dev/null 2>&1; rc=$?; rm -rf "$NOTOK"
[ "$rc" = 2 ] && pass "no board.token -> cannot-tell (exit 2)" || bad "no board.token: expected 2, got $rc"

rm -rf "$FIXDIR"
if [ "$fail" = 0 ]; then echo "test-staging-agent-online-check: all arms passed"; exit 0; fi
echo "test-staging-agent-online-check: FAILURES above"; exit 1
