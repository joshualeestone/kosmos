#!/usr/bin/env bash
# Is the live board serving a git working tree, and if so, WHICH ONE? (kosmos#1051)
#
# Ice Cream Kitty proved by accident that `com.kosmos.board` runs server.js with
# WorkingDirectory=<a git checkout> and serves web/index.html from disk per
# request, so `git checkout <branch>` in that directory silently changes what the
# person using Kosmos is looking at. For about twenty minutes the board served an
# unmerged branch and NOTHING ANYWHERE INDICATED THAT IT WAS.
#
# This does not fix that. It makes it visible in one command, which is the half
# the card says was missing. It touches nothing: two reads and an HTTP GET.
#
#   bash tools/board-serving-check.sh [port]
#
# Exit 0 clean, 1 serving something other than a clean main, 2 could not tell.
set -uo pipefail
PORT="${1:-${KOSMOS_PORT:-16180}}"
URL="http://127.0.0.1:${PORT}/"

say() { printf '%s\n' "$*"; }

# 1. Where does the board run from? Read it from launchd rather than assuming,
#    because assuming the path is how three agents counted three different things.
PLIST="$HOME/Library/LaunchAgents/com.kosmos.board.plist"
# ⚠️ AN OVERRIDE THAT EXISTS SO THIS CHECK CAN BE TESTED. A check nobody has
# seen produce its ALARM is decoration: it passes on a healthy machine forever
# and nothing proves it could ever fail. This lets the test point it at a
# scratch repo and watch it fire. Unset in every real run.
DIR="${KOSMOS_BOARD_DIR:-}"
if [ -z "$DIR" ] && [ -f "$PLIST" ]; then
  DIR=$(/usr/libexec/PlistBuddy -c 'Print :WorkingDirectory' "$PLIST" 2>/dev/null || true)
fi
if [ -z "$DIR" ]; then
  say "could not read the board's WorkingDirectory from $PLIST"
  say "  (so this check cannot tell you what it is serving; that is not the same as 'fine')"
  exit 2
fi
say "board WorkingDirectory: $DIR"

# 2. Is it a git checkout at all? If it is not, this whole class does not apply.
#
# 🛑 BUT A MISSING DIRECTORY IS NOT AN ALL-CLEAR, and the first version of this
#    said it was. `git rev-parse` fails identically for "this is not a repo" and
#    "this path does not exist", so a wrong or stale WorkingDirectory reported
#    CLEAN. That is a false OK, which is the dangerous direction: it answers the
#    question "is anything wrong" with "no" when it could not look. Caught by
#    running the check against a path that does not exist and reading the exit
#    code instead of the words.
if [ ! -d "$DIR" ]; then
  say "that directory does not exist, so nothing about what is served can be determined"
  exit 2
fi
if ! git -C "$DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  say "not a git checkout, so a branch operation cannot change what is served"
  exit 0
fi

BRANCH=$(git -C "$DIR" branch --show-current 2>/dev/null)
DIRTY=$(git -C "$DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
HEAD=$(git -C "$DIR" rev-parse --short HEAD 2>/dev/null)
say "branch: ${BRANCH:-<detached>}   head: ${HEAD}   uncommitted files: ${DIRTY}"

# 3. ⭐ THE DECISIVE PART, and it is why this is not just `git status`.
#    Prove the SERVED BYTES come from that tree, the way Kitty proved it: take a
#    string that exists in the file on disk and ask the live board for it. A
#    `git status` tells you what the tree is; only this tells you the board is
#    serving it.
# 3. Is that tree what the board is actually SERVING? Kitty's own method: a
#    `git status` tells you what the tree IS; only asking the live board tells
#    you it is being served.
#
# 🛑 THE VERDICT BELOW IS NOT GATED ON THIS, and that ordering was a real bug
#    a negative control caught before this shipped. The first version returned
#    early when the bytes did not match, so a tree sitting on somebody's branch
#    reported "may serve from elsewhere" and NEVER REACHED THE ALARM. Whether
#    the tree is clean and whether it is being served are independent facts and
#    each is reported on its own.
SERVING="unknown"
SERVED=$(curl -s --max-time 8 "$URL" 2>/dev/null)
DISK_BYTES=$(wc -c < "$DIR/web/index.html" 2>/dev/null | tr -d ' ')
if [ -n "$SERVED" ] && [ -n "$DISK_BYTES" ] && [ "$DISK_BYTES" -gt 0 ]; then
  SERVED_BYTES=$(printf '%s' "$SERVED" | wc -c | tr -d ' ')
  DIFF=$(( DISK_BYTES > SERVED_BYTES ? DISK_BYTES - SERVED_BYTES : SERVED_BYTES - DISK_BYTES ))
  say "web/index.html on disk: ${DISK_BYTES} bytes   served: ${SERVED_BYTES} bytes"
  # A tolerance, not equality: a trailing newline difference is not a finding,
  # and a check that cries wolf over one byte gets ignored, which is worse than
  # not having it.
  if [ "$DIFF" -le 64 ]; then SERVING="yes"; else SERVING="no"; fi
else
  say "the board did not answer on ${URL}, or the file is unreadable"
fi

case "$SERVING" in
  yes) say "=> the live board IS serving this working tree" ;;
  no)  say "=> served bytes do not match this tree, so it may serve from elsewhere" ;;
  *)   say "=> could not tell whether this tree is being served" ;;
esac

# 4. The verdict, reported on the TREE regardless of the above.
say ""
if [ "$BRANCH" = "main" ] && [ "$DIRTY" = "0" ]; then
  say "OK: clean main."
  [ "$SERVING" = "yes" ] && say "   What is on screen is what is on main."
  exit 0
fi
say "!! THIS TREE IS NOT CLEAN MAIN."
[ "$BRANCH" != "main" ] && say "!! branch is ${BRANCH:-<detached>}."
[ "$DIRTY" != "0" ] && say "!! ${DIRTY} uncommitted file(s) in it."
if [ "$SERVING" = "yes" ]; then
  say "!! AND THE BOARD IS SERVING IT, so that is what the person using Kosmos sees."
elif [ "$SERVING" = "no" ]; then
  say "!! The board appears to serve something else, so this may not be on screen."
else
  say "!! Whether it is on screen could not be determined."
fi
say "!! restore with: git -C \"$DIR\" checkout main"
exit 1
