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
# 🛑 THE MAIN-CHECKOUT LABEL'S OWN PROSE MUST NOT CONTAIN THE WORD "worktree".
# The worktree arm is recognised by matching that word, so putting it in the
# other branch's fixed text makes the two labels collide on a substring match.
# Scope, stated exactly rather than as a guarantee: this constrains the PROSE
# only. Both labels interpolate a path, so a checkout whose own path contains
# "worktree" still collides. That is test fragility, not a functional bug: the
# only consumer that substring-matches the output is this library's own test;
# run-tests.sh interpolates the label into free text and never matches on it.
#
# KNOWN RESIDUALS, stated rather than probed for. All three are exotic here:
#   - a bare repo, and a `--separate-git-dir` checkout: no `.git` directory in
#     the tree, so not labelled the main checkout
#   - a git SUBMODULE working directory: its `.git` is a FILE too, so it is
#     labelled a worktree
#
# ⚠️ THE `git` CALL IS UNBOUNDED, DELIBERATELY, AND THAT IS A REAL RESIDUAL.
# On a wedged mount it could hang the pre-PR gate every agent runs. Measured
# before accepting it: this machine has NEITHER `timeout` NOR `gtimeout`
# (kosmos#2474), and `seen_before()` already runs `lsof -a -p <pid> -d cwd`
# against the same path THREE LINES EARLIER, plus an unbounded `find` over
# TMPDIR after it. So a bound here would be a visible guard that cannot help:
# the call before it reaches the same wedged mount first. Bounding one of four
# unbounded probes is the "safety mechanism that does nothing" shape.
# WHAT WOULD CHANGE THIS: a portable bound existing on the fleet, or a
# measurement showing `git` blocks where `lsof -d cwd` does not. The right fix
# is bounding the whole function, which is a different card.
board_origin_label() {
  # `set -u` is on in the caller, so default every positional.
  local dir="${1:-}"
  [ -n "$dir" ] || { printf 'an unknown directory'; return 0; }
  # Not a directory any more (the process outlived its cwd): say what we were
  # told and nothing more. Inventing a classification here would be a guess.
  [ -d "$dir" ] || { printf '%s' "$dir"; return 0; }

  # ONE git call for both answers. --show-prefix is $dir's path relative to the
  # top level and is EMPTY exactly when $dir IS the top level, which is a precise
  # test where comparing the two strings is not: a symlinked path resolves to a
  # different string for the same directory and would otherwise print a redundant
  # "(cwd ...)" naming the same place twice.
  local out top prefix where
  out="$(git -C "$dir" rev-parse --show-toplevel --show-prefix 2>/dev/null)"
  # Not inside a work tree (an installed board runs from $HOME; a bare repo has
  # none): unchanged wording.
  [ -n "$out" ] || { printf '%s' "$dir"; return 0; }
  top="${out%%$'\n'*}"
  if [ "$out" = "$top" ]; then prefix=""; else prefix="${out#*$'\n'}"; fi

  if [ -d "$top/.git" ]; then
    where="the MAIN CHECKOUT $top, which house rules keep as a read-only reference, so a server running there holds the port and writes state"
  elif [ -f "$top/.git" ]; then
    where="the worktree $top"
  else
    printf '%s' "$dir"; return 0
  fi
  # A board started in a subdirectory: name the checkout AND where it actually sits.
  [ -z "$prefix" ] || where="$where (cwd $dir)"
  printf '%s' "$where"
}
