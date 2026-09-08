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
# 🛑 THE DISCRIMINATOR IS THE GIT FACT, NOT THE PATH SHAPE. A main checkout's
# `.git` is a DIRECTORY; a linked worktree's `.git` is a FILE pointing at the
# real gitdir. Measured both ways on this machine. Matching on `~/work/<repo>`
# vs `~/work/<repo>-<branch>` was rejected: it encodes a naming convention
# rather than the thing being asked about, and it is wrong for any checkout
# kept elsewhere.
#
# Deliberately DESCRIBES and never refuses. ~30 agents share this Mac and a
# board is normally up (one was, while this was written), so refusing on a live
# board would fail correct work constantly; a gate that fails correct work is
# worse than no gate. Naming it lets a person decide.
#
# KNOWN RESIDUAL, stated rather than probed for: a bare repo or a
# `--separate-git-dir` checkout has no `.git` directory in the tree and would
# not be labelled the main checkout. Neither exists on this fleet.
board_origin_label() {
  # `set -u` is on in the caller, so default every positional.
  local dir="${1:-}"
  [ -n "$dir" ] || { printf 'an unknown directory'; return 0; }
  # Not a directory any more (the process outlived its cwd): say what we were
  # told and nothing more. Inventing a classification here would be a guess.
  [ -d "$dir" ] || { printf '%s' "$dir"; return 0; }
  if [ -d "$dir/.git" ]; then
    printf 'the MAIN CHECKOUT %s, where a live board holds the port and writes state (the worktree rule exists to prevent this)' "$dir"
  elif [ -f "$dir/.git" ]; then
    printf 'the worktree %s' "$dir"
  else
    printf '%s' "$dir"
  fi
}
