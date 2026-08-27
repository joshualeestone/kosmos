#!/usr/bin/env bash
# Which launchd jobs run code straight out of one of OUR git working trees?
# (kosmos#1066, generalising #1045 and #1051)
#
# Two cards, one shape: `com.kosmos.board` serves web/index.html from a checkout
# per request, and the kosmos-relay monitors run their scripts out of another.
# In both there is no deploy step, so saving an edit changes what is running and
# a `git checkout` of somebody's branch changes it too.
#
# ⚠️ REPORT ONLY. Nothing is stopped, restarted or repointed.
#
#   bash tools/live-code-sweep.sh
#
# 0  every live job runs committed code from main
# 1  at least one runs code that is not
# 2  could not tell
#
# ⚠️ EXIT 2 IS NOT A PASS. A check that answers "is anything wrong" with "no"
# when it could not look is worse than no check.
#
# ── WHY THIS IS NOT A NAIVE SWEEP ───────────────────────────────────────────
# The first attempt flagged about FIFTY jobs and was therefore useless. Two
# defects, both found by running it rather than reading it:
#
#   1. /opt/homebrew is itself a git repository, on a branch called `stable`,
#      and ~/.claude is one with 19 uncommitted files. Almost every job on this
#      Mac resolves into one of them. The two that mattered were buried.
#   2. It took the first argv entry that lived in a git repo, which is the
#      INTERPRETER (/opt/homebrew/bin/node), not the code. So com.kosmos.board
#      was reported against /opt/homebrew and looked fine FOR THE WRONG REASON,
#      which is the most dangerous state an instrument can be in: correct today,
#      silently wrong the moment anything moves.
#
# So: an allowlist of the trees we actually deploy from, and the SCRIPT rather
# than the thing that runs it.
set -uo pipefail

LA="${KOSMOS_LAUNCHD_DIR:-$HOME/Library/LaunchAgents}"
# The roots we ship from. A tree not on this list is somebody's toolchain, not
# our deploy surface, and flagging it is how a check earns being ignored.
ROOTS_DEFAULT="$HOME/work/agent-workforce:$HOME/work/kosmos-relay"
ROOTS="${KOSMOS_LIVE_ROOTS:-$ROOTS_DEFAULT}"
say() { printf '%s\n' "$*"; }

ours() {  # is $1 inside one of our roots?
  local p="$1" r
  while IFS= read -r r; do
    [ -z "$r" ] && continue
    case "$p" in "$r"|"$r"/*) return 0 ;; esac
  done <<< "$(printf '%s' "$ROOTS" | tr ':' '\n')"
  return 1
}

shopt -s nullglob 2>/dev/null || true
PLISTS=("$LA"/*.plist)
if [ "${#PLISTS[@]}" -eq 0 ]; then
  say "no plists in $LA, so nothing could be examined"; exit 2
fi

worst=0; examined=0
# ⭐ COUNT THE EXPOSURE, NOT ONLY THE INCIDENT (#1045). A job whose code is
# committed is still EDITABLE INTO PRODUCTION if it runs from a working tree.
# The old summary said "OK: every live job runs committed code from main" and
# that sentence is prevention-shaped: it reads as a guarantee about a risk it
# never measured. Report the numbers and let the reader judge.
in_tree=0; not_tree=0
for p in "${PLISTS[@]}"; do
  label=$(basename "$p" .plist)
  args=$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments' "$p" 2>/dev/null || true)
  wdir=$(/usr/libexec/PlistBuddy -c 'Print :WorkingDirectory' "$p" 2>/dev/null || true)

  # ⭐ THE CODE, NOT THE INTERPRETER. Prefer a script argument; fall back to the
  # working directory. Never a bare binary: that is what produced the wrong
  # answer last time.
  target=$(printf '%s' "$args" | grep -oE '/[^ "]*\.(sh|js|mjs|py|rb)' | head -1)
  [ -z "$target" ] && target="$wdir"
  [ -z "$target" ] && continue
  ours "$target" || continue

  d="$target"; [ -f "$d" ] && d=$(dirname "$d")
  if [ ! -d "$d" ]; then
    say "?    $label -> $target (that path does not exist)"
    worst=2; examined=1; continue
  fi
  root=$(git -C "$d" rev-parse --show-toplevel 2>/dev/null || true)
  if [ -z "$root" ]; then
    say "ok   $label -> ${target#$HOME/} (not a git tree)"; examined=1; not_tree=$((not_tree+1)); continue
  fi
  examined=1
  branch=$(git -C "$root" branch --show-current 2>/dev/null)
  # Per-FILE status when we have a file: a colleague's unrelated edit in the
  # same repo is not this job running uncommitted code.
  if [ -f "$target" ]; then
    dirty=$(git -C "$root" status --porcelain -- "$target" 2>/dev/null | wc -l | tr -d ' ')
    what="this file has uncommitted changes"
  else
    dirty=$(git -C "$root" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    what="$dirty uncommitted file(s) in the tree it serves from"
  fi
  if [ "$branch" = "main" ] && [ "$dirty" = "0" ]; then
    say "ok   $label -> ${target#$HOME/} (committed, on main; IN A WORKING TREE)"
    in_tree=$((in_tree+1))
  else
    say "!!   $label -> ${target#$HOME/}"
    [ "$branch" != "main" ] && say "       tree is on ${branch:-<detached>}, so this job runs that branch's code"
    [ "$dirty" != "0" ] && say "       $what, live with no deploy step"
    worst=1
  fi
done

say ""
if [ "$examined" -eq 0 ]; then
  say "no launchd job runs out of a tree we deploy from"
  say "  (good news for #1045 and #1051 -- and it looks identical to the plists"
  say "   having moved, so confirm before relying on it)"
  exit 2
fi
case "$worst" in
  0) say "$((in_tree+not_tree)) live jobs. $in_tree run from a git WORKING TREE. 0 have uncommitted changes."
         [ "$in_tree" -gt 0 ] && say "  a working tree means an editor is a deploy step (#1045); 0 uncommitted is TODAY, not a property"
         exit 0 ;;
  1) say "!! A LIVE JOB IS RUNNING CODE THAT IS NOT COMMITTED ON MAIN."
     say "!! There is no deploy step, so this took effect without anyone shipping it."
     exit 1 ;;
  *) say "could not determine the state of at least one job"; exit 2 ;;
esac
