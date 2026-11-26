#!/bin/bash
# queued-heavy.sh "<what>" <command> [args...]
# Run a heavy one-off (a browser-check proof, a pre-push cargo test) as a REAL TURN in the same FIFO queue the
# suites use (Splinter 2026-09-30 02:10), instead of squeezing it in beside someone's suite:
#   1. wait with kosmos_wait_until_clear --suite-queue, so it holds a queue place and goes when no suite, harness
#      or machine claim is live and no earlier waiter is ahead (run-tests.sh's own check, _rt_box_clear, except that
#      run-tests.sh may start beside KOSMOS_SUITE_MAX - 1 other suites, #6334; this script's own _qh_clear waits
#      until none runs);
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
# that the two match. heavy-gate.sh's BUSY hint names that installed copy when it AND its lib exist, and a repo copy
# otherwise (#5446). That hint does not check that the lib is new enough (this script's own #5923 check below does),
# and the installed copy is not reviewed here.
# TO CHANGE THE INSTALLED COPY: write the new version beside it and mv it over. Never edit it in place: waiters are
# running it, and bash reads a script by byte offset, so an in-place edit kills them.
set -u
# #5467: while it waits, this process must not carry the wrapped command in its own command line. A hand-written
# "is X running?" check (pgrep -f X) read a waiter for X as a running X, and on 2026-10-07 a release that waited for
# running browser checks waited on a waiter that was waiting for the release (0.7.27, a deadlock a person had to break).
# So the first thing it does is write its arguments (NUL-separated, private to this user) to a file and exec itself
# with only that file's name; it reads them back and deletes the file at once. The command, once its turn comes,
# starts as its own process with its own command line, so the real run IS matched. Same pid throughout (exec), so a
# waiter marker or a pid someone holds stays right. Not covered: the CALLER's own command line (a `bash -c "...
# queued-heavy.sh ... browser-checks.sh"` shell) still carries it; anchor such checks to the start of the line. #5470 tracks
# one anchored helper for those checks.
# The cost: `ps` no longer says what a waiter waits for (its label went into the file too); its own log lines do.
# The re-exec is always /bin/bash with no options, on purpose (the fleet's one bash, the 3.2 this file is written for):
# a `bash -x queued-heavy.sh`, or one started under another bash, runs as plain /bin/bash from here.
if [ "${1:-}" = --queued-args ]; then
  [ "$#" -eq 2 ] || { echo "QUEUED-HEAVY: --queued-args is internal" >&2; exit 2; }   # review 4: nothing after the file
  _qh_af="${2:-}"
  # Its own file only: under TMPDIR or /tmp (the stale-TMPDIR fallback below), with no further path after the name.
  case "$_qh_af" in
    "${TMPDIR:-/tmp}"/queued-heavy-args.*/*|/tmp/queued-heavy-args.*/*) echo "QUEUED-HEAVY: --queued-args is internal" >&2; exit 2 ;;
    "${TMPDIR:-/tmp}"/queued-heavy-args.*|/tmp/queued-heavy-args.*) ;;
    *) echo "QUEUED-HEAVY: --queued-args is internal" >&2; exit 2 ;;
  esac
  # Review 4: not a symlink (-f and -O follow one, so a planted link could name any file of ours).
  [ ! -L "$_qh_af" ] && [ -f "$_qh_af" ] && [ -O "$_qh_af" ] || { echo "QUEUED-HEAVY: --queued-args file is missing or not ours" >&2; exit 2; }
  _qh_args=()
  while IFS= read -r -d '' _qh_a; do _qh_args+=("$_qh_a"); done < "$_qh_af"
  rm -f "$_qh_af"
  # printf writes at least one NUL, so there is always one argument; the guard is for a file emptied by hand (bash 3.2:
  # an empty array is unbound under set -u).
  if [ "${#_qh_args[@]}" -gt 0 ]; then set -- "${_qh_args[@]}"; else set --; fi
  unset _qh_af _qh_a _qh_args
else
  # Review 4: a TERM, INT or HUP before the re-exec removes the file it wrote (an exec drops these traps).
  _qh_af=""; trap '[ -n "$_qh_af" ] && rm -f "$_qh_af"' EXIT; trap 'exit 130' INT; trap 'exit 143' TERM; trap 'exit 129' HUP   # review 5: each signal's own code
  # Review 1: a stale TMPDIR (a folder since removed) falls back to /tmp, as the capper's files do below (review 3 there).
  _qh_af="$(umask 077 && { mktemp "${TMPDIR:-/tmp}/queued-heavy-args.XXXXXX" 2>/dev/null || mktemp /tmp/queued-heavy-args.XXXXXX; })" \
    || { echo "QUEUED-HEAVY: could not write its arguments aside (mktemp)" >&2; exit 3; }
  printf '%s\0' "$@" > "$_qh_af" || { rm -f "$_qh_af"; echo "QUEUED-HEAVY: could not write its arguments aside" >&2; exit 3; }
  trap - INT TERM HUP
  shopt -s execfail   # review 5: without it a failed exec ends this shell at once (126) and the line below never runs
  # Review 7: a script fed on stdin has no file to restart from; the exec below would then run nothing.
  [ -f "${BASH_SOURCE[0]:-}" ] || { rm -f "$_qh_af"; echo "QUEUED-HEAVY: run it as a file (bash tools/queued-heavy.sh), not on stdin" >&2; exit 3; }
  exec /bin/bash "${BASH_SOURCE[0]}" --queued-args "$_qh_af"
  _qh_rc=$?; rm -f "$_qh_af"   # by hand: bash clears the traps while it tries the exec (measured)
  echo "QUEUED-HEAVY: could not restart itself ($_qh_rc)" >&2; exit 3
fi
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
# The marker dir as the lib names it (_kosmos_marker_dir in cut-guard.sh; keep the two the same), needed before the lib
# is loaded (and, #9118, by --withdraw below).
_qh_marker_dir_raw() { printf '%s' "${KOSMOS_RUN_MARKER_DIR:-${HOME:-/tmp}/.cache/kosmos-run-markers}"; }
# #9118: a process's start, as one stable string, for the label file and --withdraw (the writer and the reader must use
# this same function). Review 2: on Linux from /proc/<pid>/stat field 22 (clock ticks since boot, fixed at fork); some
# procps compute lstart from "now minus uptime", which can read 1 s apart. Elsewhere (macOS) ps lstart, fixed at fork.
_qh_pid_start() {
  if [ -r "/proc/$1/stat" ]; then sed 's/.*) //' "/proc/$1/stat" 2>/dev/null | awk '{print "t" $20}'; return; fi
  TZ=UTC LC_ALL=C ps -o lstart= -p "$1" 2>/dev/null | tr -s ' ' | sed 's/^ //; s/ $//'
}
# kosmos#9118 item 1: `queued-heavy.sh --withdraw "<what>"` takes a run out by its label, waiting or holding the turn,
# instead of its owner finding and killing pids by hand (nine runs were moved that way on 11-25). Every run records its
# label in <marker dir>/qh-label.<pid> while it waits or runs (below). This sends a TERM to each LIVE queued-heavy.sh
# whose label is exactly "<what>": a waiter then leaves the queue; a holder stops its whole command and releases the
# claim (the stop above). It waits up to QUEUED_HEAVY_WITHDRAW_WAIT_S (default 90 s, past the 60 s grace) for them to
# end. Exit 0 when every one ended, 1 when no live run has that label, 3 when one is still ending at the bound, 5 when a
# matching run could not be verified or signalled (it says which), 4 when
# a matching run was NOT signalled because its command runs in the foreground (a terminal; see QH_FG below: a TERM
# there would release the claim and leave the command running, so it is refused, and said, instead).
# Exit 6: two or more live runs carry that label and --all was not given (all are listed, none signalled). The wait is
# at least QUEUED_HEAVY_WITHDRAW_WAIT_S (default 90 s) and never shorter than the longest withdrawn holder's grace + 30 s.
# The label file is four lines: the label, the state (waiting, bg or fg), the process's start time (as the lib's
# waiter markers record it) and its grace. Review 1: a pid is signalled only when it is alive, runs queued-heavy.sh AND has that same
# start time, so a reused pid (another run's renewer or watcher, any shell) is never signalled. A file whose pid is gone
# (ESRCH, not a refused probe) is stale and removed.
if [ "${1:-}" = --withdraw ]; then
  # Review 3: more than one live match is refused unless --all is given (labels are free text on a shared Mac, so one
  # owner's "store shots" can be another's too). The matches are listed (pid, state, age) so the owner can pick.
  _qw="${2:-}"; _qall=""; [ "${3:-}" = --all ] && _qall=1
  { [ -n "$_qw" ] && [ "$_qw" != --all ] && { [ "$#" = 2 ] || { [ "$#" = 3 ] && [ -n "$_qall" ]; }; }; } || { echo "usage: queued-heavy.sh --withdraw \"<what>\" [--all]" >&2; exit 2; }
  _qd="$(_qh_marker_dir_raw)"; _qn=0; _qp=""; _qfg=0; _qbad=0; _qc=""; _qcn=0; _qgmax=60; _qall_n=0; _qall_p=""
  _qgone() { local e; e="$(LC_ALL=C kill -0 "$1" 2>&1)" && { case "$(ps -o stat= -p "$1" 2>/dev/null)" in Z*) return 0 ;; esac; return 1; }; case "$e" in *"No such process"*) return 0 ;; *) return 1 ;; esac; }
  _qnot() { echo "QUEUED-HEAVY $(date '+%H:%M:%S') NOT withdrawn: $*"; }
  for _qf in "$_qd"/qh-label.*; do
    [ -e "$_qf" ] || continue   # an unmatched glob stays literal
    _q="${_qf##*/qh-label.}"
    case "$_q" in
      *.tmp) _qt="${_q%.tmp}"; case "$_qt" in ''|*[!0-9]*) ;; *) _qgone "$_qt" && rm -f "$_qf" ;; esac; continue ;;   # a dead run's .tmp (review 4: the pid is the name's middle)
      ''|*[!0-9]*) continue ;;
    esac
    [ "$_q" = "$$" ] && continue
    if _qgone "$_q"; then rm -f "$_qf"; continue; fi
    _ql1=""; _ql2=""; _ql3=""; _ql4=""
    if ! { IFS= read -r _ql1; IFS= read -r _ql2; IFS= read -r _ql3; IFS= read -r _ql4; true; } < "$_qf" 2>/dev/null; then
      # Review 4: a run that ended between the look and the read (any run, any label) is not a failure.
      { [ ! -e "$_qf" ] || _qgone "$_q"; } && continue
      _qnot "the label file of pid $_q could not be read"; _qbad=$((_qbad + 1)); continue
    fi
    [ "$_ql1" = "$_qw" ] || continue
    _qcmd="$(ps -ww -o command= -p "$_q" 2>/dev/null)"; _qnow="$(_qh_pid_start "$_q")"
    # Review 3: an EMPTY live read (ps refused, a hidden /proc) is "cannot verify", never "not a run".
    # Review 4: every live match counts for --all (below), signalable, foreground or unverifiable; a PROVEN reused pid
    # (another command, or another start time) is not a match.
    # Review 5: a run that ended during these reads is gone, not unverifiable.
    if { [ -z "$_qcmd" ] || [ -z "$_qnow" ]; } && _qgone "$_q"; then rm -f "$_qf"; continue; fi
    if [ -z "$_qcmd" ] || [ -z "$_qnow" ] || [ -z "$_ql3" ]; then
      _qnot "pid $_q ($_qw) could not be verified (no command line or start time)"; _qbad=$((_qbad + 1))
      _qall_n=$((${_qall_n:-0} + 1)); _qall_p="${_qall_p:-} $_q"; continue
    fi
    case "$_qcmd" in *queued-heavy.sh*) ;; *) continue ;; esac   # a reused pid running something else
    [ "$_qnow" = "$_ql3" ] || continue                             # a reused pid: not the run that wrote this label
    _qall_n=$((${_qall_n:-0} + 1)); _qall_p="${_qall_p:-} $_q"
    if [ "$_ql2" = fg ]; then
      _qnot "pid $_q ($_qw) runs its command in the foreground of a terminal; a TERM would not stop it. Stop it in that terminal (Ctrl-C)."
      _qfg=$((_qfg + 1)); continue
    fi
    _qc="$_qc $_q"; _qcn=$((_qcn + 1))
    case "$_ql4" in ''|*[!0-9]*) ;; *) [ "$_ql4" -gt "$_qgmax" ] && _qgmax="$_ql4" ;; esac
  done
  # Review 4: the count is every live match (signalable, foreground, unverifiable), not only the signalable ones: a
  # foreground twin left out of it let a colleague's background run be withdrawn without --all.
  if [ "${_qall_n:-0}" -gt 1 ] && [ -z "$_qall" ]; then
    echo "QUEUED-HEAVY $(date '+%H:%M:%S') NOT withdrawn: ${_qall_n} live runs are labelled \"$_qw\"; nothing was signalled. They are:"
    for _q in $_qall_p; do echo "  pid $_q: $(sed -n 2p "$_qd/qh-label.$_q" 2>/dev/null), running for $(ps -o etime= -p "$_q" 2>/dev/null | tr -d ' ')"; done
    echo "  Withdraw all of them with: queued-heavy.sh --withdraw \"$_qw\" --all"
    exit 6
  fi
  for _q in $_qc; do
    if kill -TERM "$_q" 2>/dev/null; then _qp="$_qp $_q"; _qn=$((_qn + 1)); echo "QUEUED-HEAVY $(date '+%H:%M:%S') withdrawing pid $_q: $_qw"
    else _qnot "pid $_q ($_qw) could not be signalled"; _qbad=$((_qbad + 1)); fi
  done
  # Exit codes: 1 only when nothing live matched at all; 5 a match could not be verified or signalled; 4 a fg holder.
  if [ "$_qn" = 0 ]; then
    [ "$_qbad" -gt 0 ] && exit 5; [ "$_qfg" -gt 0 ] && exit 4
    echo "QUEUED-HEAVY $(date '+%H:%M:%S') no live run labelled \"$_qw\" to withdraw (a run started by an older installed queued-heavy.sh records no label)"; exit 1
  fi
  # Review 3: the wait covers the longest grace a withdrawn holder recorded (its label's line 4), plus 30 s.
  _qe="${QUEUED_HEAVY_WITHDRAW_WAIT_S:-90}"; case "$_qe" in ''|*[!0-9]*|?????*) _qe=90 ;; esac; _qe=$((10#$_qe))
  [ "$_qe" -ge $((_qgmax + 30)) ] || _qe=$((_qgmax + 30))
  _qe=$(( $(date +%s) + _qe ))
  while :; do
    _ql=""; for _q in $_qp; do _qgone "$_q" || _ql="$_ql $_q"; done   # review 1: a zombie counts as ended
    # Review 5: one that took its turn in the foreground just before the TERM records it and runs to its end: say so.
    _qnl=""; for _q in $_ql; do
      if [ "$(sed -n 2p "$_qd/qh-label.$_q" 2>/dev/null)" = fg ]; then
        _qnot "pid $_q ($_qw) took its turn in the foreground just before the TERM; it runs to its end. Stop it in that terminal (Ctrl-C)."
        _qfg=$((_qfg + 1)); _qn=$((_qn - 1))
      else _qnl="$_qnl $_q"; fi
    done; _ql="$_qnl"; _qp="$_qnl"
    [ -n "${_ql// /}" ] || break
    [ "$(date +%s)" -lt "$_qe" ] || { echo "QUEUED-HEAVY $(date '+%H:%M:%S') still ending at the bound:$_ql ($_qw)"; exit 3; }
    sleep 0.5
  done
  [ "$_qn" -gt 0 ] && echo "QUEUED-HEAVY $(date '+%H:%M:%S') withdrew $_qn run(s) labelled \"$_qw\""   # review 6: never "withdrew 0"
  [ "$_qbad" -gt 0 ] && exit 5; [ "$_qfg" -gt 0 ] && exit 4; exit 0
fi
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
# to sit at origin/main; the #5923 block below checks it on every join and moves it when that is safe.
LIB_CHECKOUT="${QUEUED_HEAVY_LIB:-$HOME/work/kosmos-bc-main-4610}"
# #5446: that default folder exists on one Mac only, so elsewhere a REPO copy of this script died here (exit 3) before
# joining the queue. With QUEUED_HEAVY_LIB unset (or empty) and no cut-guard.sh in the default, a repo copy uses the MAIN checkout
# of the repo it is in (common dir ending in /.git); every worktree of one clone resolves that same folder. A second
# clone, or a run with QUEUED_HEAVY_LIB set, can still bring another lib generation; the line below names the folder
# and its commit so that is visible. A copy outside any repo (the installed one under ~/.cache), a bare-repo worktree
# or a submodule has no such checkout and still exits 3 as before, as does a QUEUED_HEAVY_LIB that is set and wrong.
# The main checkout is not guaranteed to be on main, so the line names its branch too. --path-format needs git 2.31 or
# newer; an older git does not reach a working fallback and still exits 3, with a garbled path in its message (every
# fleet Mac runs a newer git).
# heavy-gate.sh's BUSY hint looks for this marker before it names a main checkout's copy: #5446-lib-fallback
QH_LIB_FALLBACK=""
QH_MAIN_TRIED=""
# #5923: not when the default folder is a git checkout. A #5923 move there recreates cut-guard.sh, and a run reading in
# that instant would fall back to a different lib; such a checkout that really lacks it exits 3 at the load below.
if [ -z "${QUEUED_HEAVY_LIB:-}" ] && [ ! -f "$LIB_CHECKOUT/tools/lib/cut-guard.sh" ] && [ ! -e "$LIB_CHECKOUT/.git" ]; then
  _qh_common="$(env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR git -C "$(dirname "$0")" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || _qh_common=""
  case "$_qh_common" in
    */.git) if [ -f "${_qh_common%/.git}/tools/lib/cut-guard.sh" ]; then
              echo "QUEUED-HEAVY: $LIB_CHECKOUT has no tools/lib/cut-guard.sh; using this repo's main checkout ${_qh_common%/.git} at $(env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR git -C "${_qh_common%/.git}" rev-parse --short HEAD 2>/dev/null || echo '?') on $(env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR git -C "${_qh_common%/.git}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?') for the queue's guards (set QUEUED_HEAVY_LIB to choose)" >&2
              LIB_CHECKOUT="${_qh_common%/.git}"; QH_LIB_FALLBACK=1
            else QH_MAIN_TRIED="${_qh_common%/.git}"
            fi ;;
  esac
  unset _qh_common
fi
# #5923: that shared checkout sat five days and 2,058 commits behind main, and nothing said so. On every join, compare
# the two files the queue loads (cut-guard.sh and the process-fixture.sh it sources), as they are on disk, with
# origin/main's:
# commit distance is the wrong measure (2,058 commits behind and both files unchanged). origin/main is read from the
# checkout's own refs; on Agent1s it is a worktree of ~/work/kosmos, whose refs every agent fetches. Nothing is fetched.
# Only the DEFAULT checkout (QUEUED_HEAVY_LIB unset, no #5446 fallback) is ever moved, and only when moving it cannot
# put two lib generations in one queue (#4977): detached and clean, no other queued-heavy.sh process (waiter or
# holder), and no queue marker (suitewait.*, a machine claim, a side claim). A stale marker only blocks the move; the
# line says why and this run joins on the lib as it is. The check, the move and the load below are one step under a
# lock (the residuals of its takeover are in the plan, .claude/plans/libdrift-5923.md).
# Weakest premise: a process is matched only as `<shell> <path>/queued-heavy.sh ...` or a direct exec of it (what a
# waiter shows, before and after its #5467 re-exec), split on spaces. A path with a space is not seen, nor (for the
# instant before its re-exec) one started with shell options before the path or through `env bash`.
# This run and its direct children are not counted (the subshell of the `out="$(ps ...)"` substitution below keeps
# this script's argv; keep ps in that substitution, not deeper in a pipeline, or a grandchild carries it too).
# A copy of this script older than #5923 takes no lock here, so one that STARTS during a move is not held off by it.
# Test seams, never set in production: QH_TEST_PS names a command printing "pid ppid command" lines in place of ps;
# QH_TEST_PS_NAME replaces the script name matched (queued-heavy.sh), so a test sees only its own processes;
# QH_TEST_CWD names a command printing lsof -Fn style lines (n<directory>) in place of the working-directory probe;
# QH_TEST_MOVE_FAIL stands in for a checkout stopped part way (=nochange: one that failed before touching anything);
# QH_TEST_RESTORE_FAIL stands in for the forced checkout back failing too.
# All five are ignored when HOME is this user's real home (every test arm runs under a scratch HOME), so one left
# exported in a shell cannot swap out a safety probe or append to the shared lib.
QH_LIB_LOCK=""
# The functions this script calls unguarded from the lib (checked again after the load, below). Before a move they
# are looked for in origin/main's cut-guard.sh only, as `name()` or `function name()` at the start of a line: one moved
# to process-fixture.sh, or indented, would refuse every move (safely, and the line names it) until this check follows.
QH_NEED_BASE="kosmos_wait_until_clear kosmos_mark_suite_waiting kosmos_unmark_suite_waiting kosmos_refuse_if_earlier_suite_waiter _kosmos_suite_waiter_file kosmos_claim_machine kosmos_release_machine kosmos_refuse_if_machine_claimed kosmos_refuse_if_suite_live kosmos_refuse_if_harness_live _kosmos_marker_dir"
# GIT_OPTIONAL_LOCKS=0: a status here must not take the index lock another git in that checkout may want.
# GIT_CEILING_DIRECTORIES: git must never walk up out of the lib folder to an enclosing repo (a lib that lost its .git,
# or whose .git is not a repo, would otherwise be read, and moved, as some other checkout). Built from the RESOLVED path,
# because git compares the ceiling with the physical one: a symlinked lib path would otherwise not stop it.
_qh_libgit() { env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE GIT_OPTIONAL_LOCKS=0 GIT_CEILING_DIRECTORIES="$(dirname "$(CDPATH= cd -- "$LIB_CHECKOUT" 2>/dev/null && pwd -P || printf '%s' "$LIB_CHECKOUT")")" git -C "$LIB_CHECKOUT" "$@"; }
_qh_lib_check() {
  # The files the queue loads: cut-guard.sh and what it sources itself (process-fixture.sh, at its top). Kept by hand:
  # if cut-guard.sh ever sources another lib file, add it here, or this check says "match" while that file differs.
  local files="tools/lib/cut-guard.sh tools/lib/process-fixture.sh" f head main diff="" why="" p="" g=_qh_libgit
  local rh; rh="$(eval "printf '%s' ~$(id -un)" 2>/dev/null)"   # the account's home, by name (not $HOME)
  rh="$(CDPATH= cd -- "$rh" 2>/dev/null && pwd -P)"   # both resolved, so a trailing slash or a symlinked spelling still matches
  if [ -z "$rh" ] || [ "$(CDPATH= cd -- "${HOME:-/}" 2>/dev/null && pwd -P)" = "$rh" ]; then   # the real home (or unknown): no test seams
    local QH_TEST_PS="" QH_TEST_CWD="" QH_TEST_PS_NAME="" QH_TEST_MOVE_FAIL="" QH_TEST_RESTORE_FAIL=""
  fi
  [ -e "$LIB_CHECKOUT/.git" ] || return 0   # not a git checkout (a test fixture): nothing to say, and nothing above it is read
  head="$($g rev-parse --verify -q HEAD 2>/dev/null)" || {
    echo "QUEUED-HEAVY $(date '+%H:%M:%S') lib $LIB_CHECKOUT: git could not read this checkout, so it is loaded unchecked (#5923)"; return 0; }
  main="$($g rev-parse --verify -q refs/remotes/origin/main 2>/dev/null)" || { echo "QUEUED-HEAVY $(date '+%H:%M:%S') lib $LIB_CHECKOUT at ${head:0:9}; it has no origin/main to compare with (#5923)"; return 0; }
  # The files on disk (what is sourced), against origin/main's.
  for f in $files; do
    $g diff --quiet "$main" -- "$f" >/dev/null 2>&1 || diff="${diff:+$diff, }${f##*/}"
  done
  if [ -z "$diff" ]; then
    echo "QUEUED-HEAVY $(date '+%H:%M:%S') lib $LIB_CHECKOUT at ${head:0:9}: the queue's files match origin/main ${main:0:9} (#5923)"
    return 0
  fi
  if [ -n "${QUEUED_HEAVY_LIB:-}" ] || [ -n "$QH_LIB_FALLBACK" ]; then why="it is not the default shared checkout"
  elif $g symbolic-ref -q HEAD >/dev/null 2>&1; then why="it is on a branch, not detached"
  elif [ -n "$($g status --porcelain --untracked-files=no 2>/dev/null)" ]; then why="it has local changes"
  elif ! $g merge-base --is-ancestor "$head" "$main" 2>/dev/null; then why="its commit is not behind origin/main (ahead or diverged)"
  else
    local d m; d="$(_qh_marker_dir_raw)"
    for m in "$d"/suitewait.* "$d/machine-claim" "$d/light-side-claim"; do   # an unmatched glob stays literal, so -e is false
      [ -e "$m" ] && { why="a queue marker is present (${m##*/})"; break; }
    done
    if [ -z "$why" ]; then
      local out=""
      # A ps that fails or prints nothing must not read as "nothing live": it always lists at least this run.
      out="$(${QH_TEST_PS:-ps -axww -o pid= -o ppid= -o command=} 2>/dev/null)" || out=""
      if [ -z "$out" ]; then
        why="could not list processes"
      else
        p="$(printf '%s\n' "$out" | awk -v me="$$" -v nm="${QH_TEST_PS_NAME:-queued-heavy.sh}" '
          function isq(w) { return w == nm || (length(w) > length(nm) && substr(w, length(w) - length(nm)) == "/" nm) }
          $1 != me && $2 != me && (isq($3) || ($3 ~ /(^|\/)(ba|z|da|k)?sh$/ && isq($4))) { print $1; exit }')"
      fi
      [ -n "$p" ] && why="another queued-heavy.sh is live (pid $p)"
    fi
    # A move replaces the whole tree, so nothing may be working inside it: a process whose working directory is in the
    # checkout (a browser check or a board started there by hand) blocks it. An empty answer blocks it too.
    if [ -z "$why" ]; then
      local real cw=""
      real="$(CDPATH= cd -- "$LIB_CHECKOUT" 2>/dev/null && pwd -P)" || real=""
      cw="$(${QH_TEST_CWD:-lsof -bnP -d cwd -Fn} 2>/dev/null)"
      if [ -z "$real" ] || [ -z "$cw" ]; then why="could not list working directories"
      else
        p="$(printf '%s\n' "$cw" | awk -v a="n$real" -v b="n$LIB_CHECKOUT" '
          /^p/ { pid = substr($0, 2) }
          $0 == a || $0 == b || index($0, a "/") == 1 || index($0, b "/") == 1 { print pid; exit }')"
        if [ -n "$p" ] && { [ "$p" = "$$" ] || [ "$p" = "$PPID" ]; }; then why="this run or its caller is working inside it (pid $p)"
        elif [ -n "$p" ]; then why="a process is working inside it (pid $p)"; fi
      fi
    fi
  fi
  # Origin/main's lib must still define every function this copy calls unguarded (QH_NEED_BASE), or the move would
  # make every later join exit 3 until this copy (the installed one, say) is updated too.
  if [ -z "$why" ]; then
    local fn tgt need="$QH_NEED_BASE"; tgt="$($g show "$main:tools/lib/cut-guard.sh" 2>/dev/null)"
    # And the side lane's, which the load below requires when the lib offers side turns. Matched as `name()` or
    # `function name()` at the start of a line; any other spelling reads as missing, and the move is refused.
    printf '%s\n' "$tgt" | grep -qE '^(function )?kosmos_light_side_clear ?\(\)' && need="$need kosmos_light_side_take kosmos_publish_light_side_pgid kosmos_release_light_side"
    [ -n "$tgt" ] || why="could not read origin/main's cut-guard.sh"
    for fn in $need; do
      [ -n "$why" ] && break
      printf '%s\n' "$tgt" | grep -qE "^(function )?$fn ?\(\)" || { why="origin/main's cut-guard.sh has no $fn, which this copy calls; update this copy first"; break; }
    done
    # The INSTALLED copy (what agents run) must also find every function it calls unguarded, or a repo copy's move
    # would make every join of the installed copy exit 3 until someone reinstalls it. It names them in its own
    # QH_NEED_BASE; an installed copy with no such line predates this check, so its needs are unknown: no move.
    local inst="$HOME/.cache/claude-handoffs/queued-heavy.sh" ineed
    if [ -z "$why" ] && [ -f "$inst" ] && ! [ "$inst" -ef "${BASH_SOURCE[0]}" ]; then
      ineed="$(sed -n 's/^QH_NEED_BASE="\(.*\)"$/\1/p' "$inst" 2>/dev/null | head -1)"
      if [ -z "$ineed" ]; then why="the installed copy $inst predates this check, so what it needs is unknown; install this copy first"
      else
        for fn in $ineed; do
          printf '%s\n' "$tgt" | grep -qE "^(function )?$fn ?\(\)" || { why="origin/main's cut-guard.sh has no $fn, which the installed copy $inst calls; update it first"; break; }
        done
      fi
    fi
  fi
  if [ -z "$why" ]; then
    # The checkout runs as its own process group (job control on for this one start), so a Ctrl-C at the terminal
    # does not reach git; bash ignores INT, TERM and HUP while it waits. git sets its own handlers, so a signal sent
    # to git itself still stops it part way: then the old commit is checked out again, by force, and the line says so.
    local mrc=0 gp gerr qtraps
    gerr="$(mktemp "${TMPDIR:-/tmp}/qh-libmove.XXXXXX" 2>/dev/null || mktemp /tmp/qh-libmove.XXXXXX)" || gerr=/dev/null
    # Whatever INT, TERM and HUP traps are set now (none today: the EXIT and signal traps come later) are saved and
    # put back after. The ignored signals are inherited by git, which installs its own handlers, so a signal sent to
    # git itself still stops it.
    qtraps="$(trap -p INT TERM HUP)"
    trap '' INT TERM HUP
    if [ "${QH_TEST_MOVE_FAIL:-}" = nochange ]; then mrc=128   # test seam: a checkout that failed before changing anything
    elif [ -n "${QH_TEST_MOVE_FAIL:-}" ]; then
      echo '# a partial move' >> "$LIB_CHECKOUT/tools/lib/cut-guard.sh"; mrc=1   # test seam: a checkout stopped part way
    else
      set -m
      $g -c core.hooksPath=/dev/null checkout -q --detach "$main" </dev/null >/dev/null 2>"$gerr" &   # off the terminal: a stopped job (SIGTTIN/TTOU) would hang the wait
      gp=$!
      set +m
      # git runs in its own group, so it outlives a wrapper KILLed (or ALRMed) mid-checkout. The pid recorded is the
      # subshell running git ($g is a function), which lives exactly as long as that git; in the lock it keeps a joiner
      # from taking the lock over (and loading a half-written lib) while git is still writing.
      [ -n "$QH_LIB_LOCK" ] && { ps -ww -o command= -p "$gp" > "$QH_LIB_LOCK/gitcmd"; echo "$gp" > "$QH_LIB_LOCK/gitpid"; } 2>/dev/null
      wait "$gp" || mrc=$?
      [ -n "$QH_LIB_LOCK" ] && rm -f "$QH_LIB_LOCK/gitpid" "$QH_LIB_LOCK/gitcmd"   # git has exited: nothing left to wait for
    fi
    if [ "$mrc" = 0 ]; then
      trap - INT TERM HUP; [ -n "$qtraps" ] && eval "$qtraps"
      [ "$gerr" = /dev/null ] || rm -f "$gerr"   # never remove /dev/null (the fallback when mktemp fails)
      echo "QUEUED-HEAVY $(date '+%H:%M:%S') lib $LIB_CHECKOUT moved ${head:0:9} -> origin/main ${main:0:9}: ${diff} differed and no queue waiter, claim or process inside it was live (#5923; back with: git -C '$LIB_CHECKOUT' checkout --detach $head)"
      return 0
    fi
    local gmsg; gmsg="$(head -c 300 "$gerr" 2>/dev/null | tr '\n' ' ')"; [ "$gerr" = /dev/null ] || rm -f "$gerr"
    # Forced back to the old commit: this discards any tracked edit made inside the checkout since the clean check above.
    # Run like the move (its own group, off the terminal, INT/TERM/HUP still ignored here), so a Ctrl-C cannot stop it
    # part way either.
    local rok=no rp
    if [ -z "${QH_TEST_RESTORE_FAIL:-}" ]; then
      set -m
      $g -c core.hooksPath=/dev/null checkout -q -f --detach "$head" </dev/null >/dev/null 2>&1 &
      rp=$!
      set +m
      [ -n "$QH_LIB_LOCK" ] && { ps -ww -o command= -p "$rp" > "$QH_LIB_LOCK/gitcmd"; echo "$rp" > "$QH_LIB_LOCK/gitpid"; } 2>/dev/null
      wait "$rp" && [ -z "$($g status --porcelain --untracked-files=no 2>/dev/null)" ] && rok=yes
      [ -n "$QH_LIB_LOCK" ] && rm -f "$QH_LIB_LOCK/gitpid" "$QH_LIB_LOCK/gitcmd"
    fi
    trap - INT TERM HUP; [ -n "$qtraps" ] && eval "$qtraps"
    if [ "$rok" = yes ]; then
      why="git checkout failed (rc $mrc${gmsg:+: $gmsg}) and the checkout was put back at ${head:0:9}"
    # The checkout back failed too (the same index.lock, say), but nothing had changed: still at the old commit, no
    # tracked file differing from it (diff exits non-zero on a difference AND on an error, so an error reads as MIXED).
    elif [ "$($g rev-parse --verify -q HEAD 2>/dev/null)" = "$head" ] && $g diff --quiet HEAD -- >/dev/null 2>&1; then
      why="git checkout failed (rc $mrc${gmsg:+: $gmsg}) and left the checkout unchanged at ${head:0:9}"
    else
      echo "QUEUED-HEAVY $(date '+%H:%M:%S') lib $LIB_CHECKOUT: the move to origin/main ${main:0:9} FAILED PART WAY (rc $mrc${gmsg:+: $gmsg}) and could not be put back, so its files may be MIXED; repair with: git -C '$LIB_CHECKOUT' checkout -f --detach $head (#5923)"
      return 0
    fi
  fi
  echo "QUEUED-HEAVY $(date '+%H:%M:%S') lib $LIB_CHECKOUT at ${head:0:9} DIFFERS from origin/main ${main:0:9} (${diff}); not moved ($why), so this run joins on the lib as it is (#5923)"
}
# Removes the lib lock only while it is still this run's (a joiner may have taken it over).
_qh_lib_unlock() { [ -n "$QH_LIB_LOCK" ] && [ "$(cat "$QH_LIB_LOCK/pid" 2>/dev/null)" = "$$" ] && rm -rf "$QH_LIB_LOCK"; return 0; }
mkdir -p "$(_qh_marker_dir_raw)" 2>/dev/null
if ! command -v git >/dev/null 2>&1; then
  echo "QUEUED-HEAVY $(date '+%H:%M:%S') git is not installed, so the lib is loaded unchecked (#5923)"
elif [ ! -w "$(_qh_marker_dir_raw)" ]; then
  echo "QUEUED-HEAVY $(date '+%H:%M:%S') the marker dir $(_qh_marker_dir_raw) is not writable, so the lib is loaded unchecked (#5923)"
else
  QH_LIB_LOCK="$(_qh_marker_dir_raw)/queued-heavy-lib.lock"
  _qh_i=0; _qh_empty=0; _qh_gone=""
  # As _qh_take's lock: a dead holder's lock is taken over, and so is one with no pid for 20 CONSECUTIVE reads (a new
  # holder between its mkdir and its pid write is never taken over). A holder also records its command line; a live
  # pid running another command is a reused pid, and its lock is taken over too. Past 600 reads (about 5 min) this run
  # gives up the lock and loads the lib unchecked.
  until mkdir "$QH_LIB_LOCK" 2>/dev/null; do
    _qh_op="$(cat "$QH_LIB_LOCK/pid" 2>/dev/null)"
    if [ -n "$_qh_op" ]; then _qh_empty=0
      # A reused pid is a live one whose command (read, so not empty) differs from the one recorded.
      _qh_oc="$(ps -ww -o command= -p "$_qh_op" 2>/dev/null)"
      if ! kill -0 "$_qh_op" 2>/dev/null \
         || { [ -s "$QH_LIB_LOCK/cmd" ] && [ -n "$_qh_oc" ] && [ "$_qh_oc" != "$(cat "$QH_LIB_LOCK/cmd" 2>/dev/null)" ]; }; then
        # Only if it is still that holder's lock (another joiner may have just taken it over), and no git it started is
        # still checking out (a dead holder's git keeps writing in its own group).
        # Also not while the lib's index.lock exists: a running checkout holds it once git has started, which covers
        # the instant between git creating it and its pid reaching the lock. Not covered: a holder KILLed after the
        # fork and before git creates index.lock (tens of ms; the accepted wrapper-KILL residual, iteration 24). A lock
        # left by a git that was itself killed blocks until the 5-minute give-up below, as it blocks every git anyway.
        # The gitpid is removed once git exits, and a live pid running another command than the one recorded
        # (gitcmd) is a reused pid, not that git (iteration 23): so a dead holder's long-gone git cannot hold the
        # lock for good by its number landing on an unrelated process. gitcmd is written before gitpid (iteration 24),
        # so a pid is never on record without its command.
        _qh_gp="$(cat "$QH_LIB_LOCK/gitpid" 2>/dev/null)"
        _qh_gl=no
        if [ -n "$_qh_gp" ] && kill -0 "$_qh_gp" 2>/dev/null; then
          _qh_gl=yes
          _qh_gc="$(cat "$QH_LIB_LOCK/gitcmd" 2>/dev/null)"
          [ -n "$_qh_gc" ] && [ "$(ps -ww -o command= -p "$_qh_gp" 2>/dev/null)" != "$_qh_gc" ] && _qh_gl=no
        fi
        _qh_gd="$(_qh_libgit rev-parse --absolute-git-dir 2>/dev/null)"
        if [ "$_qh_gl" = no ] && { [ -z "$_qh_gd" ] || [ ! -e "$_qh_gd/index.lock" ]; }; then
          [ "$(cat "$QH_LIB_LOCK/pid" 2>/dev/null)" = "$_qh_op" ] && rm -rf "$QH_LIB_LOCK"
        fi
      fi
    else
      # Counted per lock dir (its inode): a new holder's fresh dir restarts the count, so its mkdir-to-pid gap is safe.
      _qh_ino="$(ls -di "$QH_LIB_LOCK" 2>/dev/null)"; _qh_ino="${_qh_ino%% *}"
      [ "$_qh_ino" = "${_qh_lastino:-}" ] || _qh_empty=0
      _qh_lastino="$_qh_ino"; _qh_empty=$((_qh_empty + 1))
      if [ "$_qh_empty" -ge 20 ]; then
        _qh_ino2="$(ls -di "$QH_LIB_LOCK" 2>/dev/null)"
        [ "${_qh_ino2%% *}" = "$_qh_ino" ] && [ ! -s "$QH_LIB_LOCK/pid" ] && rm -rf "$QH_LIB_LOCK"   # still that pid-less dir
        _qh_empty=0
      fi
    fi
    _qh_i=$((_qh_i + 1)); [ "$_qh_i" -ge 600 ] && { QH_LIB_LOCK=""; break; }
    [ -d "${QH_LIB_LOCK%/*}" ] || { QH_LIB_LOCK=""; _qh_gone=1; break; }   # the marker dir itself is gone: no lock can be taken, so stop at once
    sleep 0.5
  done
  if [ -n "$QH_LIB_LOCK" ]; then
    ps -ww -o command= -p "$$" > "$QH_LIB_LOCK/cmd" 2>/dev/null
    echo "$$" > "$QH_LIB_LOCK/pid"
    _qh_lib_check
  elif [ -n "${_qh_gone:-}" ]; then
    echo "QUEUED-HEAVY $(date '+%H:%M:%S') the queue marker dir went away while waiting for the lib check's lock; loading the lib unchecked (#5923)"
  else
    echo "QUEUED-HEAVY $(date '+%H:%M:%S') the lib check's lock stayed taken for 5 min (holder pid ${_qh_op:-?}); loading the lib unchecked, possibly in the middle of a move (#5923)"
  fi
  unset _qh_i _qh_op _qh_oc _qh_empty _qh_ino _qh_ino2 _qh_lastino _qh_gp _qh_gl _qh_gc _qh_gd _qh_gone
fi
. "$LIB_CHECKOUT/tools/lib/cut-guard.sh" || {
  _qh_lib_unlock
  echo "QUEUED-HEAVY: could not load cut-guard.sh from $LIB_CHECKOUT (set QUEUED_HEAVY_LIB to a checkout of origin/main)" >&2
  # #5446: the main-checkout fallback was tried and that checkout has no lib either (it predates it).
  [ -n "$QH_MAIN_TRIED" ] && echo "QUEUED-HEAVY: this repo's main checkout $QH_MAIN_TRIED has none either; if it is on main, bring it up to date with: git -C '$QH_MAIN_TRIED' pull --ff-only" >&2
  # #5923: the default folder is a git checkout, so the #5446 fallback was not tried (a move there must not hand a run another lib).
  [ -z "${QUEUED_HEAVY_LIB:-}" ] && [ -z "$QH_LIB_FALLBACK" ] && [ -e "$LIB_CHECKOUT/.git" ] && echo "QUEUED-HEAVY: $LIB_CHECKOUT is a git checkout, so the fallback to this repo's own checkout is off for it (#5923); bring it up to date with: git -C '$LIB_CHECKOUT' fetch -q origin && git -C '$LIB_CHECKOUT' checkout --detach origin/main" >&2
  exit 3; }
_qh_lib_unlock   # #5923: loaded, so a move by the next joiner can no longer reach this run
# The functions called unguarded: every run's, then the side lane's (it is offered only when kosmos_light_side_clear exists).
_qh_need="$QH_NEED_BASE"
declare -F kosmos_light_side_clear >/dev/null && _qh_need="$_qh_need kosmos_light_side_take kosmos_publish_light_side_pgid kosmos_release_light_side"
for _qh_fn in $_qh_need; do
  declare -F "$_qh_fn" >/dev/null || {
    echo "QUEUED-HEAVY: cut-guard.sh in $LIB_CHECKOUT has no $_qh_fn (an old checkout? set QUEUED_HEAVY_LIB to a checkout of origin/main)" >&2
    # #5446: the main checkout nothing updates; say the one command that brings it current.
    [ -n "$QH_LIB_FALLBACK" ] && echo "QUEUED-HEAVY: that is this repo's main checkout, older than this script; if it is on main, bring it up to date with: git -C '$LIB_CHECKOUT' pull --ff-only (or set QUEUED_HEAVY_LIB)" >&2
    exit 3; }
done
# Review 12: started inside an ordinary turn that already holds the box (it inherited that turn's claim cookie). It
# used to take its "turn" at once (the claim read as its own) and then RELEASE the parent's claim at its end, so the
# box read free under the parent's still-running command. It runs now, under the parent's turn, and claims nothing.
if [ -n "$QH_INHERITED_MAIN" ]; then
  if command -v kosmos_holds_machine_claim >/dev/null && kosmos_holds_machine_claim; then
    echo "QUEUED-HEAVY $(date '+%H:%M:%S') $WHAT runs now, inside the turn that already holds the box (it claims and releases nothing)"
    # Review 13: the same clean command environment an ordinary turn gives (no queue controls, no side labels).
    unset ${KOSMOS_WAIT_CONTROL_VARS:-KOSMOS_NO_WAIT} KOSMOS_SIDE_CAPABLE KOSMOS_SIDE_AWARE QH_TEST_LOSE_TAKES QH_TEST_LOST_PAUSE_S QH_TEST_PS QH_TEST_PS_NAME QH_TEST_CWD QH_TEST_MOVE_FAIL QH_TEST_RESTORE_FAIL 2>/dev/null
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
STOP_GRACE_S="${QUEUED_HEAVY_STOP_GRACE_S:-60}"   # kosmos#9118: TERM to KILL, for a main turn's command group
case "$STOP_GRACE_S" in ''|*[!0-9]*) STOP_GRACE_S=60 ;; esac
while [ "${#STOP_GRACE_S}" -gt 1 ] && [ "${STOP_GRACE_S#0}" != "$STOP_GRACE_S" ]; do STOP_GRACE_S="${STOP_GRACE_S#0}"; done   # review 3: 00060 is 60
case "$STOP_GRACE_S" in ?????*) STOP_GRACE_S=600 ;; esac   # #9118 review 2: five digits or more is past the clamp (and no overflow)
STOP_GRACE_S=$((10#$STOP_GRACE_S))   # #9118 review 1: 08 and 09 are not octal errors (an error inside the EXIT trap ended it part way)
[ "$STOP_GRACE_S" -le 600 ] || STOP_GRACE_S=600
# #9118 review 6: the renewer is stopped before the grace, so the claim must outlive it: at most one renewal period
# has passed since the last renewal, so the claim has at least CLAIM_MIN*60 - RENEW_SEC seconds left. A longer grace
# would let the claim lapse while the command is still being stopped, and another run start beside it.
_qh_glim=$(( 10#$CLAIM_MIN * 60 - 10#$RENEW_SEC )); [ "$_qh_glim" -ge 1 ] || _qh_glim=1   # review 7: 10#, so 08 stays a number
[ "$STOP_GRACE_S" -le "$_qh_glim" ] || STOP_GRACE_S=$_qh_glim
_qh_clear() {
  kosmos_refuse_if_machine_claimed "$WHAT" || return 1
  # #4911: no main turn starts beside a light run's side turn, whatever its class: a light one would make two light
  # runs, and a heavy one never passed the side turn's gate (two Playwright runs, say). A side turn ends in minutes.
  if command -v kosmos_refuse_if_light_side_live >/dev/null; then
    kosmos_refuse_if_light_side_live "$WHAT" || return 1
  fi
  kosmos_refuse_if_suite_live "$WHAT" "" || return 1
  kosmos_refuse_if_harness_live "$WHAT" "" || return 1
  # kosmos#6756: nor beside a relay pre-push build (the queue's bound applies). A light turn is not held back: a light
  # run beside a heavy one is what a side turn already allows.
  if [ "${KOSMOS_QUEUE_CLASS:-heavy}" != light ] && command -v kosmos_refuse_if_prepush_build_live >/dev/null 2>&1; then
    kosmos_refuse_if_prepush_build_live "$WHAT" || return 1
  fi
  return 0
}
echo "QUEUED-HEAVY $(date '+%H:%M:%S') waiting for a turn: $WHAT (class ${KOSMOS_QUEUE_CLASS:-heavy})"
# kosmos#9118 item 1: this run's label, for --withdraw. Removed on every exit: here while it waits (a TERM ends the wait
# through this trap, which also takes this run's place out of the queue), and in _qh_end once it holds the turn.
# Review 1: the trap first, then the file (a TERM between them left a stale label). The trap also releases a claim this
# run had just taken (a TERM inside _qh_take, before _qh_end's trap replaces this one); both releases free only a claim
# carrying this run's own cookie, so they are no-ops for a run that never claimed.
QH_LABEL="$(_qh_marker_dir_raw)/qh-label.$$"
trap '[ -n "$QH_LABEL" ] && rm -f "$QH_LABEL"; [ "$(cat "$(_qh_marker_dir_raw)/queued-heavy-take.lock/pid" 2>/dev/null)" = "$$" ] && rm -rf "$(_qh_marker_dir_raw)/queued-heavy-take.lock"; type kosmos_unmark_suite_waiting >/dev/null 2>&1 && kosmos_unmark_suite_waiting; type kosmos_release_machine >/dev/null 2>&1 && kosmos_release_machine; type kosmos_release_light_side >/dev/null 2>&1 && kosmos_release_light_side' EXIT
_qh_label() { [ -n "$QH_LABEL" ] && { printf '%s\n%s\n%s\n%s\n' "$WHAT" "$1" "$(_qh_pid_start $$)" "$STOP_GRACE_S" > "$QH_LABEL.tmp"; } 2>/dev/null && mv -f "$QH_LABEL.tmp" "$QH_LABEL" 2>/dev/null; }   # line 4: this run's grace (review 3)
_qh_label waiting || QH_LABEL=""
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
  # #5332: the main lane's wait kept this run's queue place (KOSMOS_WAIT_KEEP_MARK), so the ORDER is asked here, under
  # the lock, with every earlier waiter still marked: a later joiner can no longer pass while this run is between its
  # wait and its claim. Asked only while this run HOLDS a marker: one with none (cleared on its first pass, or a lib
  # older than #5332 that unmarked anyway) would read every live waiter as ahead and lose every take (review 1).
  elif { [ ! -e "$(_kosmos_suite_waiter_file "$$")" ] || kosmos_refuse_if_earlier_suite_waiter "$WHAT" 2>/dev/null; } \
       && _qh_clear >/dev/null 2>&1; then
    kosmos_claim_machine "$CLAIM_MIN" && rc=0
  fi
  rm -rf "$lock"
  # Test seam (#5064): QH_TEST_LOSE_TAKES=N makes the first N takes lose, so a lost take can be proven without racing.
  # Main lane only: a side take holds a side claim that kosmos_release_machine does not release (review, #5064).
  if [ "$rc" = 0 ] && [ "${KOSMOS_WAIT_LANE:-main}" != side ] && [ "${QH_TEST_LOSE_TAKES:-0}" -gt 0 ] 2>/dev/null; then
    QH_TEST_LOSE_TAKES=$((QH_TEST_LOSE_TAKES - 1)); kosmos_release_machine 2>/dev/null || true; rc=1
  fi
  # The place is given up only once the take is won (a lost one keeps it, and the next wait resumes it).
  [ "$rc" = 0 ] && [ "${KOSMOS_WAIT_LANE:-main}" != side ] && kosmos_unmark_suite_waiting
  return "$rc"
}
# #5064: this run's place in the queue is its join time (taken here, within a few seconds of the library's own).
# A MAIN-lane wait that found the box clear used to drop the run's marker before the take; if the take then lost, the
# next wait wrote a NEW marker stamped now, sending the oldest waiter to the back (Kitty's ick 5031 full, 15:28:59
# 2026-10-02: first in line, then 21 ahead, its clock restarted). Since #5332 the wait keeps the marker through the take
# (KOSMOS_WAIT_KEEP_MARK), so a lost take still holds it. The re-mark below only restores the join time for a run that
# had no marker (it cleared on its first pass, or a lib older than #5332 unmarked it): it cannot stop a later joiner
# passing in the gap before it (perturbed with the kept marker removed and the re-mark left in: the #5064 arm went red
# in one of two runs, a race, which is why the kept marker exists and why no arm can pin that variant).
# kosmos#9139: QUEUED_HEAVY_CAP_S=<seconds> caps the wait for a MAIN turn (relay CI on Mortals sets 900). When the cap
# runs out, the run first looks again for a free turn; then, while a release cut's claim holds the machine, it keeps
# waiting (a cut holds Mortals for about two hours, and a suite beside one slows the cut's own steps: Baron); otherwise
# it runs BESIDE the holder, with no claim and no renewer, says so, and notes its start and end with
# kosmos_note_beside_run, so the holder's red run-tests.sh summary names it (a red in that window reads as contention,
# not as the change: PigeonPete). Unset, empty or not a number: no cap, the queue as before. A light run (a side turn)
# ignores it. The place in the queue is not kept across a cut's re-wait (the wait takes a new one).
QH_CAP_S="${QUEUED_HEAVY_CAP_S:-}"
case "$QH_CAP_S" in ''|*[!0-9]*) QH_CAP_S="" ;; esac
[ -n "$QH_CAP_S" ] && QH_CAP_S=$((10#$QH_CAP_S))
[ "${KOSMOS_QUEUE_CLASS:-heavy}" = light ] && QH_CAP_S=""
if [ -n "$QH_CAP_S" ]; then
  export KOSMOS_WAIT_QUEUE_CEIL_S="$QH_CAP_S"
  echo "QUEUED-HEAVY $(date '+%H:%M:%S') waits at most ${QH_CAP_S}s for an ordinary holder, then runs beside it; a release cut is waited out (QUEUED_HEAVY_CAP_S, kosmos#9139): $WHAT"
fi
_qh_cut_holds() { case "$(kosmos_machine_claim_status 2>/dev/null)" in *"reserved for a release"*) return 0 ;; esac; return 1; }
_qh_run_beside() {
  local id rc note=1
  kosmos_unmark_suite_waiting
  command -v kosmos_note_beside_run >/dev/null 2>&1 || note=0
  id="queued-heavy-$$-$(date +%s)"
  echo "QUEUED-HEAVY $(date '+%H:%M:%S') RUNNING BESIDE the queue: the cap (${QH_CAP_S}s) ran out and no release cut holds the machine, so this shares the box with whatever holds it (kosmos#9139): $WHAT"
  [ "$note" = 1 ] || echo "QUEUED-HEAVY: this lib has no kosmos_note_beside_run, so the holder's summary will not name this run" >&2
  [ "$note" = 1 ] && kosmos_note_beside_run start "$id" "$WHAT"
  trap '[ "$note" = 1 ] && kosmos_note_beside_run end "$id"; exit 143' TERM
  trap '[ "$note" = 1 ] && kosmos_note_beside_run end "$id"; exit 130' INT
  trap '[ "$note" = 1 ] && kosmos_note_beside_run end "$id"; exit 129' HUP
  "$@"; rc=$?
  [ "$note" = 1 ] && kosmos_note_beside_run end "$id"
  echo "QUEUED-HEAVY $(date '+%H:%M:%S') END (ran beside the queue) rc=$rc: $WHAT"
  exit "$rc"
}
# The wait gave up. With no cap, as before: refused. With a cap: a free turn now, the cut waited out, or beside.
_qh_after_bound() {
  if [ -z "$QH_CAP_S" ]; then echo "QUEUED-HEAVY $(date '+%H:%M:%S') REFUSED (the queue's bound ran out): $WHAT"; exit 4; fi
  _qh_clear >/dev/null 2>&1 && return 0
  while _qh_cut_holds; do
    echo "QUEUED-HEAVY $(date '+%H:%M:%S') the cap (${QH_CAP_S}s) ran out while a release cut holds the machine; waiting past the cap (kosmos#9139): $WHAT"
    kosmos_wait_until_clear "$WHAT" --suite-queue _qh_clear && return 0
  done
  _qh_run_beside "$@"
}
QH_JOINED="$(date +%s)"
export KOSMOS_WAIT_KEEP_MARK=1   # #5332, see _qh_take. Read only by a main-lane wait (a side wait returns first; the renewer never waits).
until { kosmos_wait_until_clear "$WHAT" --suite-queue ${SIDE_ARGS[@]+"${SIDE_ARGS[@]}"} _qh_clear || _qh_after_bound "$@"; _qh_take; }; do
  echo "QUEUED-HEAVY $(date '+%H:%M:%S') did not get the turn (another run took it, or is ahead in the queue); waiting again: $WHAT"
  # Only when the place is gone (review 3): a lost take that kept its marker needs no re-mark.
  if [ "${KOSMOS_WAIT_LANE:-main}" != side ] && [ ! -e "$(_kosmos_suite_waiter_file "$$")" ]; then
    kosmos_mark_suite_waiting "$QH_JOINED"
    # Said as an attempt: an unwritable marker dir keeps no place (review 1). A lib without the marker functions is
    # refused at load (_qh_need), so it never gets here.
    echo "QUEUED-HEAVY $(date '+%H:%M:%S') re-marked its place in the queue (joined $(date -r "$QH_JOINED" '+%H:%M:%S')) (#5064): $WHAT"
  fi
  # Test seam (#5332): QH_TEST_LOST_PAUSE_S pauses each main-lane lost take here, after any re-mark, so a later joiner's
  # polls land while the loser holds only the place it kept (none, in the test's copy that removes both ways).
  if [ "${KOSMOS_WAIT_LANE:-main}" != side ] && [ "${QH_TEST_LOST_PAUSE_S:-0}" -gt 0 ] 2>/dev/null; then sleep "$QH_TEST_LOST_PAUSE_S"; fi
  # A side wait returns before any sleep, so a take that keeps losing (say, a marker dir it cannot write) would spin.
  # Side lane only: a main-lane loser keeps its place (its marker, or the re-mark above), and a pause there only lets
  # a later joiner past it.
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
# #5331: stop the capper and reap it WITHOUT ever blocking. Once the group kill missed it (one fitting explanation: it was
# not a group leader) and the unbounded `wait` after it held a side turn's claim, and the canary that ran it, for
# 1 h 43 min. A KILL to its own pid lands even on a stopped process, and it is waited on only once it has died (a zombie
# or gone), so a capper that somehow lives is left behind rather than blocking the release. Its own pid and its children
# are signalled only while it is still this script's child (a parent-pid match, not a command-line check): one that
# exited and was reaped may have its pid reused by someone else's process. The capper first, then the children seen
# before it died, so it cannot fork a new sleep in between.
_qh_child() { [ "$(ps -o ppid= -p "$1" 2>/dev/null | tr -d ' ')" = "$$" ]; }
_qh_stop_capper() {
  [ -n "$CAPPER" ] || return 0
  kill -KILL -- "-$CAPPER" 2>/dev/null
  if _qh_child "$CAPPER"; then
    local kids; kids="$(pgrep -P "$CAPPER" 2>/dev/null | tr '\n' ' ')"
    kill -KILL "$CAPPER" 2>/dev/null
    [ -n "${kids// /}" ] && kill -KILL $kids 2>/dev/null
  fi
  local i=0
  while [ "$i" -lt 40 ]; do
    _qh_child "$CAPPER" || { CAPPER=""; return 0; }   # gone and reaped already
    case "$(ps -o stat= -p "$CAPPER" 2>/dev/null)" in ''|Z*) wait "$CAPPER" 2>/dev/null; CAPPER=""; return 0 ;; esac
    sleep 0.25; i=$((i + 1))
  done
  echo "QUEUED-HEAVY $(date '+%H:%M:%S') the turn's capper or watcher (pid $CAPPER) did not stop; left behind so the claim is released"
  CAPPER=""
}
_qh_end() {
  # Review 4: a second signal during cleanup must not abandon it (the command would run on unclaimed); round 9: nor a
  # reader that has gone (SIGPIPE at an echo below); #9118 review 5: ALRM, USR1, USR2 too (each is fatal through here).
  trap '' TERM INT HUP PIPE ALRM USR1 USR2
  [ -n "${QH_STOPPED:-}" ] && rm -f "$QH_STOPPED"
  # Stop the renewer and WAIT for it before releasing, so a renewal in flight cannot re-create the claim after
  # the release.
  if [ -n "$RENEWER" ]; then kill "$RENEWER" 2>/dev/null; wait "$RENEWER" 2>/dev/null; fi
  # A side command runs in its own process group, so a signal to this script does not reach it: stop whatever is
  # left of that group BEFORE the release (round 3), or it runs on uncapped and unclaimed. This also ends grandchildren
  # that outlived the command (one that ignored the cap's TERM) and stayed in its group; one that left the group (its
  # own session, as Playwright starts a browser) is ended by _qh_kill_desc, if the capper saw it.
  # kosmos#9118: a MAIN command runs in its own group too now, so the same stop applies to it, with a longer grace
  # (QUEUED_HEAVY_STOP_GRACE_S, default 60 s): run-tests.sh does its own cleanup on a TERM (its EXIT trap stops its
  # shards and runs the leak guard, which can take tens of seconds), and a KILL before that ends would strand the
  # shards that cleanup stops, which are in process groups of their own.
  # #9118 review 1: for a main turn, only when this script ends BEFORE its command did (QH_DONE unset). A command that
  # ended on its own keeps what it left in its group running, as a main turn always has. Review 3: keyed on that, not
  # on which signal arrived: an ALRM (a perl alarm deadline), USR1 or USR2 also ends bash (QUIT does not: non-interactive bash ignores it) through this trap, and keyed on
  # TERM/INT/HUP alone it released the claim, left the command running and then stopped the watcher that would have.
  if [ -n "$CMD" ] && { [ "$LANE" = side ] || [ -z "$QH_DONE" ]; } && kill -0 -- "-$CMD" 2>/dev/null; then
    _g=20; [ "$LANE" = side ] || _g=$(( STOP_GRACE_S * 2 ))
    [ "$LANE" = side ] || echo "QUEUED-HEAVY $(date '+%H:%M:%S') STOPPING: $WHAT (this script is ending before its command did); TERM to its process group, KILL after ${STOP_GRACE_S}s"
    kill -TERM -- "-$CMD" 2>/dev/null
    # Review 7: a clock deadline, not a count of 0.5 s turns (under load each turn runs long, past the grace promised).
    _end=$(( $(date +%s) + _g / 2 )); while kill -0 -- "-$CMD" 2>/dev/null && [ "$(date +%s)" -lt "$_end" ]; do sleep 0.5; done
    kill -KILL -- "-$CMD" 2>/dev/null
  fi
  [ "$LANE" = side ] && _qh_kill_desc   # round 16 (Opus): what left the group (Playwright's detached browsers), before the release
  # Round 18 (Opus): the capper LAST, so a KILL of this script during the grace above still leaves the capper to see it
  # gone and finish the stop (it watches this pid). Round 10: KILL, not TERM: the capper holds nothing to clean up (the
  # command group is stopped above), and a TERM into its trap-reset subshell made bash 3.2 warn on most side turns.
  _qh_stop_capper
  # Review 4: the stop file too, once the capper is gone (a yield in the window before could write it again).
  rm -f ${QH_STOPPED:+"$QH_STOPPED"} ${QH_DESC:+"$QH_DESC"}
  if [ "$LANE" = side ]; then kosmos_release_light_side; else kosmos_release_machine; fi
  [ -n "${QH_LABEL:-}" ] && rm -f "$QH_LABEL"   # #9118 item 1: the label goes with the claim
  echo "QUEUED-HEAVY $(date '+%H:%M:%S') claim released"
}
trap _qh_end EXIT
# A signal exits through the EXIT trap, so a killed script still stops its command (in its own process group, out of
# the signal's reach) and releases its claim. kosmos#9118: a main turn too, now that its command also runs in the
# background with a `wait` the trap interrupts (review 3 kept main turns out while the command ran in the foreground,
# where bash runs a trap only after the command ends). Before, a TERM to a main turn's wrapper ended bash and left the
# command running unclaimed: on 11-25 two killed validations left their run-tests.sh suites running for about 70
# minutes (52 processes). A SIGKILL of this script (or a KILL to its caller's process group), which no trap sees, is
# covered by the main turn's watcher below, within about 5 s. Review 7: the cost is that the claim reads free
# meanwhile (its holder is dead) while the watcher stops the command through its grace, so another run can start
# beside that cleanup. Before #9118 a KILL to the caller's group ended the command at once; now it gets its TERM
# cleanup instead, which for run-tests.sh is what stops its shards.
# #9118 review 1: NOT when this script has a terminal on stdin, stdout or stderr (a person running it by hand). There
# the command stays in the foreground as before: a background command that reads or sets the terminal (sudo, ssh, a
# pager) is stopped by the system and `wait` never returns, and Ctrl-C and Ctrl-Z already reach a foreground command.
# #9118 review 2: a controlling terminal counts too (stdio redirected from a terminal, as `cmd </dev/null >log 2>&1`):
# a background command that opens /dev/tty (an ssh or git prompt, sudo) is stopped the same way. An agent's shell has
# none, so it takes the background path.
QH_FG=""; QH_PEND=""; QH_DONE=""
# Review 3: the /dev/tty probe in a SUBSHELL: in posix mode (POSIXLY_CORRECT) a failed redirection on `:` ends the shell.
[ "$LANE" != side ] && { [ -t 0 ] || [ -t 1 ] || [ -t 2 ] || ( : </dev/tty ) 2>/dev/null; } && QH_FG=1
if [ -n "$QH_FG" ]; then _qh_label fg; else _qh_label bg; fi   # #9118 item 1: --withdraw refuses a foreground holder
# #9118 A2 review 2: in the foreground a TERM or HUP must not end this script while the command runs (bash with no trap
# dies at once and releases the claim; the command runs on unclaimed). With a trap, bash runs it only after the
# foreground command ends, so the claim is held for as long as the command runs. Covers a --withdraw that read
# "waiting" just before this run took its turn, and any other TERM. Ctrl-C (INT) reaches the command itself.
# Review 3: the trap only RECORDS it (an `exit` there replaced the command's own rc with 143 and skipped the END line):
# the command runs to its end, its rc is kept, and the end says a signal came. A group-wide HUP or TERM (a terminal
# hanging up) also ends the renewer, which shares this group in the foreground: the claim then lapses CLAIM_MIN later.
QH_FGSIG=""
# Review 5: ALRM, USR1 and USR2 too: untrapped they also end bash at once (a perl alarm wrapper on a terminal).
[ -n "$QH_FG" ] && { trap 'QH_FGSIG=TERM' TERM; trap 'QH_FGSIG=HUP' HUP; trap 'QH_FGSIG=ALRM' ALRM; trap 'QH_FGSIG=USR1' USR1; trap 'QH_FGSIG=USR2' USR2; }
[ -n "$QH_FG" ] || { trap 'exit 143' TERM; trap 'exit 130' INT; trap 'exit 129' HUP; }
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
  trap '[ -n "$sp" ] && kill "$sp" 2>/dev/null; exit 0' TERM INT HUP   # #9118 review 1: HUP too (it inherited "exit 129" and left its sleep)
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
unset KOSMOS_WAIT_KEEP_MARK KOSMOS_SIDE_CAPABLE KOSMOS_SIDE_AWARE QH_TEST_LOSE_TAKES QH_TEST_LOST_PAUSE_S QH_TEST_PS QH_TEST_PS_NAME QH_TEST_CWD QH_TEST_MOVE_FAIL QH_TEST_RESTORE_FAIL   # review 5: a command that queues on its own must not claim to be one of these
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
  # #9118 review 5: a TERM, INT or HUP between the fork and CMD=$! is recorded and acted on once CMD is set, as in a main
  # turn (a TERM there found CMD empty, so the side command ran on uncapped and unclaimed).
  trap 'QH_PEND=143' TERM; trap 'QH_PEND=130' INT; trap 'QH_PEND=129' HUP
  trap 'QH_PEND=$((128 + $(kill -l ALRM)))' ALRM; trap 'QH_PEND=$((128 + $(kill -l USR1)))' USR1; trap 'QH_PEND=$((128 + $(kill -l USR2)))' USR2   # review 6: as the main lane
  if [ -t 0 ]; then set -m; "$@" </dev/null & CMD=$!; set +m
  else set -m; "$@" & CMD=$!; set +m; fi
  trap 'exit 143' TERM; trap 'exit 130' INT; trap 'exit 129' HUP; trap - ALRM USR1 USR2
  [ -n "$QH_PEND" ] && exit "$QH_PEND"
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
  _qh_stop_capper
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
elif [ -n "$QH_FG" ]; then
  "$@"; rc=$?   # a terminal: in the foreground, as before #9118 (see QH_FG above)
  [ -n "$QH_FGSIG" ] && echo "QUEUED-HEAVY $(date '+%H:%M:%S') a $QH_FGSIG came while $WHAT ran in the foreground; it ran to its end (#9118)"
else
  # kosmos#9118: the command in its own process group, as a side turn's is, so a signal to this script can stop all of
  # it (_qh_end). stdin is kept (no terminal here: QH_FG). An INT to this script reaches the command as a TERM.
  # Review 2: a signal between the fork and CMD=$! would find CMD empty and stop nothing, so for that moment the traps
  # only RECORD it, and it is acted on once CMD is set. Not `trap ''`: an ignored signal stays ignored in the command.
  # Review 4: ALRM, USR1 and USR2 too, which would otherwise end bash in that moment with CMD empty; afterwards they are
  # back to their default (fatal, through the EXIT trap, which stops the command because QH_DONE is unset).
  trap 'QH_PEND=143' TERM; trap 'QH_PEND=130' INT; trap 'QH_PEND=129' HUP
  trap 'QH_PEND=$((128 + $(kill -l ALRM)))' ALRM; trap 'QH_PEND=$((128 + $(kill -l USR1)))' USR1; trap 'QH_PEND=$((128 + $(kill -l USR2)))' USR2   # review 5: the system's own numbers
  set -m; "$@" & CMD=$!
  trap 'exit 143' TERM; trap 'exit 130' INT; trap 'exit 129' HUP; trap - ALRM USR1 USR2
  [ -n "$QH_PEND" ] && { set +m; exit "$QH_PEND"; }
  # The watcher, in its own process group too (so a KILL to this script's group does not reach it), stopped by
  # _qh_stop_capper like a side turn's capper. Every 5 s: once the command's GROUP has gone it exits; once THIS script
  # is gone (SIGKILLed, so no trap ran) it stops the command's group as _qh_end would, and exits. $$ is this script's
  # pid here. Review 2: the GROUP, not the leader: a leader that exits on a TERM while a member still cleans up would
  # end the watch, and a KILL of this script during the grace would then leave that member running unclaimed.
  ( trap - EXIT TERM INT HUP; trap '' PIPE
    while kill -0 -- "-$CMD" 2>/dev/null; do
      sleep 5 </dev/null >/dev/null 2>&1
      # Review 3: if this script was KILLed during its own grace, this TERMs again and gives a second full grace, and the
      # claim reads free meanwhile (its holder is dead). Review 5: that second TERM can cut a command's cleanup short if
      # the cleanup does not itself ignore TERM (run-tests.sh's does, after its first step).
      if _qh_wrapper_gone "$$"; then
        kill -TERM -- "-$CMD" 2>/dev/null; end=$(( $(date +%s) + STOP_GRACE_S ))   # review 7: a clock deadline
        while kill -0 -- "-$CMD" 2>/dev/null && [ "$(date +%s)" -lt "$end" ]; do sleep 0.5; done
        kill -KILL -- "-$CMD" 2>/dev/null; exit 0
      fi
    done ) </dev/null >/dev/null 2>&1 &
  CAPPER=$!; set +m
  disown "$CAPPER" 2>/dev/null   # review 2: bash would print a "Killed: 9" job report for it in every main turn's log
  wait "$CMD"; rc=$?; QH_DONE=1   # the command ended on its own (a trapped signal exits from inside the wait instead)
  _qh_stop_capper
fi
echo "QUEUED-HEAVY $(date '+%H:%M:%S') END rc=$rc: $WHAT"
exit $rc
