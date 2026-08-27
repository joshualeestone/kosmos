#!/usr/bin/env bash
# Are the kosmos-relay monitors running uncommitted code right now? (kosmos#1045)
#
# The three LaunchAgents run their scripts straight out of
# ~/work/kosmos-relay/deploy/, a live git working tree. There is no deploy step:
# saving an edit changes what runs on the next tick, an uncommitted experiment is
# live, and `git checkout` of a branch with different scripts is live.
#
# ⚠️ THIS FIXES NOTHING AND TOUCHES NOTHING. It does not stop, restart or
# repoint any job. It answers "is it happening right now", which is the part the
# card says is missing: nothing anywhere indicated that it was.
#
#   bash tools/relay-monitor-check.sh
#
# 0  every monitor's script is committed and on main
# 1  at least one is running code that is not
# 2  could not tell
#
# ⚠️ EXIT 2 IS NOT A PASS. A check that answers "is anything wrong" with "no"
# when it could not look is worse than no check; the sibling board check shipped
# with exactly that bug until a negative control caught it.
set -uo pipefail
LA="${KOSMOS_LAUNCHD_DIR:-$HOME/Library/LaunchAgents}"
JOBS="com.kosmos.coordinator-monitor com.kosmos.relay-cert-monitor com.kosmos.expiry-watchtower"
say() { printf '%s\n' "$*"; }

worst=0
seen=0
for job in $JOBS; do
  p="$LA/$job.plist"
  if [ ! -f "$p" ]; then
    say "?    $job: no plist at $p"
    [ "$worst" = 0 ] && worst=2
    continue
  fi
  # ⚠️ THE SCRIPT, NOT THE INTERPRETER. A general version of this check resolved
  # every job to /opt/homebrew because it took the first argv entry that lived in
  # a git repo, which is the node or bash binary. The thing that can change under
  # us is the SCRIPT, so only .sh arguments are considered.
  script=$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments' "$p" 2>/dev/null \
           | grep -oE '/[^ "]*\.sh' | head -1)
  if [ -z "$script" ]; then
    say "?    $job: no script path in its ProgramArguments"
    [ "$worst" = 0 ] && worst=2
    continue
  fi
  if [ ! -f "$script" ]; then
    say "?    $job -> $script (that file does not exist)"
    [ "$worst" = 0 ] && worst=2
    continue
  fi
  root=$(git -C "$(dirname "$script")" rev-parse --show-toplevel 2>/dev/null || true)
  if [ -z "$root" ]; then
    say "ok   $job -> $script (not in a git tree, so nothing can change under it)"
    seen=1
    continue
  fi
  seen=1
  branch=$(git -C "$root" branch --show-current 2>/dev/null)
  # ⚠️ THE SCRIPT'S OWN STATUS, not the whole repo's. A colleague's unrelated
  # edit elsewhere in kosmos-relay is not this monitor running uncommitted code,
  # and reporting it as one is how a check earns being ignored.
  own=$(git -C "$root" status --porcelain -- "$script" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$branch" = "main" ] && [ "$own" = "0" ]; then
    say "ok   $job -> ${script#$HOME/} (committed, on main)"
  else
    say "!!   $job -> ${script#$HOME/}"
    [ "$branch" != "main" ] && say "       tree is on ${branch:-<detached>}, so this job runs that branch's script"
    [ "$own" != "0" ] && say "       this script has uncommitted changes, live on the next tick"
    worst=1
  fi
done

say ""
if [ "$seen" = 0 ] && [ "$worst" != 1 ]; then
  say "no monitor could be examined, so nothing is known about what they are running"
  exit 2
fi
case "$worst" in
  0) say "OK: every monitor is running committed code from main." ; exit 0 ;;
  1) say "!! A LIVE MONITOR IS RUNNING CODE THAT IS NOT COMMITTED ON MAIN."
     say "!! There is no deploy step, so this took effect without anyone shipping it."
     exit 1 ;;
  *) say "could not determine the state of at least one monitor"; exit 2 ;;
esac
