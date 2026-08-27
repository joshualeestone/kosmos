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
# 'claude' (the default every existing plist means by omission) or 'codex'.
# Per the vector contract above: optional, defaulted, position seven, and
# every earlier argument keeps its position and meaning. $3 stays "the path
# to the runner binary" -- for a codex agent, create.js writes the codex
# path there, so this script needs no second binary argument.
RUNNER="${7:-claude}"

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
      if [[ "$pane_cmd" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
        || [ "$pane_cmd" = claude ] || [ "$pane_cmd" = claude.exe ] || [ "$pane_cmd" = node ] \
        || [ "$pane_cmd" = codex ] || [ "$pane_cmd" = codex.exe ]; then
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
    # `set -e` reliance, and an unmintable token simply means no `-e` flag and
    # today's pane-derived identity. A missing token costs attribution; a broken
    # launch costs the fleet.
    KOSMOS_AGENT_TOKEN=""
    _app="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd || true)"
    if [ -n "$_app" ] && [ -f "$_app/engine/sendertoken.js" ]; then
      # The bundled node first, the same one install/kosmos uses; then whatever
      # is on PATH, so a source checkout still works. Never a guess: each is
      # tested for executability before it is run.
      for _n in "$_app/../runtime/bin/node" "$(command -v node 2>/dev/null || true)"; do
        [ -n "${_n:-}" ] && [ -x "$_n" ] || continue
        # ⚠️ THE ROSTER NAME, NOT THE TMUX SESSION. Tokens are keyed on the name
        # the board files an agent under, which `status.js` derives as the
        # session minus its `-discord` suffix. Minting under the raw session
        # name would key the file where `resolve` never looks.
        _roster="${SESSION%-discord}"
        KOSMOS_AGENT_TOKEN="$("$_n" -e '
          try {
            const s = require(process.argv[1]);
            const r = s.mint(process.argv[2]);
            if (r && r.ok) process.stdout.write(r.token);
          } catch (e) { /* a mint is never worth a failed launch */ }
        ' "$_app/engine/sendertoken.js" "$_roster" 2>/dev/null || true)"
        break
      done
    fi
    # Only a hex token is a token. Anything else -- a stray warning on stdout, a
    # partial write -- is discarded rather than exported, because a malformed
    # value in the pane is worse than an absent one.
    case "${KOSMOS_AGENT_TOKEN:-}" in
      ''|*[!0-9a-f]*) KOSMOS_AGENT_TOKEN="" ;;
    esac
    if [ -n "$KOSMOS_AGENT_TOKEN" ]; then
      PANE_ENV+=(-e "KOSMOS_AGENT_TOKEN=$KOSMOS_AGENT_TOKEN")
    fi

  # A token Kosmos holds for the person (#529, Cloudflare) lives in the store
  # beside this script, mode 600, never in the plist. Read here, handed into
  # the pane, so an agent's wrangler or curl finds CLOUDFLARE_API_TOKEN set.
  _cf="$(cd "$(dirname "$0")/.." && pwd)/secrets/cloudflare.token"
  if [ -s "$_cf" ]; then
    CLOUDFLARE_API_TOKEN="$(head -1 "$_cf")"; export CLOUDFLARE_API_TOKEN
  fi
  # GitHub's token rides the same way when the no-install door holds one
  # (#620): gh and the GitHub API read GH_TOKEN, so an agent on a Mac with
  # no keyring can still read a private repo.
  _gh="$(cd "$(dirname "$0")/.." && pwd)/secrets/github.token"
  if [ -s "$_gh" ]; then
    GH_TOKEN="$(head -1 "$_gh")"; export GH_TOKEN
  fi
  for _var in KOSMOS_PORT CLAUDE_CONFIG_DIR CODEX_HOME CLOUDFLARE_API_TOKEN GH_TOKEN; do
    if [ -n "$(eval "printf '%s' \"\${$_var:-}\"")" ]; then
      PANE_ENV+=(-e "$_var=$(eval "printf '%s' \"\$$_var\"")")
    fi
  done
  # The token doors (#529, engine/tokendoors.js) keep each token the person
  # pasted as ONE file under secrets/env/, named for the variable agents read
  # (DISCORD_BOT_TOKEN, BRAVE_API_KEY, ...). Every such file rides into the
  # pane by name, so a new door is a row in the engine and never an edit
  # here. Only names that are variable names are taken; anything else in the
  # directory is left alone rather than typed into a pane.
  _envdir="$(cd "$(dirname "$0")/.." && pwd)/secrets/env"
  if [ -d "$_envdir" ]; then
    for _f in "$_envdir"/*; do
      [ -s "$_f" ] || continue
      _name="$(basename "$_f")"
      case "$_name" in
        *[!A-Z0-9_]*|[0-9]*) continue ;;
      esac
      PANE_ENV+=(-e "$_name=$(head -1 "$_f")")
    done
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
    if [ -n "$MODEL" ]; then
      "$TMUX_BIN" new-session -d -s "$SESSION" -c "$WORKDIR" ${PANE_ENV[@]+"${PANE_ENV[@]}"} \
        "$CLAUDE" --dangerously-bypass-approvals-and-sandbox -c "$NOTIFY_CFG" -m "$MODEL" || exit 1
    else
      "$TMUX_BIN" new-session -d -s "$SESSION" -c "$WORKDIR" ${PANE_ENV[@]+"${PANE_ENV[@]}"} \
        "$CLAUDE" --dangerously-bypass-approvals-and-sandbox -c "$NOTIFY_CFG" || exit 1
    fi
  else
    if [ -n "$MODEL" ]; then
      "$TMUX_BIN" new-session -d -s "$SESSION" -c "$WORKDIR" ${PANE_ENV[@]+"${PANE_ENV[@]}"} \
        "$CLAUDE" --dangerously-skip-permissions --model "$MODEL" || exit 1
    else
      "$TMUX_BIN" new-session -d -s "$SESSION" -c "$WORKDIR" ${PANE_ENV[@]+"${PANE_ENV[@]}"} \
        "$CLAUDE" --dangerously-skip-permissions || exit 1
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
