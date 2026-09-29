#!/bin/bash
#
# Start one agent, and keep launchd from restarting it in a loop.
#
# ⚠️ ONE FILE, SHARED BY EVERY AGENT, and that is the whole point of it.
#
# This used to be generated per agent: each one got its own 151-line copy under
# its own folder. Every defect in it therefore shipped as many times as there
# were agents, and every FIX reached only the agents created afterwards — the
# ones already on the machine kept their copy of the bug forever. It also could
# not be reviewed once: it was reviewed per generation, which is how six
# separate defects got into it across one afternoon.
#
# Now it takes the agent as arguments and is installed once, so a change here
# reaches every agent the next time it starts.
#
# Usage, which is what the launchd job runs:
#
#   agent-supervisor.sh <session> <workdir> <runner-bin> <tmux-bin> [log] [model] [runner]
#
# ⚠️ THIS VECTOR IS A CONTRACT WITH EVERY AGENT THAT ALREADY EXISTS, and it is
# the one thing about this file that CANNOT be changed freely.
#
# The supervisor is refreshed whenever an agent is created, so a change here
# reaches agents made long ago. Their launchd jobs are NOT: each plist is
# written once, at creation, and never rewritten. So the script travels and the
# arguments do not.
#
# Which means: **a new argument must be optional and must have a default**, and
# the existing five must keep their positions and meanings. Adding a required
# `${6:?...}`, or reordering, silently bricks every pre-existing agent — bash
# exits at once, KeepAlive respawns it every thirty seconds forever, and the
# board shows the agent as simply down with nothing anywhere saying why.
#
# If a change ever genuinely needs to break the vector, it needs to rewrite the
# existing plists at the same time, and that is a migration rather than an edit.
#
# ⚠️ The NAME is not re-validated here, deliberately. `engine/create.js`
# validates it once, hard, before anything is written — the same name that
# becomes a directory, a service label and a tmux session — and a second, weaker
# copy of that rule here would be exactly the two-definitions-of-one-fact defect
# this codebase keeps paying for. The paths get a shape check there and nothing
# more, which is worth knowing if you run this by hand with your own.
#
# What this file must do instead, and does throughout, is never interpolate an
# argument into anything that reinterprets it: every use below is a quoted
# "$1"-style expansion passed as one argument to one command.

set -u

# #4497/#4507: the same installed script is the tiny pane entrypoint. The
# supervisor writes launch secrets as NAME=value lines in an owner-only file and
# puts only this file's path on tmux argv. The child reads and unlinks it before
# exec, so the provider receives secrets in its environment while `ps` never
# sees a secret value.
if [ "${1:-}" = --pane-entry ]; then
  _secret_file="${2:?a launch-secret file is required}"
  shift 2
  while IFS= read -r _secret_line || [ -n "$_secret_line" ]; do
    _secret_name="${_secret_line%%=*}"
    case "$_secret_name" in ''|*[!A-Z0-9_]*|[0-9]*) continue ;; esac
    export "$_secret_line"
  done < "$_secret_file" 2>/dev/null
  rm -f -- "$_secret_file" 2>/dev/null || true
  unset _secret_line _secret_name _secret_file
  exec "$@"
fi

SESSION="${1:?an agent name is required}"
WORKDIR="${2:?a working directory is required}"
CLAUDE="${3:?the path to claude is required}"
TMUX_BIN="${4:?the path to tmux is required}"
LOG="${5:-}"
# The model this agent runs on, optional and NEW as of the create-agent
# branch (2026-08-16). Empty means claude's own default. Existing plists
# pass five arguments and keep working untouched; only agents created with
# an explicit model choice carry a sixth.
MODEL="${6:-}"
# The RUNNER this agent runs on, optional and NEW as of #245 (2026-08-24).
# 'claude' (the default every existing plist means by omission), 'codex', 'gemini', 'grok',
# or 'antigravity' (#3568, on by default; AGENT_WORKFORCE_ANTIGRAVITY=0 turns off setting one up),
# or 'muse' (#3939, Meta Muse: only set up where Muse is switched on, see engine/musestatus.enabled).
# Per the vector contract above: optional, defaulted, position seven, and
# every earlier argument keeps its position and meaning. $3 stays "the path
# to the runner binary" -- for a codex agent, create.js writes the codex
# path there, so this script needs no second binary argument.
RUNNER="${7:-claude}"
# #4417: the launch-time idle's inputs start empty on EVERY path (adopt included), so only this run's own agy launch
# arm can set them; a value inherited from the environment can never satisfy the gate after the session claim.
_AGY_TRUSTED=""; _AGY_HOOKED=""; _AGY_PANE=""; _AGY_BRIDGE=""

# ⚠️ TWO SPELLINGS OF THE SAME SESSION, and which commands take which was
# MEASURED on tmux 3.6a rather than assumed, because assuming it broke the claim
# on a real agent:
#
#   has-session, kill-session,
#   list-panes                : accept "=name" (exact) -- USE IT. Their default
#                               resolution falls back to a PREFIX match, so
#                               "kill-session -t sam" will happily kill
#                               samantha-discord. Measured, by killing one.
#   set-option, show-options  : REJECT "=name" outright ("no such session:
#                               =name"). They take the plain name.
#
# The two plain-name commands prefix-match too, but both run only when an exact
# session of this name is known to exist -- inside the loop that has-session
# guarded, or after new-session made it -- and tmux prefers an exact match over
# a prefix. Also measured.
TARGET="=$SESSION"

say() {
  # launchd captures stderr to the agent's log; a run by hand shows it on screen.
  echo "$(date): $*" >&2
}

# launchd appends to that log forever, and a persistently failing start writes a
# line every 30 seconds for as long as the machine is on. Keep it bounded.
# ⚠️ The size is defaulted to 0 rather than used raw: an unreadable file makes
# `wc` print nothing, and `[ "" -gt N ]` is a bash error -- written, of course,
# into the very log this is managing.
if [ -n "$LOG" ] && [ -f "$LOG" ]; then
  log_bytes=$(wc -c < "$LOG" 2>/dev/null | tr -d ' ')
  if [ "${log_bytes:-0}" -gt 1048576 ] 2>/dev/null; then
    : > "$LOG"
  fi
fi

# ── the session ──────────────────────────────────────────────────────────────
#
# ⚠️ Only ever clear a session that is OURS.
#
# This runs at every login and after every crash, so a person who happened to
# have a tmux session of this name would have had it destroyed by a job
# installed weeks earlier. The board refuses to act on any pane it cannot tie to
# a name; a script that kills one is that rule broken from the outside.
#
# The claim is the tie. If something else holds the name we WAIT rather than
# exit: exiting would have launchd restart us every 30 seconds, and waiting
# recovers on its own the moment that session ends.
adopt=
RUN_INSTANCE=""   # #4530: which run's sender token this supervisor retires when the run ends
RUN_STARTED=0     # #4530: set once this launch's session exists (launch_pane)
warned=0
waited=0
# ⚠️ SEAMS, defaulted to the shipped behaviour: the poll interval exists so
# the wait loop is TESTABLE at all (tools/test-supervisor-wait.sh drives it
# in seconds; nothing else should ever set it), and the escalation cadence
# is how often the not-ours wait says it is still waiting. 0 disables the
# escalation, which nothing should do outside a test of the quiet arm.
POLL_SECS="${AGENT_WORKFORCE_WAIT_POLL_SECS:-5}"
ESCALATE_SECS="${AGENT_WORKFORCE_WAIT_ESCALATE_SECS:-600}"
while "$TMUX_BIN" has-session -t "$TARGET" 2>/dev/null; do
  if [ "$("$TMUX_BIN" show-options -t "$SESSION" -v @kosmos_agent 2>/dev/null)" = "$SESSION" ]; then
    # Ours -- but do not throw away a HEALTHY one. This file can be run by hand,
    # and an unconditional kill meant doing so destroyed the live agent and
    # everything it remembered.
    #
    # ⚠️ IF WE CANNOT SEE INSIDE IT, WE DO NOT TOUCH IT. An empty answer used to
    # mean "every pane is a shell", so a tmux that failed to answer became a
    # reason to destroy a session we had just confirmed is ours -- "I cannot see
    # it" converted into "it is dead", which is the one inversion this whole
    # codebase is written against.
    #
    # ⚠️ -s, so this asks about the whole SESSION. Without it tmux resolves the
    # target as a WINDOW, so a split window or a second window with a shell in
    # it read as "crashed" and the live agent was killed at the next login.
    panes=$("$TMUX_BIN" list-panes -s -t "$TARGET" -F '#{pane_current_command}' 2>/dev/null)
    if [ -z "$panes" ]; then
      say "could not read what is running in $SESSION -- leaving it alone"
      adopt=1
      break
    fi
    alive=0
    while read -r pane_cmd; do
      # ⚠️ AN ALLOWLIST, matching status.js's isClaudeCommand, NOT a list of
      # shells to exclude. A crashed agent whose remaining pane holds vim, less,
      # ssh or python3 is not Claude, but a denylist of six shell names says it
      # is -- so the script adopts a dead agent and sits in the supervision loop
      # forever, and launchd's KeepAlive can never recover it because the job
      # looks healthy.
      #
      # ⚠️ A REGEX, not a glob: the glob [0-9]*.[0-9]*.[0-9]* also matches
      # 1.2.3.4 and 1a.2b.3c, while status.isNativeClaude is exactly three
      # numeric segments. A looser copy of a definition, beside a comment
      # claiming they are the same, in the place where being loose means
      # supervising a dead agent forever.
      # ⚠️ codex/codex.exe joined the allowlist with #245, mirroring
      # status.js's isCodexCommand the way the claude entries mirror
      # isClaudeCommand. Without them, a LIVE codex agent's pane reads as
      # "every pane is a shell: it crashed" and this script kills it.
      # #3568: agy (Antigravity) for the same reason, mirroring status.js's isAntigravityCommand.
      # #3953: grok-native/grok/grok.exe, mirroring status.js's isGrokCommand
      # (supervisor.adopt-grok-3953.test.js runs this against every name it accepts).
      if [[ "$pane_cmd" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
        || [ "$pane_cmd" = claude ] || [ "$pane_cmd" = claude.exe ] || [ "$pane_cmd" = node ] \
        || [ "$pane_cmd" = codex ] || [ "$pane_cmd" = codex.exe ] || [ "$pane_cmd" = agy ] || [ "$pane_cmd" = grok-native ] || [ "$pane_cmd" = grok ] || [ "$pane_cmd" = grok.exe ]; then
        alive=1
      fi
    done <<EOF
$panes
EOF
    if [ "$alive" -eq 1 ]; then
      say "$SESSION is already running -- leaving it alone and watching it"
      adopt=1
      break
    fi
    # Every pane is a shell: it crashed. Replace it.
    "$TMUX_BIN" kill-session -t "$TARGET" 2>/dev/null
    break
  fi
  if [ "$warned" -eq 0 ]; then
    say "a session called $SESSION is already running and is not ours -- waiting rather than killing it"
    warned=1
  fi
  sleep "$POLL_SECS"
  # ⚠️ A WAIT THAT CAN FAIL MUST BE ABLE TO SAY SO (#579). The not-ours arm
  # used to warn ONCE and then wait in silence, unbounded: a leaked test
  # session held the name `bl2` for 19.8 hours and the log carried one
  # warning and 14,225 has-session traces -- launchd said running, the
  # process WAS running, and the agent never started. Waiting stays right
  # (exiting makes launchd respawn us every 30 seconds, and the name may be
  # somebody's real work we must not kill); waiting SILENTLY was the
  # defect. So the wait now escalates on a slow cadence, NAMING how long it
  # has been and what is holding the name, so a log tail shows the blockage
  # rather than only line 2 of 14,226 -- and it never quietly gives up,
  # because a silent timeout is the same defect with a shorter duration.
  waited=$((waited + POLL_SECS))
  if [ "$ESCALATE_SECS" -gt 0 ] 2>/dev/null && [ "$waited" -ge "$ESCALATE_SECS" ] && [ $((waited % ESCALATE_SECS)) -lt "$POLL_SECS" ]; then
    holder=$("$TMUX_BIN" list-panes -s -t "$TARGET" -F '#{pane_current_command}' 2>/dev/null | tr '\n' ' ')
    say "STILL WAITING after $((waited / 60)) minutes: the session name $SESSION is held by a session we did not create (running: ${holder:-unreadable}). $SESSION cannot start until that session ends. If it is a leftover, close or kill it by hand; we will not, because it may be somebody's real work."
  fi
done

# #4530: where the engine (sendertoken.js) and a node are, for the mint at launch AND the
# retire when the run ends. One resolver, both callers: the retire also runs on the adopt
# path, which never enters the launch block below. Sets _app, _eng and NODE_BIN.
resolve_token_engine() {
  _app="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd || true)"
  # \U0001f6d1 #1139: TWO CANDIDATES, BECAUSE THE COPY THAT RUNS HAS NO `engine/`.
  # `$_app/engine` is true in a checkout and in the bundle, and FALSE for every
  # real agent: `installSupervisor` copies this script to SUPPORT_DIR/bin, and
  # SUPPORT_DIR has `bin/` and nothing else. Measured -- the installed copy
  # minted 0 while the identical file from a checkout minted 2, same
  # invocation, same environment, only `dirname $0` differing. So no agent had
  # ever received a token.
  #
  # There is no relative path from Application Support to wherever the app is
  # installed, so the location has to come FROM THE BOARD. It writes
  # `engine-path` beside this script in the same refresh that installs it,
  # which means existing agents are fixed at the next board start with no
  # plist rewrite -- their launchd jobs are never rewritten, so anything
  # riding the argument vector would have reached new agents only.
  _eng=""
  if [ -n "$_app" ] && [ -f "$_app/engine/sendertoken.js" ]; then
    _eng="$_app/engine"
  else
    _ptr="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)/engine-path"
    if [ -f "$_ptr" ]; then
      _cand="$(cat "$_ptr" 2>/dev/null || true)"
      if [ -n "$_cand" ] && [ -f "$_cand/sendertoken.js" ]; then _eng="$_cand"; fi
    fi
  fi
  # #1911: RESOLVE NODE ONCE, for every shell call below that needs it -- the
  # mint (this block) and the codex-dismiss shim further down (both are in this
  # same `if [ -z "$adopt" ]` scope, so NODE_BIN reaches both). The bundled node
  # beside the engine is the ONLY node on a Kosmos-only host: no Homebrew, and
  # the launchd PATH is just /usr/bin:/bin:/usr/sbin:/sbin. A source checkout
  # falls through to the PATH node. A bare `node` fails on a user machine -- the
  # #1911 class -- and the dismiss below used exactly that; one resolver, both
  # callers, so the next shell wrapper cannot repeat it.
  #
  # The bundled node first, the same one install/kosmos uses; each candidate is
  # tested -x before use, never a guess.
  #
  # \U0001f6d1 #1897: DERIVE NODE FROM $_eng, NOT $_app -- this is #1139 one
  # variable over. $_app is `dirname($0)/..`, which is SUPPORT_DIR for every
  # real agent (the supervisor is installed to SUPPORT_DIR/bin), so
  # `$_app/../runtime/bin/node` pointed at ~/Library/Application Support/runtime,
  # which does not exist. With no `node` on the agent's launchd PATH either,
  # BOTH candidates were empty and the mint never ran -- no installed agent ever
  # got a token, on any launch. $_eng is the engine the pointer already resolves
  # correctly (KOSMOS_HOME/app/engine), and install/kosmos lays runtime beside
  # app (setup.sh: `for part in bin app runtime`), so the bundled node is
  # `$_eng/../../runtime/bin/node` -- true in the installed layout AND in the
  # bundle (app/engine/../../runtime == bundle/runtime). $_eng may be empty (no
  # engine, no pointer), in which case the bundled candidate expands away and
  # only the PATH node is tried.
  NODE_BIN=""
  for _n in "${_eng:+$_eng/../../runtime/bin/node}" "$(command -v node 2>/dev/null || true)"; do
    [ -n "${_n:-}" ] && [ -x "$_n" ] && { NODE_BIN="$_n"; break; }
  done
}

# The name the board files this agent under, and so the key its sender tokens live
# under: the session minus a +world suffix, then minus -discord. #1704: the +world strip
# comes FIRST, because a world id can end in `-discord` (CLEAN_ID allows it), so a
# -discord strip before the +world parse would mangle `sales-bot+qa-discord`.
token_roster_name() {
  _tr="$SESSION"
  if [ -n "${KOSMOS_WORLD:-}" ]; then _tr="${_tr%+"$KOSMOS_WORLD"}"; fi
  printf '%s' "${_tr%-discord}"
  unset _tr
}

# #4530: the sender-token store, from the shell. `retire` drops THIS run's token
# (RUN_INSTANCE); `sweep` drops every other token this session's launches were minted for,
# keeping this run's. Best effort and silent, like the mint: it must never be the
# reason a supervisor fails. The world's roots are applied here only when the launch
# block did not already export them (the adopt path): applying them twice would nest
# one world inside another. Before this, a Mac never retired a run's token, so every
# past launch stayed a valid credential until 32 newer ones pushed it out.
token_store() {
  [ -n "${RUN_INSTANCE:-}" ] || return 0
  if [ -z "${_eng:-}" ] || [ -z "${NODE_BIN:-}" ]; then resolve_token_engine; fi
  [ -n "${_eng:-}" ] && [ -n "${NODE_BIN:-}" ] || return 0
  "$NODE_BIN" -e '
    try {
      const [eng, op, name, instance, applied, session, untagged] = process.argv.slice(1);
      if (applied !== "1" && process.env.KOSMOS_WORLD) {
        try { require(eng + "/worlds.js").applyAgentWorldEnv(process.env); } catch (e) { /* the default roots, as the mint falls back */ }
      }
      const s = require(eng + "/sendertoken.js");
      const r = op === "sweep" ? s.retireLauncher(name, "supervisor:" + session, instance, { untagged: untagged === "1" }) : s.retire(name, instance);
      if (!r || !r.ok) process.stdout.write((r && r.because) || "failed");
    } catch (e) { process.stdout.write("failed"); }
  ' "$_eng" "$1" "$(token_roster_name)" "$RUN_INSTANCE" "${_world_applied:-0}" "$SESSION" "${2:-0}" 2>/dev/null || true
}

# #4530: the -discord twin (`sam` beside `sam-discord`) shares this agent's token file
# (token_roster_name strips -discord), so a sweep of untagged tokens must not run while it may be live.
twin_session_may_live() {
  _tb="$(token_roster_name)"; _tw=""
  if [ -n "${KOSMOS_WORLD:-}" ]; then _tw="+$KOSMOS_WORLD"; fi
  _tt="$_tb$_tw"; [ "$SESSION" = "$_tt" ] && _tt="$_tb-discord$_tw"
  _tl="$("$TMUX_BIN" list-sessions -F '#{session_name}' 2>/dev/null)" || { unset _tb _tw _tt _tl; return 0; }
  printf '%s\n' "$_tl" | awk -v n="$_tt" '$0 == n { f = 1 } END { exit f ? 0 : 1 }'; _twrc=$?
  unset _tb _tw _tt _tl
  return $_twrc
}
retire_run_token() {
  [ -n "${RUN_INSTANCE:-}" ] || return 0
  _why="$(token_store retire)"
  [ -n "$_why" ] && say "$SESSION: the ended run's sender token could not be retired ($_why); the next launch retires it"
  RUN_INSTANCE=""
  unset _why
}

# This session's id, found by EXACT name. tmux resolves a plain -t by prefix when the
# exact session is gone (measured: an option read on `foo` answered from `foo-discord`),
# and `=name` is refused by set-option and show-options (measured), so the instance is
# written through the id, which names one session or fails. Empty when there is none.
session_id_exact() {
  "$TMUX_BIN" list-sessions -F '#{session_name}	#{session_id}' 2>/dev/null \
    | awk -F '\t' -v n="$SESSION" '$1 == n { print $2; exit }'
}

# --dangerously-skip-permissions is not optional for an unattended agent.
# Without it the agent starts, looks healthy, and freezes forever on its first
# permission prompt with nobody there to answer it.
#
# ⚠️ Exit on failure, because the claim below must never land on a session we
# did not make. The name can be taken between the check above and this line, and
# stamping @kosmos_agent onto somebody else's session would make the NEXT run of
# this script recognise it as ours and kill it.
if [ -z "$adopt" ]; then
  # ⚠️ The model flag is appended ONLY when a model was chosen, as two more
  # quoted arguments -- never interpolated into a string this file's header
  # forbids. An empty MODEL adds nothing and the runner picks its own default.
  #
  # Per-runner autonomy flags, same posture both ways: an unattended agent
  # that stops on its first permission prompt freezes forever with nobody
  # there to answer it. codex's spelling of claude's
  # --dangerously-skip-permissions is --dangerously-bypass-approvals-and-
  # sandbox; its model flag is -m.
  # What the launchd job knows that the pane must too (#577, #540). tmux
  # does NOT hand a client's environment to a session it makes on an
  # already-running server (probed: 0 of 1 variables arrive), and when THIS
  # job is what starts the server, every later session inherits this
  # agent's values. So each of these rides new-session's -e or the pane
  # never sees it: the board it belongs to (KOSMOS_PORT), and the account it
  # runs on (CLAUDE_CONFIG_DIR for claude, CODEX_HOME for codex). Absent
  # means the default, the plist's own rule, so nothing is passed for it.
  PANE_ENV=()
  SECRET_ENV=()
  SECRET_ENTRY=()
  SECRET_FILE=""
  _LAUNCH_TOKEN=""
    # ── #570: the sender token, minted HERE because this is the launch ──────
    #
    # `/api/report` learns who is reporting by handing `from_pane` to tmux. A
    # Windows agent has no pane and neither does an SDK runner, so #1000 added
    # a token arm: Kosmos mints, the agent presents, the route maps it back.
    # Nothing minted, so the arm was inert. This is the minting half.
    #
    # 🔑 PER LAUNCH, NOT PER AGENT (#1027). The token names which RUN this is,
    # so two live runs of one agent are distinguishable instead of interleaving
    # anonymously into one record.
    #
    # ⚠️ IT MUST NOT RIDE secrets/env/ ABOVE. That directory is per-MACHINE and
    # is copied into every agent's pane by name; a sender token there would hand
    # every agent on this Mac the same identity and undo #1000 entirely.
    #
    # 🛑 EVERY FAILURE PATH LEAVES THE AGENT STARTING NORMALLY. This file's own
    # header is the reason: a mistake here respawns every agent every thirty
    # seconds forever with nothing anywhere saying why. So no new argument, no
    # `set -e` reliance, and an unmintable token simply means no token entrypoint
    # and today's pane-derived identity. A missing token costs attribution; a broken
    # launch costs the fleet.
    KOSMOS_AGENT_TOKEN=""
    resolve_token_engine
    # ── #1704: THIS AGENT'S KOSMOS ──────────────────────────────────────────
    # The plist set KOSMOS_WORLD for a named world (absent = the default world).
    # Resolve it into this world's store roots ONCE, here, and export them, so
    # (1) the mint below lands the sender token in the WORLD's store (requiring
    # sendertoken.js freezes store.ROOT, so the roots must be set first), and
    # (2) the pane can be handed the world's roots explicitly further down -- a
    # tmux pane does NOT inherit this supervisor's environment on the shared
    # server (measured), so the world has to be pushed with `-e`.
    # ⚠️ `< <(...)` process substitution, NOT a pipe: the `export` must run in
    # THIS shell, and a `| while` would run it in a subshell and lose them.
    if [ -n "${KOSMOS_WORLD:-}" ] && [ -n "$_eng" ] && [ -n "$NODE_BIN" ] && [ -f "$_eng/worlds.js" ]; then
      while IFS='=' read -r _wk _wv; do
        [ -n "$_wk" ] && export "$_wk=$_wv"
      done < <("$NODE_BIN" -e '
        try {
          const w = require(process.argv[1]);
          w.applyAgentWorldEnv(process.env);   // KOSMOS_WORLD -> the world roots
          for (const k of ["AGENT_WORKFORCE_DATA","AGENT_WORKFORCE_PROJECTS","AGENT_WORKFORCE_WORKERS"]) {
            if (process.env[k]) process.stdout.write(k + "=" + process.env[k] + "\n");
          }
        } catch (e) { /* an unenterable world must not fail the launch: nothing is
          exported, so this pane and the mint below both fall back to the default
          store roots -- one consistent unit for everything that reads store.ROOT
          (the hooks, the kosmos CLI, the token). The one reader of KOSMOS_WORLD
          itself is the x-kosmos-world header (#1704 PR2), which still names this
          world, and that disagreement is harmless: the default board answers 421,
          the send is kept in the DEFAULT outbox those roots point at, and that
          same board drains it within a minute -- where the send went before, just
          later. KOSMOS_WORLD rides from a create.js-validated plist, so this is
          defence, not an expected path. */ }
      ' "$_eng/worlds.js" 2>/dev/null || true)
    fi
    # #4530: this block has settled the world's roots for this shell (exported, or the
    # default if it could not), so the retire at the end must not apply them again.
    _world_applied=1
    # The mint needs BOTH the engine (for sendertoken.js) and a node. No engine
    # means no token rather than a broken one (the control the test asserts).
    if [ -n "$_eng" ] && [ -n "$NODE_BIN" ]; then
      # ⚠️ THE ROSTER NAME, NOT THE TMUX SESSION. Tokens are keyed on the name
      # the board files an agent under, which `status.js` derives as the session
      # minus its `-discord` suffix. Minting under the raw session name would key
      # the file where `resolve` never looks.
      # #1704: SESSION is the launch KEY (name+world for a named world); the
      # roster and token name is the BARE agent name. Strip the +world suffix
      # FIRST, then -discord -- a world id can end in `-discord` (CLEAN_ID allows
      # it), so a -discord strip before the +world parse would mangle
      # `sales-bot+qa-discord` into `sales-bot+qa`.
      _roster="$(token_roster_name)"
      # #4530: tagged with THIS session, so once this run's session exists the earlier
      # runs it was minted for can be retired (after the claim, below). Not at mint time:
      # a launch that mints and then loses the race for the session name must not cut
      # off the run that won it. The instance comes back beside the token so this run can
      # retire its own when it ends. Two words: token, instance.
      _minted="$("$NODE_BIN" -e '
        try {
          const s = require(process.argv[1]);
          const r = s.mint(process.argv[2], { launcher: "supervisor:" + process.argv[3] });
          if (r && r.ok) process.stdout.write(r.token + (r.instance ? " " + r.instance : ""));
        } catch (e) { /* a mint is never worth a failed launch */ }
      ' "$_eng/sendertoken.js" "$_roster" "$SESSION" 2>/dev/null || true)"
      KOSMOS_AGENT_TOKEN="${_minted%% *}"
      case "$_minted" in *" "*) RUN_INSTANCE="${_minted#* }" ;; esac
      case "${RUN_INSTANCE:-}" in ''|*[!0-9a-f]*) RUN_INSTANCE="" ;; esac
      unset _minted
    fi
    # Only a hex token is a token. Anything else -- a stray warning on stdout, a
    # partial write -- is discarded rather than exported, because a malformed
    # value in the pane is worse than an absent one.
    case "${KOSMOS_AGENT_TOKEN:-}" in
      ''|*[!0-9a-f]*) KOSMOS_AGENT_TOKEN="" ;;
    esac
    if [ -n "$KOSMOS_AGENT_TOKEN" ]; then
      SECRET_ENV+=("KOSMOS_AGENT_TOKEN=$KOSMOS_AGENT_TOKEN")
      # Kept only in this shell for Antigravity's one launch-time status report.
      _LAUNCH_TOKEN="$KOSMOS_AGENT_TOKEN"
    fi
    KOSMOS_AGENT_TOKEN=""

  add_launch_secret() {
    case "${1:-}" in
      ''|*[!A-Z0-9_]*|[0-9]*)
        say "$SESSION: a launch secret was not handed to the agent (invalid variable name)"
        return 0
        ;;
    esac
    # One assignment per line. Refuse a malformed inherited value rather than
    # letting it invent another variable in the child environment.
    case "${2:-}" in
      '') return 0 ;;
      *$'\n'*|*$'\r'*)
        say "$SESSION: $1 was not handed to the agent (value has a line break)"
        return 0
        ;;
    esac
    SECRET_ENV+=("$1=$2")
  }

  remove_launch_secret() {
    _secret_kept=()
    for _secret_item in ${SECRET_ENV[@]+"${SECRET_ENV[@]}"}; do
      case "$_secret_item" in "$1="*) ;; *) _secret_kept+=("$_secret_item") ;; esac
    done
    SECRET_ENV=(${_secret_kept[@]+"${_secret_kept[@]}"})
    unset _secret_kept _secret_item
  }

  prepare_secret_entry() {
    [ "${#SECRET_ENV[@]}" -gt 0 ] || return 0
    _supervisor_dir="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)"
    _supervisor_self="${_supervisor_dir:+$_supervisor_dir/$(basename "$0")}" # absolute path to this installed script
    if [ -z "$_supervisor_self" ] || [ ! -r "$_supervisor_self" ]; then
      for _secret_item in ${SECRET_ENV[@]+"${SECRET_ENV[@]}"}; do
        say "$SESSION: ${_secret_item%%=*} was not handed to the agent (the launch entrypoint is unavailable)"
      done
      return 0
    fi
    _launch_secret_dir="${AGENT_WORKFORCE_DATA:-$_app}/launch-secrets"
    _old_umask="$(umask)"
    umask 077
    if mkdir -p "$_launch_secret_dir" 2>/dev/null && chmod 700 "$_launch_secret_dir" 2>/dev/null; then
      SECRET_FILE="$(mktemp "$_launch_secret_dir/agent-secrets.XXXXXX" 2>/dev/null || true)"
    fi
    if [ -n "$SECRET_FILE" ] && printf '%s\n' "${SECRET_ENV[@]}" > "$SECRET_FILE" 2>/dev/null \
      && chmod 600 "$SECRET_FILE" 2>/dev/null; then
      SECRET_ENTRY=(/bin/bash "$_supervisor_self" --pane-entry "$SECRET_FILE")
    else
      [ -n "$SECRET_FILE" ] && rm -f -- "$SECRET_FILE" 2>/dev/null || true
      SECRET_FILE=""
      for _secret_item in ${SECRET_ENV[@]+"${SECRET_ENV[@]}"}; do
        say "$SESSION: ${_secret_item%%=*} was not handed to the agent (the private handoff could not be built)"
      done
    fi
    umask "$_old_umask"
    unset _old_umask _launch_secret_dir _supervisor_dir _supervisor_self _secret_item
  }

  cleanup_launch_secrets() {
    [ -n "${SECRET_FILE:-}" ] && rm -f -- "$SECRET_FILE" 2>/dev/null || true
    # #4530: a launch that minted and then never started its session (every `|| exit 1`
    # below, or losing the name to another launch) leaves a token no run holds.
    # ⚠️ RUN_STARTED is set by EVERY path that creates the session: launch_pane, and the
    # Antigravity arm, which calls new-session itself. A new such path must set it too, or
    # its live run loses its token here (supervisor.retire-token-4530 runs both).
    if [ "${RUN_STARTED:-0}" != 1 ]; then retire_run_token; fi
  }
  trap cleanup_launch_secrets EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM

  launch_pane() {
    prepare_secret_entry
    # #4530: marked started BEFORE new-session and unmarked if it fails. bash holds a trapped
    # SIGTERM until new-session returns, so marking after it would let a stop during the call
    # (long when it starts the tmux server) retire a run that now exists. Marked early, the
    # worst case is a token kept for a run that never started, which the next launch sweeps.
    RUN_STARTED=1
    "$TMUX_BIN" new-session -d -s "$SESSION" -c "$WORKDIR" ${PANE_ENV[@]+"${PANE_ENV[@]}"} \
      ${SECRET_ENTRY[@]+"${SECRET_ENTRY[@]}"} "$@" || { _nrc=$?; RUN_STARTED=0; return "$_nrc"; }
  }

  # #3769 (Josh, 2026-09-25 11:54: the helper agent must never give out passwords
  # or keys): the setup guide gets NONE of the tokens Kosmos holds for the person
  # (Cloudflare, GitHub, the token doors below). It helps someone set Kosmos up and
  # needs none of them, and a key it was never given is one it cannot repeat. Known
  # by the marker the guide's folder carries from before its first start
  # (engine/setup-assistant.js guardGuideFolder, called by create.js).
  IS_SETUP_GUIDE=0
  [ -f "$WORKDIR/.kosmos-setup-guide" ] && IS_SETUP_GUIDE=1
  # A token Kosmos holds for the person (#529, Cloudflare) lives in the store
  # beside this script, mode 600, never in the plist. Read here, handed into
  # the pane, so an agent's wrangler or curl finds CLOUDFLARE_API_TOKEN set.
  _cf="$(cd "$(dirname "$0")/.." && pwd)/secrets/cloudflare.token"
  if [ "$IS_SETUP_GUIDE" = 0 ] && [ -s "$_cf" ]; then
    CLOUDFLARE_API_TOKEN="$(head -1 "$_cf")"; export CLOUDFLARE_API_TOKEN
  fi
  # GitHub's token rides the same way when the no-install door holds one
  # (#620): gh and the GitHub API read GH_TOKEN, so an agent on a Mac with
  # no keyring can still read a private repo.
  _gh="$(cd "$(dirname "$0")/.." && pwd)/secrets/github.token"
  if [ "$IS_SETUP_GUIDE" = 0 ] && [ -s "$_gh" ]; then
    GH_TOKEN="$(head -1 "$_gh")"; export GH_TOKEN
  fi
  # 🛑 THE RENDERER QUESTION, AND IT HAS TO BE SET HERE RATHER THAN IN THE JOB
  # (#1160). Claude Code offers its fullscreen renderer on first run and Josh
  # met that question on a new agent's very first screen, about half the time,
  # three reports running. The half is a server-side A/B in the runner, not
  # anything of ours. Setting a renderer preference makes the runner never ask.
  #
  # ⚠️ I FIRST PUT IT IN THE LAUNCHD JOB AND IT WAS INERT, which is exactly what
  # the block above this loop warns about in its own words: tmux does NOT hand a
  # client's environment to a session it makes on an already-running server,
  # probed at 0 of 1. The job sets it for THIS SCRIPT; only an `-e` puts it in
  # the pane where the runner reads it. A variable in the plist and not in this
  # list reaches nothing, and nothing anywhere says so.
  #
  # ⭐ AND SETTING IT HERE IS BETTER THAN THE JOB, not merely correct: a plist is
  # written once at creation and never rewritten for an existing agent, so the
  # job route reached only agents made after it shipped. The board rewrites this
  # script at every start, so EVERY agent gets it at its next launch, including
  # the ones Josh already has.
  #
  # ⚠️ CLAUDE ONLY. It is Claude Code's variable; codex has never heard of it and
  # stamping it there would be cargo that reads as deliberate to the next person.
  #
  # ⚠️ AND IT IS THE VALUE THAT CHANGES NOTHING ELSE. Every agent renders classic
  # today, so this is what they already do; the other value would move every pane
  # onto a renderer that repaints an alternate screen, which is the surface this
  # board scrapes. Measured on a private socket: an alt screen does not destroy
  # scrollback. `Does not destroy` is not a reason to move it while fixing a
  # prompt.
  # #3568: not for an Antigravity pane either; this is a Claude Code setting.
  if [ "$RUNNER" != codex ] && [ "$RUNNER" != antigravity ] && [ "$RUNNER" != muse ]; then   # #3939: nor Muse
    PANE_ENV+=(-e "CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1")
  fi
  # 🛑 #3383c: HOME is the load-bearing addition here (its position in the loop is irrelevant --
  # tmux -e order does not matter and HOME appears once). A tmux pane inherits the shared SERVER's
  # env, NOT this supervisor's (measured on 3.6a: a pane made by a client with HOME=B on a server
  # started with HOME=A gets A) -- the exact reason this whole block re-injects with -e. The plist
  # sets HOME=homeDir() for THIS supervisor, but without re-injecting it the agent's pane runs with
  # the tmux server's HOME. When an agent has NO CLAUDE_CONFIG_DIR (a default-account agent -- the
  # plist sets none, and on a GUI-launched Kosmos.app launchd carries none either), Claude Code
  # v2.1.278 resolves its folder-trust config as $HOME/.claude.json. engine/create.js writes that
  # trust to homeDir()/.claude.json. So if the pane's HOME (the server's) != homeDir(), the agent
  # reads a different .claude.json than we wrote and parks on the "trust this folder?" prompt on
  # every newly-created agent -- Josh's "worked ~50 builds then broke", on a real laptop.
  #   MEASURED with CLAUDE_CONFIG_DIR explicitly UNSET (the clean-machine case), WITH A CONTROL:
  #   server HOME wrong + pane HOME re-injected to the home that holds the trust -> NO prompt; the
  #   same WITHOUT the HOME re-injection -> the prompt fires. Re-injecting HOME=$HOME (this
  #   supervisor's, = the plist's homeDir(), = where trustFolder wrote) makes read and write agree.
  #   ⚠️ Safe when CLAUDE_CONFIG_DIR IS set (the fleet/used-machine case): the CLI then reads
  #   $CLAUDE_CONFIG_DIR/.claude.json and ignores HOME, so this is a harmless no-op there; the
  #   CLAUDE_CONFIG_DIR re-injection right beside it already handles that path. Do NOT instead try to
  #   change the WRITE path to ~/.claude/.claude.json -- measured: a no-CLAUDE_CONFIG_DIR agent reads
  #   ~/.claude.json, so that would regress every clean install (the confounded first theory).
  # This loop forwards CLAUDE_CONFIG_DIR from THIS supervisor's own env (the per-account case).
  # The #3417 block below covers the gap it cannot: a DEFAULT-account agent whose own env is
  # clean but whose pane still inherits the tmux SERVER-GLOBAL CLAUDE_CONFIG_DIR (the leak).
  # #3296/#3391 accounts slice: GEMINI_CLI_HOME / GROK_HOME forwarded too, so a
  # PER-ACCOUNT gemini/grok agent (its account home written into the plist as that
  # var) reaches the pane with the home the CLI reads. Absent for a default-account
  # agent, so this is a no-op there -- exactly like CODEX_HOME.
  # #3568: CLAUDE_CONFIG_DIR is not forwarded from this supervisor's env into an Antigravity pane.
  # #3939: nor into a Muse pane.
  for _var in HOME KOSMOS_PORT CLAUDE_CONFIG_DIR CODEX_HOME GEMINI_CLI_HOME GROK_HOME CLOUDFLARE_API_TOKEN GH_TOKEN; do
    [ "$RUNNER" = antigravity ] && [ "$_var" = CLAUDE_CONFIG_DIR ] && continue
    [ "$RUNNER" = muse ] && [ "$_var" = CLAUDE_CONFIG_DIR ] && continue
    # #4592: a codex launch uses CODEX_HOME below as the SOURCE ACCOUNT, then
    # hands the pane a separate Kosmos-owned runtime home. Forwarding the source
    # here would put both homes in new-session's environment vector and make the
    # winner depend on tmux's duplicate-key handling.
    [ "$RUNNER" = codex ] && [ "$_var" = CODEX_HOME ] && continue
    # #3769: not even one this supervisor inherited from its own environment.
    if [ "$IS_SETUP_GUIDE" = 1 ]; then
      case "$_var" in CLOUDFLARE_API_TOKEN|GH_TOKEN) continue ;; esac
    fi
    if [ -n "$(eval "printf '%s' \"\${$_var:-}\"")" ]; then
      _value="$(eval "printf '%s' \"\$$_var\"")"
      case "$_var" in
        CLOUDFLARE_API_TOKEN|GH_TOKEN) add_launch_secret "$_var" "$_value" ;;
        *) PANE_ENV+=(-e "$_var=$_value") ;;
      esac
      unset _value
    fi
  done
  # These two may have been exported above or inherited by this supervisor.
  # Only the private handoff may give them to a provider. If that handoff cannot
  # be built, the provider still starts but inherits no held credential.
  unset CLOUDFLARE_API_TOKEN GH_TOKEN
  # The token doors (#529, engine/tokendoors.js) keep each token the person
  # pasted as ONE file under secrets/env/, named for the variable agents read
  # (DISCORD_BOT_TOKEN, BRAVE_API_KEY, ...). Every such file rides into the
  # pane by name, so a new door is a row in the engine and never an edit
  # here. Only names that are variable names are taken; anything else in the
  # directory is left alone rather than typed into a pane.
  _envdir="$(cd "$(dirname "$0")/.." && pwd)/secrets/env"
  # #3769: the setup guide takes ONE door only, the key its own runner signs in with on a default
  # account (a default Gemini or Grok key arrives only this way). Everything else stays out.
  _guide_key=""
  [ "$RUNNER" = gemini ] && _guide_key=GEMINI_API_KEY
  [ "$RUNNER" = grok ] && _guide_key=XAI_API_KEY
  # The engine owns the ONE list of machine-global token doors. Read that inventory at launch rather than accepting
  # every file name in secrets/env: environment variables can execute code (NODE_OPTIONS), replace command lookup,
  # redirect network traffic or override Kosmos's own launch identity. GEMINI_API_KEY and XAI_API_KEY are the two
  # provider-key doors named by this supervisor. If the inventory cannot be read, no machine-global door is handed on.
  _door_allowlist=""
  if [ -n "$_eng" ] && [ -n "$NODE_BIN" ]; then
    _door_allowlist="$("$NODE_BIN" -e '
      try {
        const specs = require(process.argv[1]).SPECS;
        if (!Array.isArray(specs) || !specs.length) process.exit(2);
        const names = specs.map((s) => s && s.envVar);
        if (names.some((n) => typeof n !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(n))) process.exit(3);
        process.stdout.write([...new Set(names), "GEMINI_API_KEY", "XAI_API_KEY"].join("\n"));
      } catch (_) { process.exit(1); }
    ' "$_eng/tokendoors.js" 2>/dev/null || true)"
  fi
  # Door values are the least trusted launch inputs. Put them before the supervisor's own credentials in the one-use
  # file, so even an accidentally widened future inventory cannot replace the already minted sender token. The pane's
  # Kosmos routing and home values are separately fixed by PANE_ENV, and no such name is in the allowlist.
  _trusted_secret_env=(${SECRET_ENV[@]+"${SECRET_ENV[@]}"})
  SECRET_ENV=()
  if [ -d "$_envdir" ]; then
    for _f in "$_envdir"/*; do
      [ -s "$_f" ] || continue
      _name="$(basename "$_f")"
      case "$_name" in
        *[!A-Z0-9_]*|[0-9]*) continue ;;
      esac
      case $'\n'"$_door_allowlist"$'\n' in
        *$'\n'"$_name"$'\n'*) ;;
        *) say "$SESSION: $_name was not handed to the agent (it is not a Kosmos token door)"; continue ;;
      esac
      if [ "$IS_SETUP_GUIDE" = 1 ] && [ "$_name" != "$_guide_key" ]; then continue; fi
      add_launch_secret "$_name" "$(head -1 "$_f")"
    done
  fi
  SECRET_ENV+=(${_trusted_secret_env[@]+"${_trusted_secret_env[@]}"})
  unset _trusted_secret_env
  # #1704: hand the pane its Kosmos EXPLICITLY, always -- the world id and its
  # three store roots, all empty for the default world. ALWAYS, and this is the
  # point: a tmux session inherits the shared server's GLOBAL environment
  # (measured on 3.6a), and a server that a named-world board cold-started
  # carries that board's KOSMOS_WORLD and roots. An empty `-e` overrides that
  # back to the default (an empty AGENT_WORKFORCE_DATA is the default store,
  # store.js). A named world passes its resolved roots so the pane's `kosmos`
  # CLI and hooks reach ITS store, since the pane does not inherit this
  # supervisor's environment. `${VAR:-}` is empty when unset, which is exactly
  # what the default world wants pushed.
  PANE_ENV+=(-e "KOSMOS_WORLD=${KOSMOS_WORLD:-}")
  PANE_ENV+=(-e "AGENT_WORKFORCE_DATA=${AGENT_WORKFORCE_DATA:-}")
  PANE_ENV+=(-e "AGENT_WORKFORCE_PROJECTS=${AGENT_WORKFORCE_PROJECTS:-}")
  PANE_ENV+=(-e "AGENT_WORKFORCE_WORKERS=${AGENT_WORKFORCE_WORKERS:-}")
  # #4466: ALWAYS, so the `kosmos` CLI can tell an agent from a person and refuse an agent's
  # stop/restart of a board that answers (an agent restarted a busy board 140 times in an hour).
  # Not a secret: the session name. The token above can be absent (a failed mint), this cannot.
  PANE_ENV+=(-e "KOSMOS_AGENT_SESSION=$SESSION")
  # 🛑 #3417: TRUST THE CLAUDE CONFIG DIR THE PANE ACTUALLY READS. A tmux new-session inherits
  # the shared server's GLOBAL environment (measured on 3.6a, and already handled for HOME,
  # KOSMOS_WORLD + the store roots above). A board cold-started under CLAUDE_CONFIG_DIR=<account>
  # leaves that value in the server global, so a "default account" pane (own env clean, so the
  # loop above forwarded nothing) SILENTLY inherits <account> and reads <account>/.claude.json --
  # while create.js and ensure-launch-trust.js wrote the folder-trust key to the DEFAULT
  # ~/.claude.json. Trust written where the agent never reads it: every new agent re-hits the
  # folder-trust prompt. That is #3417, the #2129 "write file A, read file B" class one layer
  # deeper -- the tmux-server-global env, which #2129 could not see because it assumed a clean
  # server env, and which the loop's own-env forward above cannot see either.
  #
  # EFFECTIVE_CCD is the dir the pane will read: our own env when set (the loop already forwarded
  # it, and a per-account agent's plist sets it); else, on the Claude arm only, the tmux server
  # global the pane would otherwise inherit -- resolved here and PINNED explicitly so the pane is
  # deterministic instead of relying on inheritance. The SAME value is handed to
  # ensure-launch-trust below, so the write and the read agree by construction. An empty result
  # is a truly clean launch: nothing is pinned (leaving CLAUDE_CONFIG_DIR unset, which is exactly
  # what #3383c's HOME re-injection relies on), and the trust write takes the default path.
  # Claude only -- codex uses CODEX_HOME and has no folder-trust gate, so it has no
  # equivalent PROMPT. The CODEX_HOME arm of the SAME leak is handled by the #3430 block just
  # below (it is not Claude-specific: a board cold-started under one account's CODEX_HOME leaks
  # it into a default-account codex pane the same way).
  EFFECTIVE_CCD="${CLAUDE_CONFIG_DIR:-}"
  if [ "$RUNNER" != codex ] && [ "$RUNNER" != antigravity ] && [ "$RUNNER" != muse ] && [ -z "$EFFECTIVE_CCD" ]; then # #3568, #3939: no explicit pin for an agy or Muse pane
    _srv_ccd="$("$TMUX_BIN" show-environment -g CLAUDE_CONFIG_DIR 2>/dev/null || true)"
    case "$_srv_ccd" in
      # `CLAUDE_CONFIG_DIR=<val>` sets it; a `-CLAUDE_CONFIG_DIR` unset line or an absent
      # var leave it empty (the truly-clean launch).
      CLAUDE_CONFIG_DIR=?*) EFFECTIVE_CCD="${_srv_ccd#CLAUDE_CONFIG_DIR=}" ;;
    esac
    # Pin the resolved leak value so the pane is deterministic and matches the trust write. Not
    # pushed when empty: an empty string would risk the CLI treating "set-but-empty" differently
    # from "unset" and (ICK, fleet reference) would strand a real per-account login. No
    # double-push with the loop: this branch runs only when the loop forwarded nothing.
    if [ -n "$EFFECTIVE_CCD" ]; then
      PANE_ENV+=(-e "CLAUDE_CONFIG_DIR=$EFFECTIVE_CCD")
    fi
  fi
  # 🛑 #3430: the CODEX_HOME arm of the #3417 leak, and it is FUNCTIONAL (a silently
  # UNAUTHENTICATED codex agent, no prompt). But the FIX IS THE MIRROR of #3417, NOT a copy,
  # because Josh's account lives in a DIFFERENT place per provider (Pete + ICK, verified):
  #   - Claude's login IS the server-global (.claude-work1), so #3417 PINS it and realigns the
  #     trust write there (ensure-launch-trust). Read == write == the account. Right for Claude.
  #   - Codex's login is the DEFAULT home: default signin leaves auth.json in $HOME/.codex, and
  #     create.js writes default-account codex trust via defaultAgentCodexHome()=$HOME/.codex,
  #     DELIBERATELY skipping the engine/server CODEX_HOME. So the leaked server-global is the
  #     WRONG home for codex -- a default codex agent that INHERITS it reads a home with NO auth.
  # And codex has NO launch-time write-realign (ensure-launch-trust is Claude-only; auth is the
  # user's login Kosmos never writes), so we CANNOT pin the leak and move the write to it the way
  # #3417 does -- pinning the leak just makes the wrong read explicit (the pane already inherited
  # it) and leaves the agent unauthenticated. We must point the READ at where auth already is.
  # So OVERRIDE the pane's CODEX_HOME to the DEFAULT home (mirroring #3406's HOME re-injection for
  # a default claude agent), defeating whatever the leak would have supplied. own-env-set (a
  # per-account codex agent, plist CODEX_HOME) is left to the forwarding loop above; this fires
  # only for a default agent (own env empty).
  EFFECTIVE_CODEX_HOME="${CODEX_HOME:-}"
  if [ "$RUNNER" = codex ] && [ -z "$EFFECTIVE_CODEX_HOME" ]; then
    # defaultAgentCodexHome(), reproduced FAITHFULLY as its three tiers so it cannot silently
    # diverge from engine/create.js:defaultAgentCodexHome() =
    #   AGENT_WORKFORCE_CODEX_HOME || path.join(AGENT_WORKFORCE_HOME || os.homedir(), '.codex').
    # An earlier version dropped the AGENT_WORKFORCE_HOME tier and leaned implicitly on the plist
    # baking HOME=homeDir() (create.js), which is true today but is exactly the write-A-read-B
    # coupling this card exists to close, so the tier is written out here rather than depended on.
    # A CONCRETE path (no "set-but-empty vs unset" ambiguity); idempotent on a clean box (codex's
    # own default is $HOME/.codex anyway) and it defeats the leak on a board cold-started under a
    # stray CODEX_HOME. NOT the server-global (that was the #3432-v1 bug Pete + ICK caught).
    EFFECTIVE_CODEX_HOME="${AGENT_WORKFORCE_CODEX_HOME:-${AGENT_WORKFORCE_HOME:-$HOME}/.codex}"
  fi
  if [ "$RUNNER" = codex ]; then
    # #4592: EFFECTIVE_CODEX_HOME above is the selected ACCOUNT home. It may also
    # be the person's Codex Desktop home, whose plugins and hooks must not enter
    # an unattended agent. Give every agent a private, persistent runtime home
    # and carry only the account credential into it.
    #
    # The path mirrors engine/store.js dataRootFor on this shell launch path:
    # AGENT_WORKFORCE_DATA names the app-data parent, and the default is the
    # person's Application Support. A named world's resolved data parent is
    # already in AGENT_WORKFORCE_DATA, so worlds cannot share runtime homes.
    _codex_data_parent="${AGENT_WORKFORCE_DATA:-${AGENT_WORKFORCE_HOME:-$HOME}/Library/Application Support}"
    _codex_runtime_home="$_codex_data_parent/Kosmos/codex-homes/$SESSION"
    _codex_source_auth="$EFFECTIVE_CODEX_HOME/auth.json"
    _codex_runtime_auth="$_codex_runtime_home/auth.json"

    if mkdir -p "$_codex_runtime_home" 2>/dev/null && chmod 700 "$_codex_runtime_home" 2>/dev/null; then
      # Codex 0.149.1 refreshes file credentials by opening auth.json with
      # truncate+write, not temp+rename. That preserves this symlink and writes
      # the authoritative account file. Rebuild it on every launch so an account
      # switch reaches an existing agent. A regular file here would be a forked
      # credential, so remove it rather than accepting it.
      if [ -e "$_codex_source_auth" ]; then
        if [ -e "$_codex_runtime_auth" ] || [ -L "$_codex_runtime_auth" ]; then
          rm -f -- "$_codex_runtime_auth" 2>/dev/null || true
        fi
        if ! ln -s "$_codex_source_auth" "$_codex_runtime_auth" 2>/dev/null; then
          say "$SESSION: could not link the selected OpenAI sign-in into its private Codex home"
        fi
      else
        rm -f -- "$_codex_runtime_auth" 2>/dev/null || true
      fi

      # A fresh home has no update-notice dismissal. Seed only the first launch
      # from the source account, then let this agent keep its own notice state.
      if [ ! -e "$_codex_runtime_home/version.json" ] && [ -f "$EFFECTIVE_CODEX_HOME/version.json" ]; then
        cp "$EFFECTIVE_CODEX_HOME/version.json" "$_codex_runtime_home/version.json" 2>/dev/null || true
        chmod 600 "$_codex_runtime_home/version.json" 2>/dev/null || true
      fi
    else
      # Fail closed on isolation. Codex may report that its home is unwritable,
      # but it must never fall back to the person's plugin-bearing home.
      say "$SESSION: could not prepare its private Codex home"
    fi
    EFFECTIVE_CODEX_HOME="$_codex_runtime_home"
    PANE_ENV+=(-e "CODEX_HOME=$EFFECTIVE_CODEX_HOME")
    unset _codex_data_parent _codex_runtime_home _codex_source_auth _codex_runtime_auth
  fi
  # #3953: the codex, gemini and grok report bridges are node scripts their runner starts by name
  # (codex through the bridge's `#!/usr/bin/env node`, gemini and grok through a `node "<bridge>"`
  # hook), so they need node on the PANE's PATH. A pane inherits the tmux server's PATH, which has
  # no node when launchd started the server or Kosmos is the only node on the Mac, and then those
  # agents' self-reports fail silently. APPEND the directory of the node this script resolved (on an
  # install, Kosmos's runtime/bin, so its npm/npx come too) after the server's own PATH, so a
  # person's own node and npm still come first. This -e comes last, so it replaces any PATH the
  # secrets/env door added above. Claude's hook finds node itself.
  if [ -n "${NODE_BIN:-}" ] && { [ "$RUNNER" = codex ] || [ "$RUNNER" = gemini ] || [ "$RUNNER" = grok ]; }; then
    _srv_path="$("$TMUX_BIN" show-environment -g PATH 2>/dev/null || true)"
    case "$_srv_path" in
      PATH=?*) _srv_path="${_srv_path#PATH=}" ;;
      *) _srv_path="$PATH" ;;
    esac
    PANE_ENV+=(-e "PATH=${_srv_path}:$(dirname "$NODE_BIN")")
    unset _srv_path
  fi
  if [ "$RUNNER" = codex ]; then
    # Self-reporting (#245 on #526): codex's notify hook runs the bridge
    # with one JSON argument per event, from INSIDE the agent's pane, so
    # the report arrives carrying TMUX_PANE — the identity the route
    # resolves, same evidence property as `kosmos report`. Launch-scoped
    # via -c (probed: -c sets top-level keys reliably; nothing global is
    # touched). The bridge lives beside this script; the path may carry a
    # space (Application Support) and TOML quoting handles it, and neither
    # quotes nor backslashes can appear in SUPPORT_DIR paths we write.
    BRIDGE="$(cd "$(dirname "$0")" && pwd)/codex-report-bridge.js"
    NOTIFY_CFG="notify=[\"$BRIDGE\"]"
    # #4477: codex reads AGENTS.md only up to project_doc_max_bytes (32 KiB by default) and
    # silently drops the rest, which is Kosmos's own rules (appended after the person's brief).
    # This number is a COPY of twice engine/workerfile.js MAX_BYTES (2 x 256 KiB): codex spends one
    # budget across every AGENTS.md from the repository root down, not only the agent's own. Held equal by
    # engine/codex-docbytes-4477.test.js; the Windows launch computes it from that constant.
    # A -c always wins, so a person's own higher value in ~/.codex/config.toml is lowered to this.
    DOCBYTES_CFG="project_doc_max_bytes=524288"
      # Answer codex's update notice before the pane starts (#1315). Creation
      # dismisses the version current when the agent was MADE; this dismisses
      # whatever is current NOW, which is what stops an EXISTING agent meeting a
      # blocking prompt after OpenAI ships a new release. The board reads that
      # prompt as `unknown`, so nothing would say so.
      # ⚠️ NOT CHECKED, DELIBERATELY. The shim exits 0 on every path: an agent
      # that will not start because its update notice could not be dismissed is a
      # far worse outcome than the prompt it exists to remove.
      DISMISS="$(cd "$(dirname "$0")" && pwd)/codex-dismiss-update.js"
      # #1911: the RESOLVED node from the mint block above, never a bare `node` --
      # on a Kosmos-only host node is not on the launchd PATH, so a bare call would
      # silently fail (|| true) and the codex agent would hit the update prompt this
      # shim exists to dismiss. Empty NODE_BIN (no node anywhere) skips it, same
      # best-effort posture.
      # #3430: EFFECTIVE_CODEX_HOME (resolved above), not ${CODEX_HOME:-}: the bare env var is
      # empty for a default-account codex agent whose pane nonetheless inherits the server-global
      # CODEX_HOME, so the dismiss must target the SAME home the pane reads or it writes the
      # update-notice dismissal into a different home than the running agent.
      if [ -f "$DISMISS" ] && [ -n "${NODE_BIN:-}" ]; then "$NODE_BIN" "$DISMISS" "${EFFECTIVE_CODEX_HOME:-}" >/dev/null 2>&1 || true; fi
    if [ -n "$MODEL" ]; then
      launch_pane "$CLAUDE" --dangerously-bypass-approvals-and-sandbox -c "$NOTIFY_CFG" -c "$DOCBYTES_CFG" -m "$MODEL" || exit 1
    else
      launch_pane "$CLAUDE" --dangerously-bypass-approvals-and-sandbox -c "$NOTIFY_CFG" -c "$DOCBYTES_CFG" || exit 1
    fi
  elif [ "$RUNNER" = gemini ]; then
    # #3296: the Gemini runner. Self-reporting is NOT a launch flag (as codex's
    # notify is) -- gemini has its own hook system, and engine/create.js wrote the
    # five report hooks + the auth pre-seed into the agent's gemini settings.json
    # at birth (bin/gemini-report-bridge.js, the analog of reporthook.js). Those
    # persist across restarts, so this (re)launch needs only to start the pane.
    #   --approval-mode yolo : auto-approve all tools (the codex --dangerously-
    #                          bypass / claude --dangerously-skip analog), so an
    #                          autonomous agent never parks on a tool prompt.
    #   --skip-trust         : clear gemini's folder-trust gate at launch (the
    #                          analog of the claude ensure-launch-trust write; a
    #                          restart re-runs THIS script, not create.js).
    #   -m <model>           : PIN the model. The "Auto" router hangs in a tmux
    #                          pane (measured >1m47s on a trivial prompt), so a
    #                          model-less gemini agent is pinned to gemini-2.5-flash
    #                          here; a create that recorded a model uses that.
    # GEMINI_API_KEY reaches the pane via the generic secrets/env door (the loop
    # above), and the auth pre-seed makes the CLI use it without the first-run
    # picker. Default account reads ~/.gemini (no GEMINI_CLI_HOME set).
    # #3296 accounts slice: a PER-ACCOUNT gemini agent's account home is in
    # GEMINI_CLI_HOME (the plist wrote it; the forwarding loop above put it in the pane).
    # Its key lives in the mode-600 file engine/geminiaccounts.js wrote at
    # $GEMINI_CLI_HOME/.kosmos-gemini-apikey; read it and export GEMINI_API_KEY from it,
    # so a per-account gemini agent uses ITS account's key rather than the machine-global
    # one. Best-effort: a missing/empty/unreadable file falls back to the generic
    # secrets/env door (the DEFAULT-account path, unchanged), never failing the launch.
    # The key is NEVER echoed or logged -- it goes straight into the pane's -e env, and
    # the generic door already delivers the default GEMINI_API_KEY the same way.
    if [ -n "${GEMINI_CLI_HOME:-}" ] && [ -r "${GEMINI_CLI_HOME}/.kosmos-gemini-apikey" ]; then
      _gkey="$(head -1 "${GEMINI_CLI_HOME}/.kosmos-gemini-apikey" 2>/dev/null || true)"
      [ -n "$_gkey" ] && add_launch_secret GEMINI_API_KEY "$_gkey"
      unset _gkey
    fi
    GEMINI_MODEL="${MODEL:-gemini-2.5-flash}"
    launch_pane "$CLAUDE" --approval-mode yolo --skip-trust -m "$GEMINI_MODEL" || exit 1
  elif [ "$RUNNER" = grok ]; then
    # #3391: the Grok runner. Like gemini, self-reporting is NOT a launch flag (as
    # codex's notify is) -- Grok Build has its own hook system, and engine/create.js
    # wrote the report hooks into the agent's own grok hook file at birth
    # ($GROK_HOME/hooks/kosmos-report-bridge.json -> bin/grok-report-bridge.js). Those
    # persist across restarts, so this (re)launch needs only to start the pane.
    #   --permission-mode bypassPermissions
    #   --always-approve     : auto-approve all tools (the codex --dangerously-bypass /
    #                          claude --dangerously-skip / gemini yolo analog), so an
    #                          autonomous agent never parks on a tool prompt.
    #   --trust              : grant folder-trust at launch so grok does not park on
    #                          the first-run "trust this directory?" gate (measured; the
    #                          analog of gemini's --skip-trust; a restart re-runs THIS
    #                          script, not create.js).
    #   -m <model>           : PIN the model; a model-less create pins grok-4.6.
    # XAI_API_KEY reaches the pane via the generic secrets/env door (the loop above);
    # interactive grok uses it with no login screen ("Logged in with API key",
    # measured), so no auth pre-seed file is needed. GROK_CLAUDE_HOOKS_ENABLED=0 keeps
    # the grok agent from ALSO running the fleet's ~/.claude Claude-Code hooks via
    # grok's claude-compat -- it runs only its own report hooks (measured: our
    # ~/.grok/hooks report hook still fires with this set). #4426: the other four
    # claude-compat cells are off too, or the agent loads the person's own
    # ~/.claude/CLAUDE.md, skills, rules and ~/.claude.json MCP servers on top of its
    # AGENTS.md (one snapshot on the dev Mac, grok 1.0.41: `grok inspect` went from 84
    # live [claude] entries to 0). A plain CLAUDE.md in the agent's own folder still
    # loads (grok's docs). An agent ADOPTED at board start keeps the env it launched
    # with, so a running grok agent gets this at its next launch. Same list as
    # win32keyed.js GROK_COMPAT_OFF; a test pins the two equal. #4446: the five cursor-compat
    # cells too, or it loads the person's ~/.cursor rules, skills, agents, MCPs and hooks
    # (measured, grok 1.0.41: 2 live [cursor] entries to 0). The default account reads
    # ~/.grok, exported below as GROK_HOME (#3391).
    # #3391 accounts slice: a PER-ACCOUNT grok agent's account home is in GROK_HOME
    # (read VERBATIM as the storage root, unlike gemini). Its key lives in the mode-600
    # file engine/grokaccounts.js wrote at $GROK_HOME/.kosmos-grok-apikey; read it and
    # export XAI_API_KEY from it, so a per-account grok agent uses ITS account's key.
    # Best-effort + never-fail-the-launch + never-logged, exactly like the gemini arm;
    # a missing file falls back to the generic secrets/env door (default-account path).
    if [ -n "${GROK_HOME:-}" ] && [ -r "${GROK_HOME}/.kosmos-grok-apikey" ]; then
      _xkey="$(head -1 "${GROK_HOME}/.kosmos-grok-apikey" 2>/dev/null || true)"
      [ -n "$_xkey" ] && add_launch_secret XAI_API_KEY "$_xkey"
      unset _xkey
    fi
    # #3391: a SUBSCRIPTION account must reach grok with NO XAI_API_KEY at all, or grok
    # uses the key instead of the sign-in. An EMPTY value still counts as set to grok
    # (measured), so the variable is REMOVED: every `-e XAI_API_KEY=...` pair the
    # secrets/env door added is dropped from PANE_ENV, and the pane runs grok through
    # `env -u XAI_API_KEY` so a server-global value cannot reach it either.
    # ONE RULE, whatever the sign-in's state (challenge iteration 14): a subscription
    # account's agent runs on its OWN sign-in, named or default, so the board's row, the
    # create gate and the runtime always describe the same credential. A lapsed sign-in
    # therefore fails visibly (the row says expired) rather than quietly running on the
    # machine's door key, which for a named account would also bill somebody else.
    # WHICH DIR: GROK_HOME for a per-account agent; for a default one, the three tiers of
    # engine/grokaccounts.js defaultDir(), EXPORTED into the pane as GROK_HOME the way the
    # codex arm exports EFFECTIVE_CODEX_HOME, so the dir judged here is the dir grok reads.
    # (The plist carries GROK_HOME only for a per-account agent; see create.js plistFor. A
    # machine-wide `launchctl setenv GROK_HOME` would still reach a default agent, and then
    # this names that dir; nothing in Kosmos sets one.)
    # WHAT KIND: grokaccounts.identityOf ITSELF, asked through node, so there is one copy
    # of the rule. With no engine or no node the key is kept, and the log says so.
    _GROK_PREFIX=()
    _GROK_ACCT="${GROK_HOME:-${AGENT_WORKFORCE_GROK_HOME:-${AGENT_WORKFORCE_HOME:-$HOME}/.grok}}"
    [ -z "${GROK_HOME:-}" ] && PANE_ENV+=(-e "GROK_HOME=$_GROK_ACCT")
    _GROK_KIND=""
    if [ -n "$_eng" ] && [ -n "$NODE_BIN" ] && [ -f "$_eng/grokaccounts.js" ]; then
      # The account's authMode, or nothing. A function, so its early return is legal:
      # `node -e` runs a script, where a top-level return is a SyntaxError.
      _GROK_KIND="$("$NODE_BIN" -e '
        (function () {
          try {
            const w = require(process.argv[1]).identityOf(process.argv[2]);
            if (w) process.stdout.write(String(w.authMode));
            // A sign-in file that is not ONE readable Grok account (torn mid-refresh, a second
            // account, another issuer): the key stays, as for any undescribed account, but it
            // is never silent, because it may be a sign-in running on the machine key.
            else if (require("fs").existsSync(require("path").join(process.argv[2], "auth.json"))) {
              process.stderr.write("grok: " + process.argv[2] + "/auth.json is not one Grok sign-in Kosmos can read, so this agent keeps any XAI_API_KEY\n");
            }
          } catch (e) {
            // The key stays, and the log says why: a silent keep would read as "not a subscription".
            process.stderr.write("grok: could not read what kind of account " + process.argv[2] + " is (" + ((e && e.message) || e) + "), so this agent keeps any XAI_API_KEY\n");
          }
        })();
      ' "$_eng/grokaccounts.js" "$_GROK_ACCT" || true)"
    elif [ -e "${_GROK_ACCT}/auth.json" ]; then
      echo "grok: ${_GROK_ACCT}/auth.json is there but this supervisor cannot reach the engine or node to read it; unverified token doors are refused" >&2
    fi
    if [ "$_GROK_KIND" = subscription ]; then
      _kept=()
      _i=0
      _n=${#PANE_ENV[@]}
      while [ "$_i" -lt "$_n" ]; do
        if [ "${PANE_ENV[$_i]}" = "-e" ] && [ $((_i + 1)) -lt "$_n" ]; then
          case "${PANE_ENV[$((_i + 1))]}" in
            XAI_API_KEY=*) ;;
            *) _kept+=(-e "${PANE_ENV[$((_i + 1))]}") ;;
          esac
          _i=$((_i + 2))
        else
          _kept+=("${PANE_ENV[$_i]}")
          _i=$((_i + 1))
        fi
      done
      PANE_ENV=(${_kept[@]+"${_kept[@]}"})
      remove_launch_secret XAI_API_KEY
      unset _kept _i _n
      _GROK_PREFIX=(/usr/bin/env -u XAI_API_KEY)
    fi
    unset _GROK_ACCT _GROK_KIND
    GROK_MODEL="${MODEL:-grok-4.6}"
    PANE_ENV+=( \
      -e "GROK_CLAUDE_HOOKS_ENABLED=0" -e "GROK_CLAUDE_AGENTS_ENABLED=false" \
      -e "GROK_CLAUDE_RULES_ENABLED=false" -e "GROK_CLAUDE_SKILLS_ENABLED=false" \
      -e "GROK_CLAUDE_MCPS_ENABLED=false" \
      -e "GROK_CURSOR_HOOKS_ENABLED=false" -e "GROK_CURSOR_AGENTS_ENABLED=false" \
      -e "GROK_CURSOR_RULES_ENABLED=false" -e "GROK_CURSOR_SKILLS_ENABLED=false" \
      -e "GROK_CURSOR_MCPS_ENABLED=false"
    )
    launch_pane ${_GROK_PREFIX[@]+"${_GROK_PREFIX[@]}"} "$CLAUDE" --permission-mode bypassPermissions --always-approve --trust -m "$GROK_MODEL" || exit 1
  elif [ "$RUNNER" = antigravity ]; then
    # #3568: the Antigravity runner (Google's agy). The board sets one up unless AGENT_WORKFORCE_ANTIGRAVITY=0, and a job set up while it was on keeps
    # launching here after it is turned off, including the trust write below. Launched with its documented flags only (agy 1.2.10 --help):
    #   --dangerously-skip-permissions : auto-approve tool requests (the claude/gemini/grok analog)
    #   --model                        : only when a model was recorded; empty lets agy pick.
    # The pane's own directory is agy's workspace (it has no --cwd). The person signs in to
    # Antigravity inside this pane with their own Google account; Kosmos never reads or reuses
    # agy's stored sign-in. Status comes from agy's own hooks (#4043, below).
    # agy asks "trust this folder?" on every new folder and has no flag to skip it (measured
    # 2026-09-25), so pre-answer it here, before every launch. Best-effort, like
    # ensure-launch-trust.js below for Claude: if it cannot write, the prompt shows instead.
    if [ -n "${_eng:-}" ] && [ -f "$_eng/agytrust.js" ] && [ -n "${NODE_BIN:-}" ]; then
      # stderr (why, if it could not) goes to the agent log; stdout is `trusted` only when it did (#4417's seed below).
      _AGY_TRUSTED="$("$NODE_BIN" "$_eng/agytrust.js" "$WORKDIR" || true)"
    fi
    # #4043: agy's own hooks tell the board what it is doing (working / idle), in place of "Can't
    # tell". Before every launch, make the workdir's .agents/hooks.json carry Kosmos's one entry
    # (kosmos-report -> the report bridge beside this script, run by the bundled node). The person's
    # other hooks are kept; a file that is not JSON is left alone. Best-effort, never blocks launch.
    _AGY_BRIDGE="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)/agy-report-bridge.js"
    if [ -n "${_eng:-}" ] && [ -f "$_eng/agyhooks.js" ] && [ -n "${NODE_BIN:-}" ] && [ -f "$_AGY_BRIDGE" ]; then
      # agy's version decides whether the ask_question hooks are safe to write (agyhooks MIN_TOOL_HOOKS).
      _AGY_VERSION="$("$CLAUDE" --version 2>/dev/null | head -n 1 || true)"
      # #4417: its stdout is `hooked` only when the hook is in place and on (the seed below depends on it); stderr, the
      # reason it could not, still goes to the agent log.
      _AGY_HOOKED="$("$NODE_BIN" "$_eng/agyhooks.js" "$WORKDIR" "$NODE_BIN" "$_AGY_BRIDGE" "$_AGY_VERSION" || true)"
      unset _AGY_VERSION
    fi
    _AGY_ARGS=(--dangerously-skip-permissions)
    [ -n "${MODEL:-}" ] && _AGY_ARGS+=(--model "$MODEL")
    # #4417: -P -F prints the new pane's id, taken at creation rather than looked up by session name afterwards.
    prepare_secret_entry
    # #4530: this arm makes its session itself rather than through launch_pane (it needs the pane
    # id), so it marks the run started itself: left at 0, the EXIT trap would retire this LIVE
    # run's token on any exit, a SIGTERM or a tmux that failed to answer once (review of #4530,
    # iteration 2). Before the call and unmarked on failure, as launch_pane does, and outside the
    # $(...), which runs in a subshell.
    RUN_STARTED=1
    _AGY_PANE="$("$TMUX_BIN" new-session -d -s "$SESSION" -P -F '#{pane_id}' -c "$WORKDIR" ${PANE_ENV[@]+"${PANE_ENV[@]}"} ${SECRET_ENTRY[@]+"${SECRET_ENTRY[@]}"} \
      "$CLAUDE" "${_AGY_ARGS[@]}")" || { RUN_STARTED=0; exit 1; }
    unset _AGY_ARGS
  elif [ "$RUNNER" = muse ]; then
    # #3939 slice 3c-3a: Meta Muse. Muse Code's own screen cannot be read from outside, and Meta's
    # headless route is one `muse exec` per turn, so the pane runs Kosmos's front instead
    # (engine/musefront.js): it takes each message the board types and runs one Muse turn on this
    # agent's own session. $CLAUDE is the muse binary create.js checked, handed to the front's turns
    # as AGENT_WORKFORCE_MUSE_BIN so they run that one. The report bridge beside this script is passed
    # only when it is there; otherwise the front uses the one beside the engine.
    if [ -z "${NODE_BIN:-}" ] || [ -z "${_eng:-}" ] || [ ! -f "$_eng/musefront.js" ]; then
      say "cannot start $SESSION: Kosmos's Muse front or node is not on this computer"
      exit 1
    fi
    _MUSE_ENV=(-e "AGENT_WORKFORCE_MUSE_BIN=$CLAUDE")
    _MUSE_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)"
    if [ -n "$_MUSE_DIR" ] && [ -f "$_MUSE_DIR/agy-report-bridge.js" ]; then
      _MUSE_ENV+=(-e "KOSMOS_MUSE_BRIDGE=$_MUSE_DIR/agy-report-bridge.js")
    fi
    PANE_ENV+=("${_MUSE_ENV[@]}")
    launch_pane "$NODE_BIN" "$_eng/musefront.js" "$WORKDIR" || exit 1
    unset _MUSE_ENV _MUSE_DIR
  else
    # #2808 class-1 / #2129: re-apply the folder-trust write + bypass pre-accept BEFORE
    # this (re)launch. engine/create.js writes them once at CREATE, but a restart re-runs
    # THIS script, not create.js, and --dangerously-skip-permissions does NOT answer the
    # folder-trust dialog (a separate startup gate) -- so without this a restarted agent
    # can park on the #2129 trust prompt in a TUI nobody can answer. Best-effort +
    # idempotent (the shim always exits 0, re-writes nothing when the keys are set), same
    # $_eng/$NODE_BIN resolution and same best-effort posture as the codex-dismiss shim above.
    # The extra `[ -n "${_eng:-}" ]` (which that shim omits) is deliberate: the codex shim
    # builds its path from `$(dirname "$0")` which is always set, whereas $_eng can be empty
    # (no engine, no pointer), so guarding it keeps the `-f` test off a bare "/ensure-launch-
    # trust.js". Claude arm only: the codex arm has its own trustCodexFolder + dismiss shim,
    # and its CLAUDE_CONFIG_DIR is a CODEX_HOME that must never take a CLAUDE trust write.
    if [ -n "${_eng:-}" ] && [ -f "$_eng/ensure-launch-trust.js" ] && [ -n "${NODE_BIN:-}" ]; then
      # #3417: EFFECTIVE_CCD (resolved above), NOT ${CLAUDE_CONFIG_DIR:-}. The bare env
      # var is empty for a default-account agent whose pane nonetheless inherits the tmux
      # server-global CLAUDE_CONFIG_DIR, which sent the trust write to ~/.claude.json while
      # the pane read <server-global>/.claude.json. EFFECTIVE_CCD is exactly what the pane
      # is launched with (the -e above), so the write and the read agree by construction.
      "$NODE_BIN" "$_eng/ensure-launch-trust.js" "$WORKDIR" "${EFFECTIVE_CCD:-}" >/dev/null 2>&1 || true
    fi
    # #3633: the agent's own private browser (engine/agentbrowser.js). The shim prints
    # a config path once the pinned browser is installed, and nothing otherwise, so
    # an agent started before the install landed simply has no browser this launch.
    # Only a path to an existing file is passed on: a missing --mcp-config file stops
    # claude from starting. `--mcp-config` takes several values, so it goes before
    # --dangerously-skip-permissions, a flag, which ends its list.
    MCP_ARGS=()
    if [ -n "${_eng:-}" ] && [ -f "$_eng/agent-browser-config.js" ] && [ -n "${NODE_BIN:-}" ]; then
      _mcp="$("$NODE_BIN" "$_eng/agent-browser-config.js" 2>/dev/null || true)"
      # Absolute only: claude runs from $WORKDIR, where a relative path would not resolve.
      case "$_mcp" in /*) if [ -f "$_mcp" ]; then MCP_ARGS=(--mcp-config "$_mcp"); fi ;; esac
      unset _mcp
    fi
    if [ -n "$MODEL" ]; then
      launch_pane "$CLAUDE" ${MCP_ARGS[@]+"${MCP_ARGS[@]}"} --dangerously-skip-permissions --model "$MODEL" || exit 1
    else
      launch_pane "$CLAUDE" ${MCP_ARGS[@]+"${MCP_ARGS[@]}"} --dangerously-skip-permissions || exit 1
    fi
  fi
fi

# The claim. `set-option` cannot take the `=exact` form, and it is safe here
# because an exact session of this name has just been made or just been seen.
# ⚠️ One narrow race survives that argument: on the adopt path, if the session
# dies between the check above and this line, tmux falls back to PREFIX
# resolution and could stamp this claim onto a longer-named stranger's session.
# It cannot lead to a kill -- every destructive target is `=`-anchored -- but
# the board would read that session as a claimed agent. Named rather than fixed,
# because the fix is a tmux feature that does not exist.
#
# Without it this agent is anonymous on the board after every
# restart, whatever it was when it was created: no name, no role, no model, and
# no editable instructions. It is a tmux user option, so it dies with the
# session -- which is exactly why it is trustworthy, and exactly why it has to
# be set at every start rather than once at creation.
"$TMUX_BIN" set-option -t "$SESSION" @kosmos_agent "$SESSION" \
  || say "could not claim $SESSION -- the board will not recognise it"
# The runner rides beside the claim (#245), for the same reason and with the
# same lifetime: pane_current_command cannot say which runner this is (the
# npm-installed codex fronts as `node`), so the process that KNOWS records
# it, and the board reads a fact instead of inferring one.
"$TMUX_BIN" set-option -t "$SESSION" @kosmos_runner "$RUNNER" \
  || say "could not record $SESSION's runner -- the board will read it as claude"
# #4530: which run's sender token this session holds, so the supervisor that sees it end
# can retire that token even when it is not the one that launched it (a supervisor
# restarted mid-run adopts the live session and never minted). The instance is a label,
# not a secret (sendertoken.js), and it dies with the session like the claim above.
# Both directions go by EXACT name (session_id_exact): a prefix match could stamp this
# run onto `foo-discord`, or read `foo-discord`'s run as ours and retire a live token.
if [ -z "$adopt" ] && [ -n "$RUN_INSTANCE" ]; then
  _sid="$(session_id_exact)"
  [ -n "$_sid" ] && "$TMUX_BIN" set-option -t "$_sid" @kosmos_token_instance "$RUN_INSTANCE" 2>/dev/null || true
  # This run's session exists and is claimed, and a session name is unique, so every
  # other run launched for it has ended: retire their tokens now.
  if [ -n "$_sid" ]; then
    # Untagged tokens too (every run minted before #4530), unless the twin may be running on one.
    _unt=1; if twin_session_may_live; then _unt=0; fi
    _why="$(token_store sweep "$_unt")"
    [ -n "$_why" ] && say "$SESSION: earlier runs' sender tokens could not be retired ($_why); the next launch tries again"
  fi
  unset _sid _why _unt
elif [ -n "$adopt" ]; then
  RUN_INSTANCE="$("$TMUX_BIN" list-sessions -F '#{session_name}	#{@kosmos_token_instance}' 2>/dev/null \
    | awk -F '\t' -v n="$SESSION" '$1 == n { print $2; exit }')"
  case "$RUN_INSTANCE" in ''|*[!0-9a-f]*) RUN_INSTANCE="" ;; esac
fi

# #4417, for an Antigravity agent THIS run launched (the vars below start empty at the top of this script and are
# set only in its launch arm). AFTER the claim above, on purpose: the board ties a report to an agent only once its session carries
# @kosmos_agent (launchidentity.paneSessionIsOurs), so a report sent before the claim is not recorded.
# agy has no session-start hook (only PreInvocation and Stop), so an agent that was just (re)started and
# has not been spoken to read "Can't tell" until its first turn (#4414). Tell the board, once, that it is idle, but
# ONLY when all three hold, because an idle report never decays; each gate removes one known way that idle would be
# wrong. Not removed: a sign-out after the last confirmed check (lastKnown keeps a confirmed sign-in), and any other
# agy start-up screen nobody has measured. See .claude/plans/agyseed-4417.md.
#   - the hook is in place and on (_AGY_HOOKED, from agyhooks in the launch arm);
#   - the folder is in agy's trusted list (_AGY_TRUSTED, from agytrust in the launch arm);
#   - agystatus.lastKnown() has signedIn true.
# Sent as the new pane (its id from new-session). Of the pane's own env list, only entries named KOSMOS_*,
# AGENT_WORKFORCE_* or HOME are added (among them the port, world and store root the bridge reads).
# The launch token is inherited from this supervisor shell, not rebuilt as an
# `env NAME=value` argv entry.
# `auto`, so it never erases a deliberate blocked. Best-effort: `|| true`, and its output goes nowhere.
if [ "$RUNNER" = antigravity ] && [ -n "${NODE_BIN:-}" ] && [ -n "${_eng:-}" ] && [ -f "${_AGY_BRIDGE:-}" ] \
  && [ "${_AGY_HOOKED:-}" = hooked ] && [ "${_AGY_TRUSTED:-}" = trusted ] && [ -n "${_AGY_PANE:-}" ]; then
  _AGY_SIGNED="$("$NODE_BIN" -e 'try { const r = require(process.argv[1] + "/agystatus").lastKnown(); if (r && r.signedIn === true) process.stdout.write("signed-in"); } catch (e) { /* unknown is not signed in */ }' "$_eng" 2>/dev/null || true)"
  if [ "$_AGY_SIGNED" = signed-in ]; then
    _AGY_SEED_ENV=()
    for _x in ${PANE_ENV[@]+"${PANE_ENV[@]}"}; do
      case "$_x" in KOSMOS_*=*|AGENT_WORKFORCE_*=*|HOME=*) _AGY_SEED_ENV+=("$_x") ;; esac
    done
    (
      export KOSMOS_AGENT_TOKEN="${_LAUNCH_TOKEN:-}"
      env ${_AGY_SEED_ENV[@]+"${_AGY_SEED_ENV[@]}"} TMUX_PANE="$_AGY_PANE" "$NODE_BIN" "$_AGY_BRIDGE" KosmosLaunch </dev/null >/dev/null 2>&1
    ) || true
    unset _AGY_SEED_ENV _x
  fi
  unset _AGY_SIGNED
fi
unset _AGY_HOOKED _AGY_TRUSTED _AGY_PANE
unset _AGY_BRIDGE
unset _LAUNCH_TOKEN

# Stay alive while the session does, so launchd supervises the AGENT rather than
# a command that exits in a tenth of a second.
#
# ⚠️ Without this the job "finishes" immediately, KeepAlive restarts it, and the
# restart fails on the session the last run just made: a respawn loop for as
# long as the machine is on, while the agent looks perfectly healthy because the
# first attempt worked.
while "$TMUX_BIN" has-session -t "$TARGET" 2>/dev/null; do
  sleep 10
done
# #4530: the run is over, so its sender token stops being a credential now rather than
# when 32 newer launches push it out. Only here, after the session is gone: a supervisor
# stopped by a signal exits above without retiring, because its run may still be alive.
# 🛑 AND ONLY ON PROOF THAT IT IS GONE. The loop above ends on ANY failure of
# has-session, and a tmux that cannot answer for a moment (an update swaps its binary
# under a running supervisor: exit 127) would otherwise retire a LIVE agent's token, so
# its reports are refused until its next launch (review of #4530, B1). tmux answers 1
# for "no such session" and for "no server" (measured); anything else is not an answer.
# Two answers of 1, a couple of seconds apart, or nothing is retired.
_gone=0
"$TMUX_BIN" has-session -t "$TARGET" 2>/dev/null; _rc=$?
if [ "$_rc" -eq 1 ]; then
  sleep 2
  "$TMUX_BIN" has-session -t "$TARGET" 2>/dev/null; _rc=$?
  [ "$_rc" -eq 1 ] && _gone=1
fi
if [ "$_gone" = 1 ]; then
  retire_run_token
elif [ -n "${RUN_INSTANCE:-}" ]; then
  say "$SESSION: the session was not confirmed gone (has-session answered $_rc), so its run's sender token is kept; the next launch retires it"
fi
unset _gone _rc
