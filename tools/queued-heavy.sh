#!/bin/bash
# queued-heavy.sh "<what>" <command> [args...]
# Run a heavy one-off (a browser-check proof, a pre-push cargo test) as a REAL TURN in the same FIFO queue the
# suites use (Splinter 2026-09-30 02:10), instead of squeezing it in beside someone's suite:
#   1. wait with kosmos_wait_until_clear --suite-queue, so it holds a queue place and goes when no suite, harness
#      or machine claim is live and no earlier waiter is ahead (run-tests.sh's own check, _rt_box_clear);
#   2. take kosmos_claim_machine for the run, so a waiting suite (which asks kosmos_refuse_if_machine_claimed on
#      every poll) does not start beside it;
#   3. keep that claim alive while the command runs (renewed every 10 minutes), then release it, whatever the
#      command did. Before 2026-09-30 09:0x the claim was a fixed 30 minutes, so a turn that ran longer was given
#      a neighbour silently (Ice Cream Kitty's #4665 turn overlapped Baron's #4658 at 08:58).
# The renewals stop after QUEUED_HEAVY_MAX_RENEWALS (default 12, so about 2 hours), so a hung command cannot hold
# the box for ever; the claim then lapses one claim length later and the END line still prints when it exits.
# The guards come from tools/lib/cut-guard.sh (with #4609) in the checkout named by QUEUED_HEAVY_LIB (default below).
# Prints QUEUED-HEAVY lines for the start, the turn, and the end with the command's rc.
# #4977: this file in the repo (tools/queued-heavy.sh) is the reviewed source; tools/test-queued-heavy-4977.sh pins it
# in CI. The copy agents run, ~/.cache/claude-handoffs/queued-heavy.sh, is installed separately, and nothing checks
# that the two match.
# TO CHANGE THE INSTALLED COPY: write the new version beside it and mv it over. Never edit it in place: waiters are
# running it, and bash reads a script by byte offset, so an in-place edit kills them.
set -u
# #4609 light lane (Renet, 2026-09-30): `queued-heavy.sh --light "<what>" <cmd...>` for ONE browser check or ONE focused
# test file (a run that holds the box for seconds to a couple of minutes). It goes ahead of full suites and heavy runs,
# still one run at a time; a heavy waiter past 45 min goes first. Honest use only: a long job marked light jumps the
# line for everyone. Needs a cut-guard.sh with the lane (lightlane-4609); an older lib ignores the class.
# #4911: a run started from inside another's side turn must not inherit it as its own (review 3), and must not wait
# for it either: it would wait on its own parent until the cap stopped both (review 4). Kept to refuse below.
QH_INHERITED_SIDE="${KOSMOS_LIGHT_SIDE_COOKIE:-}"
QH_INHERITED_MAIN="${KOSMOS_MACHINE_CLAIM_COOKIE:-}"   # review 12: see below, after the lib is loaded
unset KOSMOS_LIGHT_SIDE_COOKIE KOSMOS_SIDE_CAPABLE KOSMOS_WAIT_LANE KOSMOS_SIDE_HOLDER_COOKIE   # round 17: the holder is this run's own
# Every waiter of this script knows about side turns (marker line 6 "aware", or "side" for one that takes them), so a
# side turn waits only on waiters of an OLDER script, which would not wait for it.
export KOSMOS_SIDE_AWARE=1
if [ "${1:-}" = --light ]; then export KOSMOS_QUEUE_CLASS=light; shift; fi
WHAT="${1:?what}"; shift
# 2026-09-30 10:44: a batch waited 97 minutes for its turn and then died "Permission denied" (rc 126): the script it
# ran was never made executable. Refuse NOW, before the wait, when the command is a file that cannot be executed.
if [ -e "${1:-}" ] && [ ! -x "${1:-}" ]; then
  echo "QUEUED-HEAVY $(date '+%H:%M:%S') REFUSED before waiting: $1 is not executable (chmod +x it, or run it as: zsh $1)"
  exit 126
fi
[ "$#" -gt 0 ] || { echo "usage: queued-heavy.sh \"<what>\" <command> [args...]" >&2; exit 2; }
# #4977: the guards come from ONE checkout shared by every waiter on the Mac, never the worktree this is run from: each
# branch's own lib would put several lib generations in one queue (the cause of #4977's item 1). That checkout is meant
# to sit at origin/main; nothing here updates it or checks that it does.
LIB_CHECKOUT="${QUEUED_HEAVY_LIB:-$HOME/work/kosmos-bc-main-4610}"
. "$LIB_CHECKOUT/tools/lib/cut-guard.sh" || { echo "QUEUED-HEAVY: could not load cut-guard.sh from $LIB_CHECKOUT (set QUEUED_HEAVY_LIB to a checkout of origin/main)" >&2; exit 3; }
command -v kosmos_wait_until_clear >/dev/null || { echo "QUEUED-HEAVY: cut-guard.sh has no kosmos_wait_until_clear" >&2; exit 3; }
# Review 12: started inside an ordinary turn that already holds the box (it inherited that turn's claim cookie). It
# used to take its "turn" at once (the claim read as its own) and then RELEASE the parent's claim at its end, so the
# box read free under the parent's still-running command. It runs now, under the parent's turn, and claims nothing.
if [ -n "$QH_INHERITED_MAIN" ]; then
  if command -v kosmos_holds_machine_claim >/dev/null && kosmos_holds_machine_claim; then
    echo "QUEUED-HEAVY $(date '+%H:%M:%S') $WHAT runs now, inside the turn that already holds the box (it claims and releases nothing)"
    # Review 13: the same clean command environment an ordinary turn gives (no queue controls, no side labels).
    unset ${KOSMOS_WAIT_CONTROL_VARS:-KOSMOS_NO_WAIT} KOSMOS_SIDE_CAPABLE KOSMOS_SIDE_AWARE 2>/dev/null
    exec "$@"
  fi
  unset KOSMOS_MACHINE_CLAIM_COOKIE   # a cookie whose claim is gone names nothing; this run takes its own
fi
if [ -n "$QH_INHERITED_SIDE" ] && command -v kosmos_holds_light_side >/dev/null \
   && KOSMOS_LIGHT_SIDE_COOKIE="$QH_INHERITED_SIDE" kosmos_holds_light_side; then
  echo "QUEUED-HEAVY $(date '+%H:%M:%S') REFUSED: $WHAT was started inside a light run's side turn; run it directly there, or queue it after (#4911)"
  exit 2
fi
CLAIM_MIN="${QUEUED_HEAVY_CLAIM_MIN:-30}"
RENEW_SEC="${QUEUED_HEAVY_RENEW_SEC:-600}"
MAX_RENEWALS="${QUEUED_HEAVY_MAX_RENEWALS:-12}"
case "$CLAIM_MIN" in ''|*[!0-9]*) CLAIM_MIN=30 ;; esac
case "$RENEW_SEC" in ''|*[!0-9]*) RENEW_SEC=600 ;; esac
case "$MAX_RENEWALS" in ''|*[!0-9]*) MAX_RENEWALS=12 ;; esac
_qh_clear() {
  kosmos_refuse_if_machine_claimed "$WHAT" || return 1
  # #4911: no main turn starts beside a light run's side turn, whatever its class: a light one would make two light
  # runs, and a heavy one never passed the side turn's gate (two Playwright runs, say). A side turn ends in minutes.
  if command -v kosmos_refuse_if_light_side_live >/dev/null; then
    kosmos_refuse_if_light_side_live "$WHAT" || return 1
  fi
  kosmos_refuse_if_suite_live "$WHAT" "" || return 1
  kosmos_refuse_if_harness_live "$WHAT" "" || return 1
  return 0
}
echo "QUEUED-HEAVY $(date '+%H:%M:%S') waiting for a turn: $WHAT (class ${KOSMOS_QUEUE_CLASS:-heavy})"
# The claim line is labelled "release ${V}" by the library; say plainly that this is not a cut.
# #4911: a light turn says so in its label, so a light run asking for a side turn never starts beside it.
if [ "${KOSMOS_QUEUE_CLASS:-}" = light ]; then export V="(not a cut) queued one-off [light]: $WHAT"; else export V="(not a cut) queued one-off: $WHAT"; fi
# #4911 (Splinter 20:40): an ordinary turn is not a release. With a lib that knows KOSMOS_CLAIM_LABEL the claim reads
# "queued run (not a cut): <what>" (kept: "(not a cut)" and "[light]" are what a side turn reads); an older lib keeps
# the V label above. NOT exported, so a command this runs (a cut) never inherits it for its own claim.
if [ "${KOSMOS_QUEUE_CLASS:-}" = light ]; then KOSMOS_CLAIM_LABEL="queued run (not a cut) [light]: $WHAT"; else KOSMOS_CLAIM_LABEL="queued run (not a cut): $WHAT"; fi
export -n KOSMOS_CLAIM_LABEL 2>/dev/null
export KOSMOS_SIDE_LABEL="$WHAT"
# #4911: a light run may take a SIDE turn beside a heavy holder (kosmos_light_side_clear in the lib says when).
# KOSMOS_SIDE_LANE=0, or a lib without the side turn, gives the old one-at-a-time queue.
SIDE_ARGS=()
# A side turn is CAPPED: its command is STOPPED after QUEUED_HEAVY_SIDE_MIN (default 10, at most 15) minutes, and its
# claim (not renewed) lasts two minutes longer, so it never lapses under a live run (review 2: a lapse let a second
# light run in beside one still running). The cap sits inside the 20-minute bound of the page layer, install harness
# and cut that wait for a side turn. A run that needs longer is not light: queue it without --light.
SIDE_MIN="${QUEUED_HEAVY_SIDE_MIN:-10}"
case "$SIDE_MIN" in ''|*[!0-9]*) SIDE_MIN=10 ;; esac
SIDE_MIN=$((10#$SIDE_MIN))   # review 4: 08 and 09 are not octal errors
[ "$SIDE_MIN" -ge 1 ] || SIDE_MIN=1
[ "$SIDE_MIN" -le 15 ] || SIDE_MIN=15
# Review 6: a command that runs tools/browser-checks.sh never takes a side turn. A heavy holder's page layer from a
# branch older than #4911 refuses on sight beside it (before the side turn could yield), turning the holder red. It
# takes an ordinary turn instead. `node docs/browser-checks/x.js` is unaffected (no older guard can see it, and the
# side turn yields to the holder's page layer).
# Round 6 (Sonnet): nor a command through tools/run-tests.sh (or `yarn test`): run-tests.sh refuses inside a side turn,
# so the same one-file run passed as a main turn and exited 2 as a side turn, by queue state alone. A command that
# reaches either through a wrapper script is not seen by this match (the plan names it).
QH_RUNS_BC=0
# Round 9: one rule over every WORD of every argument, so the same spellings are caught as separate arguments and
# inside one (sh -c 'npm t', 'yarn -s test a', 'npm run-script test', 'yarn  test', 'yarn run release 1.2.3'). After
# a package manager word, a later test / test:* / t / release / release:* word on the same command marks it; ; && ||
# and | end the command. Over-matching only sends a run to an ordinary turn, the safe side.
_qh_scan() {
  local w pm=0 words
  # Round 10: ; & | glued to a word (`yarn test; echo`, `cd /x&&yarn test`) become their own words first.
  words="$(printf '%s' "$*" | sed 's/[;&|]/ ; /g' | tr '(){}<>"$`'"'" '          ')"   # round 11: and ( ) { } < > quotes $ ` too
  set -f
  local prev=""
  for w in $words; do
    case "$prev" in */node) prev=node ;; esac
    case "$w" in
      *browser-checks.sh*|*run-tests.sh*|*test-install*|*release.sh*) QH_RUNS_BC=1 ;;   # round 19: test-install-gate-control.sh too
      yarn|*/yarn|yarnpkg|*/yarnpkg|npm|*/npm|pnpm|*/pnpm) pm=1 ;;
      bun|*/bun|deno|*/deno|npm-run-all|*/npm-run-all|run-s|*/run-s|run-p|*/run-p) pm=1 ;;   # round 16 (Opus): other script runners
      yarn@*|*/yarn@*|npm@*|pnpm@*|yarn.cmd|*/yarn.cmd|npm.cmd|*/npm.cmd|pnpm.cmd|*/pnpm.cmd|yarn.js|*/yarn.js|yarn-*.cjs|*/yarn-*.cjs) pm=1 ;;   # round 17 (Sonnet): corepack's yarn@1, Windows shims, a yarn release run by node
      --run|--run=*) [ "$prev" = node ] && pm=1 ;;                                           # and node --run <script> (round 18: --run=x)
      *npm-cli.js|*npx-cli.js|*pnpm.cjs) pm=1 ;;                                              # round 18 (Opus): npm run by node
      ';') pm=0 ;;
      test|test:*|t|tst|it|cit|sit|install-test|install-ci-test|clean-install-test|release|release:*) [ "$pm" = 1 ] && QH_RUNS_BC=1 ;;   # round 12: npm's test aliases
    esac
    prev="$w"
  done
  set +f
}
for _a in "$@"; do _qh_scan "$_a"; done
_qh_scan "$*"
[ "$QH_RUNS_BC" = 1 ] && [ "${KOSMOS_QUEUE_CLASS:-}" = light ] && echo "QUEUED-HEAVY $(date '+%H:%M:%S') $WHAT runs a page layer, a suite, an install harness or a cut, so it takes an ordinary turn, not a side turn (#4911)"
if [ "${KOSMOS_QUEUE_CLASS:-}" = light ] && [ "$QH_RUNS_BC" = 0 ] && [ "${KOSMOS_SIDE_LANE:-1}" != 0 ] && command -v kosmos_light_side_clear >/dev/null; then
  SIDE_ARGS=(--side kosmos_light_side_clear)
  export KOSMOS_SIDE_CAPABLE=1   # marker line 6: this waiter asks for side turns
fi
# #4609 (Renet, 2026-09-30): "clear" and "claimed" are ONE step, under a lock. The wait above ends by leaving the
# queue; the claim came after it. In between, the next waiter saw nobody ahead and no claim, and passed too: two
# light runs got one turn at 16:31:53 and refused each other. Now the last check and the claim happen together under
# a mkdir lock, and a run that finds the box taken goes back to waiting.
_qh_take() {
  local lock ; lock="$(_kosmos_marker_dir)/queued-heavy-take.lock"
  local i=0 op
  mkdir -p "$(_kosmos_marker_dir)" 2>/dev/null
  until mkdir "$lock" 2>/dev/null; do
    op="$(cat "$lock/pid" 2>/dev/null)"
    # A holder that died does not keep the lock; nor does one that never wrote its pid. That one is judged on
    # CONSECUTIVE empty reads only (about 10 s), so a new holder between its mkdir and its pid write is never taken
    # over on a count left by an earlier holder (Splinter's review).
    if [ -n "$op" ]; then i=0; kill -0 "$op" 2>/dev/null || rm -rf "$lock"
    else i=$((i + 1)); if [ "$i" -ge 20 ]; then rm -rf "$lock"; i=0; fi; fi
    sleep 0.5
  done
  echo "$$" > "$lock/pid"
  local rc=1
  if [ "${KOSMOS_WAIT_LANE:-main}" = side ]; then
    # Asked again under the lock (the wait asked outside it, and a main-lane light take holds this lock too), then
    # the side claim. Only a won take drops the queue marker; a lost one leaves it, and the next wait resumes that place.
    kosmos_light_side_take "$WHAT" "$((SIDE_MIN + 2))" && rc=0
  elif _qh_clear >/dev/null 2>&1; then kosmos_claim_machine "$CLAIM_MIN" && rc=0; fi
  rm -rf "$lock"
  return "$rc"
}
until { kosmos_wait_until_clear "$WHAT" --suite-queue ${SIDE_ARGS[@]+"${SIDE_ARGS[@]}"} _qh_clear || { echo "QUEUED-HEAVY $(date '+%H:%M:%S') REFUSED (the queue's bound ran out): $WHAT"; exit 4; }; _qh_take; }; do
  echo "QUEUED-HEAVY $(date '+%H:%M:%S') another run took the turn first; waiting again: $WHAT"
  # A side wait returns before any sleep, so a take that keeps losing (say, a marker dir it cannot write) would spin.
  # Side lane only: a main-lane loser has already left the queue, and a pause there only lets a later joiner past it.
  [ "${KOSMOS_WAIT_LANE:-main}" = side ] && sleep "${KOSMOS_WAIT_EVERY_S:-30}"
done
RENEWER=""
QH_STOPPED=""
QH_DESC=""
CMD=""
CAPPER=""
LANE="${KOSMOS_WAIT_LANE:-main}"
# Round 16 (Opus): a side command's descendant that leaves its process group (Playwright starts each browser detached,
# in its own session) outlives the group kill and would run on after the release. The capper notes, every poll, each
# descendant that leads its own group ("pid command" in QH_DESC); the stop and _qh_end kill those groups, but only a
# pid whose command is still the one noted (a recycled pid is not ours). One started and orphaned between two polls is
# not seen (the limit, stated).
# #4977 review 3: the wrapper is GONE (ESRCH), not merely unsignalable (EPERM in a sandbox): only then may its capper
# remove the temp files (removing the stop file under a live wrapper would read a stop as a pass).
# Review 4: a killed wrapper its parent has not reaped yet is a zombie, and macOS `kill -0` succeeds on one, so a
# zombie (ps state Z) is gone too.
_qh_wrapper_gone() {
  local e; e="$(LC_ALL=C kill -0 "$1" 2>&1)" || { case "$e" in *"No such process"*) return 0 ;; *) return 1 ;; esac; }   # C: the words, as cut-guard.sh's _kosmos_pid_gone
  case "$(ps -o stat= -p "$1" 2>/dev/null)" in Z*) return 0 ;; *) return 1 ;; esac
}
_qh_note_desc() {
  [ -n "${QH_DESC:-}" ] || return 0
  local q kids all="" p c g
  q="$1"
  while [ -n "$q" ]; do
    kids=""
    for p in $q; do kids="$kids $(pgrep -P "$p" 2>/dev/null | tr '\n' ' ')"; done
    all="$all $kids"; q="$(printf '%s' "$kids" | tr -s ' ')"; q="${q# }"; q="${q% }"
  done
  for p in $all; do
    g="$(ps -o pgid= -p "$p" 2>/dev/null | tr -d ' ')"
    [ "$g" = "$p" ] || continue
    c="$(ps -ww -o command= -p "$p" 2>/dev/null)"; [ -n "$c" ] || continue
    grep -qxF "$p $c" "$QH_DESC" 2>/dev/null || printf '%s %s\n' "$p" "$c" >> "$QH_DESC"
  done
}
_qh_kill_desc() {
  [ -n "${QH_DESC:-}" ] && [ -f "$QH_DESC" ] || return 0
  local p c
  while IFS=' ' read -r p c; do
    case "$p" in ''|*[!0-9]*) continue ;; esac
    [ "$(ps -ww -o command= -p "$p" 2>/dev/null)" = "$c" ] || continue
    kill -KILL -- "-$p" 2>/dev/null
  done < "$QH_DESC"
}
_qh_end() {
  trap '' TERM INT HUP PIPE   # review 4: a second signal during cleanup must not abandon it (the command would run on
                             # unclaimed); round 9: nor a reader that has gone (SIGPIPE at an echo below)
  [ -n "${QH_STOPPED:-}" ] && rm -f "$QH_STOPPED"
  # Stop the renewer and WAIT for it before releasing, so a renewal in flight cannot re-create the claim after
  # the release.
  if [ -n "$RENEWER" ]; then kill "$RENEWER" 2>/dev/null; wait "$RENEWER" 2>/dev/null; fi
  # A side command runs in its own process group, so a signal to this script does not reach it: stop whatever is
  # left of that group BEFORE the release (round 3), or it runs on uncapped and unclaimed. This also ends grandchildren
  # that outlived the command (one that ignored the cap's TERM) and stayed in its group; one that left the group (its
  # own session, as Playwright starts a browser) is ended by _qh_kill_desc, if the capper saw it.
  if [ "$LANE" = side ] && [ -n "$CMD" ] && kill -0 -- "-$CMD" 2>/dev/null; then
    kill -TERM -- "-$CMD" 2>/dev/null
    _i=0; while kill -0 -- "-$CMD" 2>/dev/null && [ "$_i" -lt 20 ]; do sleep 0.5; _i=$((_i + 1)); done
    kill -KILL -- "-$CMD" 2>/dev/null
  fi
  [ "$LANE" = side ] && _qh_kill_desc   # round 16 (Opus): what left the group (Playwright's detached browsers), before the release
  # Round 18 (Opus): the capper LAST, so a KILL of this script during the grace above still leaves the capper to see it
  # gone and finish the stop (it watches this pid). Round 10: KILL, not TERM: the capper holds nothing to clean up (the
  # command group is stopped above), and a TERM into its trap-reset subshell made bash 3.2 warn on most side turns.
  if [ -n "$CAPPER" ]; then kill -KILL -- "-$CAPPER" 2>/dev/null; wait "$CAPPER" 2>/dev/null; fi
  # Review 4: the stop file too, once the capper is gone (a yield in the window before could write it again).
  rm -f ${QH_STOPPED:+"$QH_STOPPED"} ${QH_DESC:+"$QH_DESC"}
  if [ "$LANE" = side ]; then kosmos_release_light_side; else kosmos_release_machine; fi
  echo "QUEUED-HEAVY $(date '+%H:%M:%S') claim released"
}
trap _qh_end EXIT
# A side turn: a signal exits through the EXIT trap, so a killed script still stops its side command (in its own
# process group, out of the signal's reach) and releases its claim. Not in a main turn: there bash would run the trap
# only after the foreground command ends, so `kill` would stop doing anything until then (review 3).
if [ "$LANE" = side ]; then trap 'exit 143' TERM; trap 'exit 130' INT; trap 'exit 129' HUP; fi
if [ "$LANE" = side ]; then
  echo "QUEUED-HEAVY $(date '+%H:%M:%S') SIDE TURN: running $WHAT beside the heavy holder (#4911; stopped if it runs past ${SIDE_MIN} min)"
else
  echo "QUEUED-HEAVY $(date '+%H:%M:%S') TURN: running $WHAT (machine claimed, renewed every ${RENEW_SEC}s while it runs)"
fi
if [ "$LANE" != side ]; then
(
  # The renewer (a main turn only: a side turn is capped, above). $$ here is still the main script's pid, so the claim keeps naming the main script as its holder.
  trap - EXIT
  sp=""
  trap '[ -n "$sp" ] && kill "$sp" 2>/dev/null; exit 0' TERM INT
  n=0
  while [ "$n" -lt "$MAX_RENEWALS" ]; do
    sleep "$RENEW_SEC" & sp=$!
    wait "$sp"; sp=""
    _qh_wrapper_gone "$$" && exit 0   # #4977 review 5: a zombie wrapper too (kill -0 succeeds on one), or it renews for hours
    # Round 11: a renewal keeps the label the claim carries (a cut run through this turn relabels it "release <v>").
    KOSMOS_CLAIM_KEEP_LABEL=1 kosmos_claim_machine "$CLAIM_MIN"
    n=$((n + 1))
  done
  echo "QUEUED-HEAVY $(date '+%H:%M:%S') STOPPED RENEWING after $n renewals (the claim lapses in ${CLAIM_MIN} min; the command is still running): $WHAT"
) &
RENEWER=$!   # the renewer's own pid (review 2: `[ ] || ( ) &` gave the pid of the list around it, and killing that left the
             # renewer running, so a renewal could re-create the claim after the release)
fi
# Review 4: the queue's own wait settings were for THIS script's wait; the command (a page layer, say) must wait on a
# side turn on its own terms, not inherit KOSMOS_NO_WAIT and refuse beside one. The lib names them.
unset ${KOSMOS_WAIT_CONTROL_VARS:-KOSMOS_NO_WAIT} 2>/dev/null
unset KOSMOS_SIDE_CAPABLE KOSMOS_SIDE_AWARE   # review 5: a command that queues on its own must not claim to be one of these
if [ "$LANE" = side ]; then
  # Round 20 (Opus): the stop file and the descendants list exist BEFORE the command starts, so a full disk refuses the
  # turn before anything ran, and a stop is recorded by WRITING to a file that exists (an empty file: not stopped).
  QH_STOPPED="$(mktemp "${TMPDIR:-/tmp}/qh-stopped.XXXXXXXXXX" 2>/dev/null || mktemp /tmp/qh-stopped.XXXXXXXXXX)" || QH_STOPPED=""   # #4977: under TMPDIR (macOS `mktemp -t` ignores it)
  if [ -z "${QH_STOPPED:-}" ]; then echo "QUEUED-HEAVY $(date '+%H:%M:%S') SIDE TURN NOT STARTED (nothing ran): no temporary file could be made (a full disk?); queue $WHAT again"; exit 75; fi
  QH_DESC="$(mktemp "${TMPDIR:-/tmp}/qh-desc.XXXXXXXXXX" 2>/dev/null || mktemp /tmp/qh-desc.XXXXXXXXXX)" || QH_DESC=""   # review 3: a stale TMPDIR falls back to /tmp
  # The command in its own process group (job control on for this one start), so the cap stops all of it.
  # stdin: the command keeps this script's, as a main turn does (review 10: `printf ... | queued-heavy.sh --light x sh`
  # ran nothing and ended green as a side turn). Only a TERMINAL is swapped for /dev/null: a background job that reads
  # a tty is stopped.
  if [ -t 0 ]; then set -m; "$@" </dev/null & CMD=$!; set +m
  else set -m; "$@" & CMD=$!; set +m; fi
  kosmos_publish_light_side_pgid "$CMD"       # review 5: a holder's page layer can tell this run's browser run apart
  # The capper runs in its OWN process group too, and is stopped by group: killing only the subshell could orphan the
  # sleep it had just forked. It polls every QUEUED_HEAVY_SIDE_POLL_S (5) seconds, short, so even an orphaned poll ends
  # at once. It stops the command at the cap, or EARLIER when kosmos_light_side_intruder says a browser run that is not
  # this side turn's has started (review 5: a heavy holder's page layer that starts after the side turn did, which an
  # older browser-checks.sh would run beside it). The light run takes the red, never the holder.
  POLL="${QUEUED_HEAVY_SIDE_POLL_S:-5}"; case "$POLL" in ''|*[!0-9]*|0) POLL=5 ;; esac
  [ "$POLL" -gt 60 ] && POLL=60   # round 18 (Sonnet): a long poll would outlive the side claim (SIDE_MIN + 2 min) before its first look
  set -m
  ( trap - EXIT TERM INT HUP; trap '' PIPE   # review 10: not the script's own signal traps (bash 3.2 warned)
    end=$(( $(date +%s) + SIDE_MIN * 60 )); why=""
    while [ "$(date +%s)" -lt "$end" ]; do
      sleep "$POLL" </dev/null >/dev/null 2>&1
      kill -0 "$CMD" 2>/dev/null || { _qh_wrapper_gone "$$" && rm -f "$QH_STOPPED" "$QH_DESC"; exit 0; }
      # Round 18 (Opus): the wrapper itself was killed (SIGKILL: no EXIT trap ran, and its side claim self-cleans by its
      # dead pid), so nothing holds the box for this command: stop it now, not at the cap. $$ is the wrapper's pid here.
      # #4977 review 5: "self-cleans" holds once the wrapper is REAPED; a zombie wrapper's claim still reads live to the
      # lib's liveness check (cut-guard.sh, kill -0) until its parent reaps it, at most the claim's own expiry. The
      # command is stopped either way; the lib's zombie gap is #4977 item 1's file, changed after #4911 merges.
      _qh_wrapper_gone "$$" && { why="the queued-heavy.sh that started it was killed"; break; }   # #4977 review 4: a zombie too
      _qh_note_desc "$CMD"
      if command -v kosmos_light_side_intruder >/dev/null && why="$(kosmos_light_side_intruder "$CMD")"; then break; fi
      why=""
    done
    kill -0 "$CMD" 2>/dev/null || { _qh_wrapper_gone "$$" && rm -f "$QH_STOPPED" "$QH_DESC"; exit 0; }
    # The stop file carries WHY (the script says it after the command has gone, so the line cannot be lost with this
    # capper, and it exits 75, try again later, not 143). Round 9: STOP FIRST, then record nothing that can block.
    # Said first, a reader that had gone (`| head`) killed the capper with SIGPIPE at the echo and the command ran on
    # past the yield and the cap (reproduced); SIGPIPE is ignored here anyway.
    printf '%s\n' "${why:-cap}" > "$QH_STOPPED" 2>/dev/null
    # Round 18 (Opus): the stop stands only if there was a group to stop (it had finished on its own otherwise).
    kill -TERM -- "-$CMD" 2>/dev/null || : > "$QH_STOPPED"
    sleep 10 </dev/null >/dev/null 2>&1; kill -KILL -- "-$CMD" 2>/dev/null; _qh_kill_desc
    # #4977 review 2: a KILLed wrapper never reaches _qh_end, so its two temp files would stay in $TMPDIR for good
    # (review 3: on every capper exit, and only when the wrapper is really gone).
    _qh_wrapper_gone "$$" && rm -f "$QH_STOPPED" "$QH_DESC" ) &
  CAPPER=$!; set +m
  wait "$CMD"; rc=$?
  kill -KILL -- "-$CAPPER" 2>/dev/null; wait "$CAPPER" 2>/dev/null
  # Round 6 (Sonnet): a yield or a cap exits 75 (EX_TEMPFAIL: try again later), so a caller can tell it from a red.
  # Round 18 (Opus): a recorded stop is 75 WHATEVER the command exits with. A command that traps TERM and exits 0 was
  # stopped part way and is not a pass (round 16 had kept rc 0 here). The capper records a stop only when it signalled a
  # live group, so a command that had already finished keeps its own rc; one that finished in the same instant costs a
  # safe re-run, never a false green.
  if [ -s "$QH_STOPPED" ]; then   # round 20: a written (non-empty) file is a recorded stop
    _why="$(cat "$QH_STOPPED" 2>/dev/null)"; rm -f "$QH_STOPPED"; rc=75
    if [ "$_why" = cap ] || [ -z "$_why" ]; then
      echo "QUEUED-HEAVY $(date '+%H:%M:%S') SIDE TURN CAPPED: $WHAT ran past ${SIDE_MIN} min and is stopped; a run this long is not light, queue it without --light. If it edits files (a perturbation), check its worktree: it was stopped mid-run"
    else
      echo "QUEUED-HEAVY $(date '+%H:%M:%S') SIDE TURN YIELDED: $WHAT is stopped because $_why. A side turn gives way to the heavy holder; queue it again. If it edits files (a perturbation), check its worktree: it was stopped mid-run"
    fi
  fi
else
  "$@"; rc=$?
fi
echo "QUEUED-HEAVY $(date '+%H:%M:%S') END rc=$rc: $WHAT"
exit $rc
