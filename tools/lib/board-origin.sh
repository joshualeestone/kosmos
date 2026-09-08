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
# 🛑 ASK GIT, FROM ANY DEPTH. A board's cwd is often a SUBDIRECTORY of the
# checkout, not its root. An earlier version tested `$dir/.git` directly, which
# sees the git fact ONLY at the top level: a board running in `<repo>/engine`
# fell through to the bare path, i.e. exactly the output this function exists to
# replace. It also made the header's "keys on the git fact, not the path shape"
# claim FALSE, since testing for `.git` in the directory you were handed IS a
# path shape. `rev-parse --show-toplevel` resolves the root from any depth and
# errors (empty) when the path is not in a repo at all.
#
# The discriminator at that root: a main checkout's `.git` is a DIRECTORY; a
# linked worktree's `.git` is a FILE pointing at the real gitdir. Measured both
# ways on this machine, and asserted by two FIXTURE arms in the test so the
# assertions cannot go vacuous if git changes the layout.
#
# Deliberately DESCRIBES and never refuses. ~30 agents share this Mac and a
# board is normally up (one was, while this was written), so refusing on a live
# board would fail correct work constantly; a gate that fails correct work is
# worse than no gate. Naming it lets a person decide.
#
# 🛑 THE MAIN-CHECKOUT LABEL MUST NOT CONTAIN THE WORD "worktree". The worktree
# arm is detected by callers and tests matching that word, so putting it in the
# other branch's prose makes the two labels collide on a substring match.
#
# KNOWN RESIDUALS, stated rather than probed for. All three are exotic here:
#   - a bare repo, and a `--separate-git-dir` checkout: no `.git` directory in
#     the tree, so not labelled the main checkout
#   - a git SUBMODULE working directory: its `.git` is a FILE too, so it is
#     labelled a worktree
board_origin_label() {
  # `set -u` is on in the caller, so default every positional.
  local dir="${1:-}"
  [ -n "$dir" ] || { printf 'an unknown directory'; return 0; }
  # Not a directory any more (the process outlived its cwd): say what we were
  # told and nothing more. Inventing a classification here would be a guess.
  [ -d "$dir" ] || { printf '%s' "$dir"; return 0; }

  local top where
  top="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)"
  # Not inside a repo (an installed board runs from $HOME): unchanged wording.
  [ -n "$top" ] || { printf '%s' "$dir"; return 0; }

  if [ -d "$top/.git" ]; then
    where="the MAIN CHECKOUT $top, which house rules keep as a read-only reference, so a server running there holds the port and writes state"
  elif [ -f "$top/.git" ]; then
    where="the worktree $top"
  else
    printf '%s' "$dir"; return 0
  fi
  # A board started in a subdirectory: name the checkout AND where it actually sits.
  [ "$dir" = "$top" ] || where="$where (cwd $dir)"
  printf '%s' "$where"
}
