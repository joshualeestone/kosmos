#!/usr/bin/env bash
# board_origin_label <dir> -- describe WHERE a live board is running from (#708).
#
# #708's separately-named contributing cause is a board running in the MAIN
# CHECKOUT: the house rule keeps ~/work/<repo>/ on main as a read-only reference
# precisely because a live server there holds the port and writes state, and it
# stays invisible until somebody ELSE's tests go red. run-tests.sh already
# printed the board's cwd beside a red; a bare path leaves the reader to
# recognise the string, and at 4am reading someone else's failure nobody does.
#
# The discriminator: at a checkout root, a MAIN checkout's `.git` is a DIRECTORY
# and a linked worktree's `.git` is a FILE. Measured both ways, and asserted by
# two FIXTURE arms in the test so the assertions cannot go vacuous if git ever
# changes the layout.
#
# 🛑 THIS TESTS THE DIRECTORY IT WAS HANDED. IT DOES NOT SEARCH UPWARD, AND THAT
# IS THE DECISION, NOT AN OVERSIGHT. An earlier version of this file called
# `git rev-parse --show-toplevel` so a board sitting in a SUBDIRECTORY of a
# checkout would still be classified. Blind review measured three new failure
# modes that arrived with that one call, all of them in the one place designed
# to stop a misread:
#   1. `rev-parse` searches UPWARD, so a board merely somewhere under a repo was
#      labelled the MAIN CHECKOUT. With a git-managed $HOME (an ordinary
#      dotfiles setup) the INSTALLED board, which is not a violation at all,
#      would be reported as one.
#   2. `GIT_WORK_TREE` in the caller's environment made it describe a directory
#      the board is NOT running from.
#   3. It was the only unbounded probe in `seen_before()` against an arbitrary,
#      possibly remote path. `lsof` beside it is self-bounded (`-S`, default 15s
#      per lsof(8)); this was not, and neither `timeout` nor `gtimeout` exists on
#      this fleet (kosmos#2474).
#
# 🛑 THE REVERT DID NOT REMOVE (1) ENTIRELY, AND AN EARLIER VERSION OF THIS
# COMMENT SAID IT DID. It removed the case of a board merely somewhere UNDER a
# repo. When $HOME IS the repo root, which is what `git init ~` dotfiles gives
# you, the directory test still matches and the label still fires. That matters
# more than it sounds: the INSTALLED board runs from $HOME (measured on this
# machine: a live board with cwd /Users/agent1), so on a dotfiles machine every
# red suite would accuse the installed board of the violation #708 exists to
# name. Hence the explicit $HOME decline below.
#
# ⇒ ACCEPTED LIMITATION: a board whose cwd is a SUBDIRECTORY of a checkout is
# NOT classified; it prints the bare path, which is what this file printed before
# #708 and is ALWAYS TRUE. A label that is silent is strictly better than one
# that can assert a violation that is not happening, because the whole purpose
# here is to stop somebody misreading a red. The #708 incident itself was a board
# at a checkout ROOT, which is where a server is normally started.
#
# 🛑 AND THE LABEL CLAIMS ONLY WHAT IS MEASURED. It says the `.git` shape and the
# consequence that follows for ANY repo (a server here holds the port and writes
# into the shared tree). It does NOT say "house rules keep this read-only",
# because that is true of ~/work/<repo> and false of, say, a dotfiles repo, and
# this function cannot tell them apart.
#
# 🛑 THE MAIN-CHECKOUT LABEL'S OWN PROSE MUST NOT CONTAIN THE WORD "worktree".
# The worktree arm is recognised by matching that word, so putting it in the
# other branch's fixed text makes the two labels collide on a substring match.
# Scope, stated exactly rather than as a guarantee: this constrains the PROSE
# only. Both labels interpolate a path, so a checkout whose own path contains
# "worktree" still collides. That is test fragility, not a functional bug: the
# only consumer that substring-matches the output is this library's own test;
# run-tests.sh interpolates the label into free text and never matches on it.
#
# KNOWN RESIDUALS, stated rather than probed for, all exotic here:
#   - a bare repo has no work tree and no `.git` inside one, so it is unclassified
#   - a `--separate-git-dir` checkout's `.git` is a FILE, so it reads as a worktree
#   - a git SUBMODULE working directory's `.git` is a FILE too, same reading
#   - a directory holding a stray `.git` DIRECTORY that is not a repo at all
#     reads as a main checkout; cheaper to name here than to guard
#   - a `.git` that is a SYMLINK to a real gitdir reads as a main checkout,
#     because `-d` follows symlinks. The classification is defensible (it is not
#     a linked worktree) but the code never measures "link" at all, so the label
#     must not say it does. An earlier label did.
#   - a $HOME that is ITSELF a linked worktree is declined like any other $HOME,
#     so it prints the bare path rather than "the worktree". A small loss of
#     information in the safe direction: it never over-claims.
#   - a $HOME that is a SUBDIRECTORY of a git repo is not declined, because the
#     decline matches $HOME itself; the subdirectory rule then applies and the
#     board prints the bare path, which is the safe direction
board_origin_label() {
  # `set -u` is on in the caller, so default every positional.
  local dir="${1:-}"
  [ -n "$dir" ] || { printf 'an unknown directory'; return 0; }
  # Not a directory any more (the process outlived its cwd): say what we were
  # told and nothing more. Inventing a classification here would be a guess.
  [ -d "$dir" ] || { printf '%s' "$dir"; return 0; }
  # $HOME is where the INSTALLED board runs, which is not a violation. Without
  # this, a git-managed $HOME (ordinary dotfiles) makes every red suite accuse
  # the installed board.
  #
  # 🛑 `-ef` (same device and inode), NOT a string compare. An earlier version
  # compared the strings and claimed "the caller's cwd comes from lsof in the
  # same spelling", which is false in general and was measured false two ways: a
  # symlinked $HOME, and a $HOME carrying a trailing slash, each defeating the
  # decline so the installed board was labelled again. `-ef` is a `test` builtin,
  # so this stays subprocess-free. It is false when either path is missing, which
  # is the safe direction: an absent $HOME simply does not match.
  # Live on THIS machine, not merely in principle: /Users/agent1 and
  # /System/Volumes/Data/Users/agent1 are the same device and inode (macOS
  # firmlink) and lsof may report either spelling, so `=` could have accused the
  # installed board here.
  [ -n "${HOME:-}" ] && [ "$dir" -ef "$HOME" ] && { printf '%s' "$dir"; return 0; }

  if [ -d "$dir/.git" ]; then
    printf 'the MAIN CHECKOUT %s, whose .git is a directory and not a pointer file, so a server running here holds the port and writes into the shared tree' "$dir"
  elif [ -f "$dir/.git" ]; then
    printf 'the worktree %s' "$dir"
  else
    printf '%s' "$dir"
  fi
}

# board_script_path_from_args <argv-string> -- extract the .js script a node board
# was started with, from its full command line (`ps -p <pid> -o args=`). Prints
# the script token (which may be relative; the caller resolves it against the
# board's cwd) or NOTHING when the command line names no .js script (#2515).
#
# 🛑 WHY THE ARGV AND NOT `lsof -d txt`. Measured on this fleet for a live
# `node server.js` board: `-d txt` lists the node INTERPRETER and libnode, never
# server.js -- the script is an ordinary open file, not a text/executable
# mapping. The script path appears only in the argv. (This was the filer's
# weakest premise on #2515; the measurement settled it.)
#
# THE RULE: the FIRST whitespace token ending in `.js`. For `node [flags] X.js
# ...` that is the interpreter's script argument -- flags before it
# (--enable-source-maps) do not end in .js and are skipped, and args after it
# (--port 16180, a config path) come later. An installed-bundle `kosmos start`
# names no .js, so this prints nothing and the caller falls back rather than
# guessing: "unknown" stays a safe answer, per the card.
#
# KNOWN RESIDUALS, stated rather than guarded (none is a board shape here):
#   - `node -r pre.js server.js` (a preload) would mis-pick pre.js, the first .js.
#   - a script path containing whitespace splits; board paths here have none.
# The argv is attacker-shaped input in general; this only ever reads a token and
# hands it to `dirname`/`cd`, never evaluates it.
board_script_path_from_args() {
  local args="${1:-}" tok
  # `set -u` safe: $args defaulted. Unquoted expansion word-splits deliberately
  # (this file is bash, run under its own shebang and sourced into bash callers).
  for tok in $args; do
    case "$tok" in
      *.js) printf '%s' "$tok"; return 0 ;;
    esac
  done
  return 0
}

# board_code_dir_from_args <argv-string> <cwd> -- the directory the board's CODE
# lives in, resolved from the process command line (#2515). Prints the resolved
# absolute tree, or NOTHING when the argv names no .js script (installed-bundle
# shape, or anything unexpected) so the caller falls back to the cwd, never a
# guess. Pure w.r.t. the process -- the caller does the one `ps` read and hands
# the string here, so this is unit-testable with fixture argv strings.
board_code_dir_from_args() {
  local args="${1:-}" cwd="${2:-}" script
  script="$(board_script_path_from_args "$args")"
  [ -n "$script" ] || return 0
  # A relative script path is relative to the board's cwd (a board started as
  # `node server.js` from the repo root). Without a cwd to anchor it, decline.
  case "$script" in
    /*) ;;
    *) [ -n "$cwd" ] && script="$cwd/$script" || return 0 ;;
  esac
  # dirname of the script is the tree. `cd` + LOGICAL `pwd` resolves a `..`
  # segment while KEEPING the symlink spelling the process actually runs under
  # (macOS reports /Users and /var via firmlinks; `pwd -P` would rewrite them to
  # /System/Volumes/Data and /private and disagree with the cwd lsof reports).
  # board_origin_label handles symlinks itself (-ef compares inode, -d follows),
  # so a logical path is both correct and consistent. Silent (empty) if the
  # directory does not exist -- the caller then falls back to the cwd.
  ( CDPATH= cd "$(dirname "$script")" 2>/dev/null && pwd )
}
