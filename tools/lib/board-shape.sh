#!/usr/bin/env bash
# board-shape.sh -- the ONE classifier for com.kosmos.board's deploy shape (#2860).
#
# tools/release.sh (step 10a, refresh the libexec-deployed board before the restart)
# and tools/restart-local-board.sh (the #360 restart) both decide the SAME thing: which
# of three shapes the live board runs in, told apart by the launchd job's WORKING
# DIRECTORY. They derived it separately (#1164), and if the two drift a release can
# deploy one shape while the restart classifies another. This is the single source; both
# callers use these functions, so the two decisions cannot diverge.
#
#   (a) repo    -- WD == the repo working tree. The #360 hazard; a restart brings the
#                  board back on the code on disk in the checkout.
#   (b) libexec -- WD == install-board.sh's DEST (KOSMOS_BOARD_LIBEXEC). The #1164 deploy.
#   (c) other   -- an empty WD (an end-user bundle's launchd job has NO working-directory
#                  line, so WD parses empty) or any path matching neither. FAIL SAFE:
#                  never deployed to, never restarted -- an unknown shape is left alone.

# board_shape_libexec_default -- the libexec DEST, respecting KOSMOS_BOARD_LIBEXEC. This
# is the SAME default install-board.sh uses to place the board, so a libexec board's
# launchd WorkingDirectory and this value agree by construction (see board_shape_of).
board_shape_libexec_default() {
  printf '%s\n' "${KOSMOS_BOARD_LIBEXEC:-$HOME/.local/libexec/kosmos-board}"
}

# board_shape_working_dir <launchctl-print-output> -- echo the job's working directory,
# or empty when there is no such line (shape (c), a bundle) or no job. Takes the caller's
# ALREADY-CAPTURED `launchctl print gui/<uid>/com.kosmos.board` output as an argument,
# rather than re-running launchctl, because restart-local-board.sh also parses PORT from
# the same output -- one launchctl call per caller, parsed identically here.
board_shape_working_dir() {
  printf '%s\n' "$1" | sed -n 's/^[[:space:]]*working directory = //p' | head -1
}

# board_shape_of <wd> <repo> <libexec> -- echo repo | libexec | other.
#
# A caller that does not distinguish shape (a) (release.sh only acts on the libexec
# deploy) passes an empty <repo>, so a non-empty WD can only match <libexec> or fall
# through to `other` -- preserving that caller's exact "act iff libexec" decision.
#
# DELIBERATE DECISION on symlinked/normalized paths (#2860): the comparison is an EXACT
# STRING match, NOT a realpath/pwd -P normalization. install-board.sh sets the launchd
# WorkingDirectory to the SAME string a caller passes as <libexec> (the
# KOSMOS_BOARD_LIBEXEC override, or the identical default), so a real libexec board's WD
# and <libexec> agree by construction without normalizing. Normalizing would (1) turn a
# fail-safe no-op into an ACTION for a board whose WD only RESOLVES to repo/libexec
# through a symlink -- a behavior change in the release-critical cut path -- and (2)
# require the paths to EXIST to canonicalize, which <libexec> need not. If a real
# launchd-canonicalization divergence is ever observed on a Mac, THIS one function is the
# single place to add normalization, and both callers get it at once.
board_shape_of() {
  local _bs_wd _bs_repo _bs_libexec   # self-contained: safe for a future non-subshell caller
  _bs_wd="$1"; _bs_repo="$2"; _bs_libexec="$3"
  if [ -n "$_bs_wd" ] && [ "$_bs_wd" = "$_bs_repo" ]; then
    printf 'repo\n'
  elif [ -n "$_bs_wd" ] && [ "$_bs_wd" = "$_bs_libexec" ]; then
    printf 'libexec\n'
  else
    printf 'other\n'
  fi
}
