#!/usr/bin/env bash
# test-staging-agent-online-check.sh - red-capable, hermetic coverage for the
# #2036/#2129 agent-spawn gate. This gate's whole value is the create -> online ->
# wedge discrimination, so every arm is proven here:
#   - both agents online (idle/working)            -> PASS  (exit 0)   <- positive control
#   - agents wedged at the trust prompt (#2129)    -> FAIL  (exit 1)   <- the red-capable arm
#   - auth_failed / never-online-in-window         -> FAIL  (exit 1)
#   - create refused (400)                          -> FAIL  (exit 1)
#   - populated fleet, no override                  -> REFUSE(exit 2)   <- the safety guard
#   - populated fleet WITH override + online        -> PASS  (exit 0)
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
# (MOCK_ACCOUNTS/MOCK_AGENT_STATE/MOCK_CREATE/MOCK_PREEXISTING) + created-names in MOCK_STATE.
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
  # Per-provider mode: the created agent names carry the provider (verify2129-anthropic-... /
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
        printf '%s\n' "$nm" >> "$STATE"
        # The REAL board returns the result object at TOP LEVEL (server.js sendJson(res,code,result)
        # -> {outcome, name, ...}), NOT nested under a `result` key. Emit that so the gate's
        # top-level `j.name` read path is exercised (its `j.result.name||j.name` fallback stays
        # non-vacuous), matching the /api/status and /api/accounts real-shape fixtures.
        emit "{\"outcome\":\"created\",\"name\":\"$nm\"}" 200
      fi
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
  local want=""
  if [ "${1:-}" = "--expect" ]; then want="$2"; shift 2; fi
  local root state outp rc
  root="$(mktemp -d "${TMPDIR:-/tmp}/aoc-root.XXXXXX")"; printf 'tok\n' > "$root/board.token"
  state="$(mktemp "${TMPDIR:-/tmp}/aoc-state.XXXXXX")"; : > "$state"
  outp="$(env "$@" MOCK_STATE="$state" KOSMOS_AOC_CURL="$FIXDIR/fakeboard" \
    KOSMOS_STORE_ROOT="$root" KOSMOS_PORT=19999 \
    KOSMOS_AGENT_ONLINE_POLL_INT=1 KOSMOS_AGENT_ONLINE_TIMEOUT=4 \
    bash "$CHECK" 2>&1)"
  rc=$?
  if [ -n "$want" ] && ! has "$outp" "$want"; then
    rm -rf "$root" "$state"; bad "$label: expected output to contain '$want' | got: $(printf '%s' "$outp" | tr '\n' '~' | tail -c 300)"; return
  fi
  rm -rf "$root" "$state"
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
run_case "populated fleet, no override -> REFUSE"       2  MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_PREEXISTING=5
run_case "garbage MAX_EXISTING still guards a populated fleet" 2 MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_PREEXISTING=5 KOSMOS_AGENT_ONLINE_MAX_EXISTING=abc
run_case "unreadable /api/status (200, no agent list) -> FAIL CLOSED" 2 --expect "cannot count the fleet" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=status-garbage
run_case "Claude ONLINE, OpenAI WEDGED -> PARTIAL (3, surface not auto-hold)" 3 --expect "PARTIAL" MOCK_ACCOUNTS=both MOCK_AGENT_STATE=claude-ok-openai-wedge
run_case "populated fleet WITH allow-live + online"     0  MOCK_ACCOUNTS=both MOCK_AGENT_STATE=idle MOCK_PREEXISTING=5 KOSMOS_STAGING_VERIFY_ALLOW_LIVE=1
run_case "no openai account -> cannot-tell"             2  MOCK_ACCOUNTS=no-openai MOCK_AGENT_STATE=idle
run_case "Claude present but signed OUT -> cannot-tell"  2  MOCK_ACCOUNTS=claude-signedout MOCK_AGENT_STATE=idle

# no board.token -> cannot-tell (fails before any transport call)
NOTOK="$(mktemp -d "${TMPDIR:-/tmp}/aoc-notok.XXXXXX")"
KOSMOS_STORE_ROOT="$NOTOK" bash "$CHECK" 16180 >/dev/null 2>&1; rc=$?; rm -rf "$NOTOK"
[ "$rc" = 2 ] && pass "no board.token -> cannot-tell (exit 2)" || bad "no board.token: expected 2, got $rc"

rm -rf "$FIXDIR"
if [ "$fail" = 0 ]; then echo "test-staging-agent-online-check: all arms passed"; exit 0; fi
echo "test-staging-agent-online-check: FAILURES above"; exit 1
