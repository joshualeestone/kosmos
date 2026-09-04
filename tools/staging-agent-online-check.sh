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
# 🛑 THIS CREATES REAL AGENTS ON THE TARGET BOARD. That is safe on the INTENDED target -
# a FRESH staging machine where no fleet exists - and dangerous on a populated fleet box
# (it would spawn real sessions among live agents). So it REFUSES on a board that already
# carries more than KOSMOS_AGENT_ONLINE_MAX_EXISTING agents unless
# KOSMOS_STAGING_VERIFY_ALLOW_LIVE=1 is set. There is no clean HTTP delete-agent route
# (agents are launchd/tmux sessions), so cleanup is best-effort; on the throwaway fresh
# machine that is fine.
#
#   bash tools/staging-agent-online-check.sh [port]
#
# Exit codes are CENTERED ON THE CLAUDE ARM (Splinter, 2026-09-04): #2129 fixes the Claude
# spawn wedge definitively; a separate OpenAI/Codex spawn issue may remain and must NOT block
# shipping the Claude fix + the OpenAI-only gating.
# Exit 0 both providers came ONLINE (state idle|working, confirmed on 2 consecutive polls).
#      1 DO-NOT-PROMOTE (proven bad build, non-forceable): the CLAUDE agent wedged at the trust
#        prompt (#2129), appeared but never reached idle|working, hit auth_failed, or its create
#        was refused with a real provider sign-in failure. The #2129 Claude fix is not working.
#      2 cannot-tell (HOLD, forceable after a hand check): no enforcing board (no board.token),
#        a provider not signed in, a populated/uncountable fleet board, a non-numeric port, an
#        unexpected create-400, or an agent that NEVER appeared in /api/status (a shape mismatch
#        / contract drift). Also: the Claude arm is online but the OpenAI arm could not be
#        determined. The invariant: cannot-tell never reads as a pass.
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
HF=""; CREATED_NAMES=""
cleanup() {
  [ -n "$HF" ] && rm -f "$HF" 2>/dev/null
  [ -n "${_BODYF:-}" ] && rm -f "$_BODYF" 2>/dev/null
  # best-effort: leave a breadcrumb of what we created so a fresh machine can be tidied.
  if [ -n "$CREATED_NAMES" ]; then
    say "note: this check created agent(s):$CREATED_NAMES (no HTTP delete route; tidy on the throwaway staging machine if needed)"
  fi
}
trap cleanup EXIT INT TERM
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

# --- SAFETY: refuse on a populated fleet board unless explicitly allowed ---
api_get /api/status; STATUS0="$RESP_BODY"
if [ "$HTTP_CODE" != "200" ]; then
  say "GET /api/status -> HTTP ${HTTP_CODE:-<none>} - cannot tell"; exit 2
fi
# Count existing agents. Emit ERR (not 0) when the body does not parse OR carries no
# recognized agent list, so an unreadable /api/status FAILS CLOSED below rather than reading
# as "0 agents" and letting the fleet guard pass on a board we cannot actually count.
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
# FAIL CLOSED: a 200 we cannot count (contract drift, unparseable) must not let the fleet
# guard pass - refusing here is the safe direction (never spawn test agents on a board whose
# population we cannot read). This also numeric-validates N_EXISTING before the -gt below.
case "$N_EXISTING" in
  ''|*[!0-9]*)
    say "GET /api/status returned 200 but no readable agent list (got '${N_EXISTING}') - cannot count the fleet."
    say "  refusing to create test agents on a board we cannot read (fail closed) - cannot tell"; exit 2 ;;
esac
MAX_EXISTING="${KOSMOS_AGENT_ONLINE_MAX_EXISTING:-2}"
# 🛑 This guard is the ONE thing stopping test-agent spawn on a populated fleet, so its
# threshold must never be garbage: a non-numeric MAX would make the `-gt` test below error,
# the `&&` short-circuit, and the guard silently NOT fire - spawning agents among live
# sessions. Fall back to the safe default on anything non-numeric rather than disabling.
case "$MAX_EXISTING" in ''|*[!0-9]*) say "KOSMOS_AGENT_ONLINE_MAX_EXISTING='${MAX_EXISTING}' is not numeric - using the safe default 2"; MAX_EXISTING=2 ;; esac
if [ "$N_EXISTING" -gt "$MAX_EXISTING" ] && [ "${KOSMOS_STAGING_VERIFY_ALLOW_LIVE:-}" != "1" ]; then
  say "this board already carries ${N_EXISTING} agents (> ${MAX_EXISTING}) - looks like a populated FLEET, not a fresh staging machine."
  say "  refusing to create test agents here. Set KOSMOS_STAGING_VERIFY_ALLOW_LIVE=1 only if you are certain this is a throwaway board - cannot tell"
  exit 2
fi

# --- create one agent per provider and confirm it comes ONLINE ---
STAMP="$(date +%s)"
POLL_SECS="${KOSMOS_AGENT_ONLINE_TIMEOUT:-180}"
POLL_INT="${KOSMOS_AGENT_ONLINE_POLL_INT:-5}"
# Numeric-guard the poll vars (same discipline as PORT / MAX_EXISTING). A non-numeric TIMEOUT
# is only safer, but a non-numeric OR ZERO POLL_INT makes `waited=$((waited + POLL_INT))` never
# advance -> the poll loops forever (a hang). Fall back to the defaults on anything invalid.
case "$POLL_SECS" in ''|*[!0-9]*) POLL_SECS=180 ;; esac
case "$POLL_INT"  in ''|0|*[!0-9]*) POLL_INT=5 ;; esac

# create_and_wait <provider> <account-dir> -> echoes verdict, returns 0 online / 1 red / 2 cannot
create_and_wait() {
  local prov="$1" dir="$2" nm body sess
  nm="verify2129-${prov}-${STAMP}-$$"
  body="$("$NODE" -e 'process.stdout.write(JSON.stringify({name:process.argv[1],provider:process.argv[2],account:process.argv[3],role:"pm"}))' "$nm" "$prov" "$dir")"
  local resp; api_post /api/agents "$body"; resp="$RESP_BODY"
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
  CREATED_NAMES="$CREATED_NAMES $sess"
  say "  [$prov] created '$sess' - polling for online (up to ${POLL_SECS}s)..."

  # online_streak: require idle|working on TWO CONSECUTIVE polls before calling it online. This
  # guards the one path where a #2129 build could read as PASS - a trust-wedged agent whose card
  # shows a transient idle/working for one poll BEFORE the trust prompt registers as needs_you.
  # A genuinely online agent stays online across a poll interval; a transient-idle-then-wedge
  # shows needs_you on the next poll and is caught. Any non-online read resets the streak.
  local waited=0 st because seen=0 online_streak=0
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
        online_streak=$((online_streak + 1))
        if [ "$online_streak" -ge 2 ]; then
          say "  [$prov] ONLINE (state=$st, confirmed on 2 consecutive polls) - the #2129 class is not present."; return 0
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
  # It DID appear but never reached idle/working (e.g. stuck 'stopped', or a needs_you that was
  # not a trust wedge) - that is a real not-online, a do-not-promote.
  say "  [$prov] did NOT come online within ${POLL_SECS}s (last state='${st:-<none>}')"; return 1
}

say "staging-agent-online-check: creating one Claude + one OpenAI agent on $URL and confirming each comes online."
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
    0) say "PASS: both a Claude and an OpenAI agent came ONLINE. The #2129 agent-spawn class is not present in this build."; exit 0 ;;
    1) say "PARTIAL: the CLAUDE arm is ONLINE (the #2129 fix works), but the OpenAI/Codex arm FAILED to come online."
       say "  This may be a SEPARATE codex-spawn issue that #2129 does not fix - NOT a reason to auto-hold the whole promote."
       say "  Surface to the operator with WHICH arm failed; the Claude fix + OpenAI gating are shippable. Promote is a routed decision (--force after a ruling)."
       exit 3 ;;
    *) say "CANNOT-TELL: the CLAUDE arm is ONLINE but the OpenAI arm could not be determined (board/create error, shape mismatch). HOLD."
       exit 2 ;;
  esac
fi
