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
# Exit 0 both providers came ONLINE (state idle|working) - the #2129 class is not present.
#      1 a created agent WEDGED at the trust prompt (#2129), never came online in the
#        window, or a create was REFUSED for the Claude-reachability class (#2128/#2130).
#        This is the DO-NOT-PROMOTE signal.
#      2 cannot-tell: no enforcing board (no board.token), a provider has no signed-in
#        account here, or this looks like a populated fleet board (refused to run).
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
  local route="$1" json="$2" tries=0
  while :; do
    : > "$_BODYF"
    HTTP_CODE="$("$CURL" -sS --max-time 30 -H @"$HF" -H 'content-type: application/json' \
      -X POST --data "$json" -o "$_BODYF" -w '%{http_code}' "$URL$route" 2>/dev/null || true)"
    case "$HTTP_CODE" in ""|000) ;; *) break ;; esac
    tries=$((tries+1)); [ "$tries" -ge 4 ] && break; sleep 1
  done
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
PROV_DIRS="$("$NODE" -e '
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
  let j; try{ j=JSON.parse(s) }catch{ process.exit(0) }
  const rows = Array.isArray(j) ? j : (j.accounts || j.rows || []);
  const seen={};
  for (const r of rows) {
    const prov = r.provider || r.kind || "";
    if (prov!=="anthropic" && prov!=="openai") continue;
    const conn = r.connection || {};
    const ok = conn.connected===true || conn.badge==="connected" || r.connected===true;
    if (!ok) continue;
    const dir = r.dir || r.account || r.accountDir || "";
    if (!seen[prov]) { seen[prov]=1; process.stdout.write(prov+"\t"+dir+"\n"); }
  }
})' <<EOF
$ACCTS
EOF
)"

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
N_EXISTING="$("$NODE" -e '
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
  let j; try{ j=JSON.parse(s) }catch{ process.stdout.write("0"); return }
  const a = j.agents || j.cards || j.fleet || (Array.isArray(j)?j:[]);
  process.stdout.write(String(Array.isArray(a)?a.length:0));
})' <<EOF
$STATUS0
EOF
)"
MAX_EXISTING="${KOSMOS_AGENT_ONLINE_MAX_EXISTING:-2}"
if [ "${N_EXISTING:-0}" -gt "$MAX_EXISTING" ] && [ "${KOSMOS_STAGING_VERIFY_ALLOW_LIVE:-}" != "1" ]; then
  say "this board already carries ${N_EXISTING} agents (> ${MAX_EXISTING}) - looks like a populated FLEET, not a fresh staging machine."
  say "  refusing to create test agents here. Set KOSMOS_STAGING_VERIFY_ALLOW_LIVE=1 only if you are certain this is a throwaway board - cannot tell"
  exit 2
fi

# --- create one agent per provider and confirm it comes ONLINE ---
STAMP="$(date +%s)"
POLL_SECS="${KOSMOS_AGENT_ONLINE_TIMEOUT:-180}"
POLL_INT="${KOSMOS_AGENT_ONLINE_POLL_INT:-5}"

# create_and_wait <provider> <account-dir> -> echoes verdict, returns 0 online / 1 red / 2 cannot
create_and_wait() {
  local prov="$1" dir="$2" nm body sess
  nm="verify2129-${prov}-${STAMP}-$$"
  body="$("$NODE" -e 'process.stdout.write(JSON.stringify({name:process.argv[1],provider:process.argv[2],account:process.argv[3],role:"pm"}))' "$nm" "$prov" "$dir")"
  local resp; api_post /api/agents "$body"; resp="$RESP_BODY"
  if [ "$HTTP_CODE" = "400" ]; then
    say "  [$prov] create REFUSED (HTTP 400): $(printf '%s' "$resp" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).error||s)}catch{process.stdout.write(s)}})')"
    return 1
  fi
  if [ "$HTTP_CODE" != "200" ]; then
    say "  [$prov] create -> HTTP ${HTTP_CODE:-<none>} (not the #2129 class; board/create erroring)"; return 2
  fi
  # session slug the board assigned (fall back to the name we asked for).
  sess="$(printf '%s' "$resp" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{return};process.stdout.write((j.result&&j.result.name)||j.name||"")})')"
  [ -z "$sess" ] && sess="$nm"
  CREATED_NAMES="$CREATED_NAMES $sess"
  say "  [$prov] created '$sess' - polling for online (up to ${POLL_SECS}s)..."

  local waited=0 st because seen=0
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
        say "  [$prov] ONLINE (state=$st) - the #2129 class is not present."; return 0 ;;
      needs_you)
        case "$because" in
          *trust*|*Trust*|*folder*)
            say "  [$prov] WEDGED at the trust prompt (#2129): '$because'"; return 1 ;;
          *)
            say "  [$prov] needs_you (not trust): '$because' - treating as not-online"; ;;
        esac ;;
      auth_failed)
        say "  [$prov] auth_failed: '$because' (a sign-in failure, e.g. #2128/#2130 class)"; return 1 ;;
    esac
    sleep "$POLL_INT"; waited=$((waited + POLL_INT))
  done
  # Distinguish the two timeouts so a shape mismatch is self-diagnosing rather than a
  # silent, un-forceable exit 1: an agent that NEVER appeared in /api/status is far more
  # likely a board-shape mismatch (this gate reads agents[] cards keyed on sessionName
  # with classify.state) than a real #2129 wedge. Say which, so an operator can tell a
  # broken gate from a broken build.
  if [ "$seen" = 0 ]; then
    say "  [$prov] created agent '$sess' NEVER appeared in /api/status within ${POLL_SECS}s."
    say "    -> likely a board-shape mismatch, not a #2129 wedge: this gate expects an agents[] card"
    say "       with sessionName + classify.state. Verify the /api/status shape on the running board."
    return 1
  fi
  say "  [$prov] did NOT come online within ${POLL_SECS}s (last state='${st:-<none>}')"; return 1
}

say "staging-agent-online-check: creating one Claude + one OpenAI agent on $URL and confirming each comes online."
OVERALL=0
for pair in "anthropic:$ANTHROPIC_DIR" "openai:$OPENAI_DIR"; do
  prov="${pair%%:*}"; dir="${pair#*:}"
  create_and_wait "$prov" "$dir"; rc=$?
  if [ "$rc" -eq 1 ]; then OVERALL=1;
  elif [ "$rc" -eq 2 ] && [ "$OVERALL" -eq 0 ]; then OVERALL=2; fi
done

case "$OVERALL" in
  0) say "PASS: both a Claude and an OpenAI agent came ONLINE. The #2129 agent-spawn class is not present in this build." ;;
  1) say "FAIL: at least one agent did not come online (trust wedge / auth / timeout). DO NOT PROMOTE - this is the #2129 class." ;;
  2) say "CANNOT-TELL: the check could not run here (board/create error, no enforcing board). Not a pass; not a proven failure." ;;
esac
exit "$OVERALL"
