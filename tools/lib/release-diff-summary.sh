#!/bin/sh
# release-diff-summary.sh -- kosmos#615. A file/area-level summary of what changed
# between two release points, so a drive-by fix that rode inside another PR with no
# card and no commit-message line still SURFACES in a searchable per-release artifact.
#
# 🔑 WHY THIS EXISTS. #615: "a fix riding inside another PR, with no card and no
# message line, is invisible to every search we run." `git log --grep` (which matches
# the whole commit message, but the bump body was EMPTY so there was nothing there to
# match an uncarded fix) and the board are the two instruments we had, and both are
# blind to an uncarded fix by construction -- it exists only in the diff. Deriving the
# release notes from the DIFF (Shape B, ratified) cannot regress that way: an
# unmentioned fix appears because its FILE appears, whether or not anyone remembered
# to mention it. (Shape A, a `Fixes:` trailer convention, fails silently the moment
# someone forgets -- the exact failure #615 names.)
#
# 🛑 FILE/AREA-LEVEL ONLY, NEVER RAW CONTENT. `git diff --stat` emits per-file paths
# and +/- line COUNTS and nothing else -- no hunks, no source. That is deliberate:
# the artifact is searchable ("did web/index.html change in this release?") without
# ever carrying the bytes of a change (a security fix's content, a secret) into a
# place a person reads. A caller must never swap this for `git diff` (the patch) or
# `git diff --stat -p`.
#
# 🔑 PATHS ARE THE POINT, so they must not be TRUNCATED. Plain `--stat` elides long
# paths to fit a terminal ("...ne/index.html"), which would defeat a grep for the
# full path. `--stat=1000,1000` gives a wide budget so real paths print whole.
#
# Usage: source, then `kosmos_release_diff_summary <repo> <from-ref> <to-ref>`.
# Prints the summary to stdout and returns 0. Returns 1 (printing nothing) when
# either ref does not resolve to a commit -- the caller is best-effort and must not
# fail a release cut over an unresolvable range.

# Print a file/area-level diff summary for <from>..<to> in <repo>. No raw content.
kosmos_release_diff_summary() {
  # shellcheck disable=SC2039
  from_repo="$1"; from_ref="$2"; to_ref="$3"
  [ -n "$from_repo" ] && [ -n "$from_ref" ] && [ -n "$to_ref" ] || return 1
  # Both endpoints must be real commits, or the range is meaningless. Verified
  # rather than assumed, because the caller derives `from` from a bump-commit
  # lookup that can miss (a hand-edited or absent bump), and a missing endpoint
  # must degrade to "no summary", never to a git error mid-cut.
  git -C "$from_repo" rev-parse --verify --quiet "${from_ref}^{commit}" >/dev/null 2>&1 || return 1
  git -C "$from_repo" rev-parse --verify --quiet "${to_ref}^{commit}" >/dev/null 2>&1 || return 1
  # File/area-level only: --stat is names + change COUNTS, never hunk content. The
  # wide width keeps real paths from being truncated (paths are what a reader greps).
  rds_full="$(git -C "$from_repo" diff --stat=1000,1000 "$from_ref" "$to_ref")" || return 1
  # 🛑 CAP THE OUTPUT so the caller's "never fails the commit" claim is ABSOLUTE. The
  # body rides as a `git commit -m` argument; a pathological range (a store-dir rename
  # touching thousands of files) could push argv past ARG_MAX (~1 MB) and E2BIG the
  # commit, which under the release's `set -e` would abort the cut. 500 file lines is
  # ~30 KB, far under ARG_MAX and far past any realistic release, and a truncation
  # marker points at the full diff so nothing is silently lost.
  rds_lines=$(printf '%s\n' "$rds_full" | wc -l | tr -d ' ')
  rds_bytes=$(printf '%s\n' "$rds_full" | wc -c | tr -d ' ')
  # Cap on BOTH axes. The body rides as one `git commit -m` argument, and the abort it
  # can cause is a BYTE limit, not a line count: macOS ARG_MAX is ~1 MB but Linux caps a
  # single argument at MAX_ARG_STRLEN (~128 KB), well below what 500 un-truncated long
  # paths could reach. So bound bytes too (100 KB, under the Linux per-arg limit and far
  # under macOS), making the "never fails the commit" guarantee absolute on both OSes and
  # not merely line-bounded.
  if [ "${rds_lines:-0}" -gt 500 ] || [ "${rds_bytes:-0}" -gt 100000 ]; then
    # 🔑 awk that DRAINS, never `exit`s. `head -n N` (or an `awk ...; exit`) closes stdin
    # early, so `printf` takes SIGPIPE (141) on the rest -- and under a `set -euo pipefail`
    # caller that 141 would ABORT, the very class this cap exists to prevent. This awk reads
    # EVERY line (so printf never SIGPIPEs, pipeline exits 0 on any OS/flags) and PRINTS only
    # the lines within BOTH the 500-line and 100 KB budgets.
    printf '%s\n' "$rds_full" | awk -v ml=500 -v mb=100000 '{ if (NR<=ml && b+length($0)+1<=mb) { print; b+=length($0)+1 } }'
    printf '... (%s lines / %s bytes total; truncated to keep the commit under ARG_MAX -- see: git diff --stat %s %s)\n' \
      "$rds_lines" "$rds_bytes" "$from_ref" "$to_ref"
  else
    printf '%s\n' "$rds_full"
  fi
}

# Derive the commit sha at which a given version was cut, from release.sh's OWN
# bump-commit subject. release.sh commits the bump as `v${V//./} -- version`
# (e.g. 0.6.05 -> "v0605 -- version"), so the message is release-authored and
# distinctive -- NOT an arbitrary card number in a body (the #615 --grep hazard the
# bulletin `a-bare-card-number-is-not-a-marker` warns about). Anchored to the exact
# subject so a body mention cannot match. Prints the sha and returns 0; prints
# nothing and returns 1 when no such bump commit is found (best-effort caller).
kosmos_release_bump_sha() {
  bs_repo="$1"; bs_version="$2"
  [ -n "$bs_repo" ] && [ -n "$bs_version" ] || return 1
  # The bump subject drops the dots: 0.6.05 -> v0605.
  bs_tag="v$(printf '%s' "$bs_version" | tr -d '.')"
  bs_sha="$(git -C "$bs_repo" log --grep="^${bs_tag} -- version\$" -E --format='%H' -1 2>/dev/null)"
  [ -n "$bs_sha" ] || return 1
  printf '%s\n' "$bs_sha"
}
