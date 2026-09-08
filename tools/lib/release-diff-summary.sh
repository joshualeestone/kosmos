#!/bin/sh
# release-diff-summary.sh -- kosmos#615. A file/area-level summary of what changed
# between two release points, so a drive-by fix that rode inside another PR with no
# card and no commit-message line still SURFACES in a searchable per-release artifact.
#
# 🔑 WHY THIS EXISTS. #615: "a fix riding inside another PR, with no card and no
# message line, is invisible to every search we run." Searching commit SUBJECTS
# (`git log --grep`) and the board are the two instruments we had, and both are blind
# to an uncarded fix by construction -- it exists only in the diff. Deriving the
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
  git -C "$from_repo" diff --stat=1000,1000 "$from_ref" "$to_ref"
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
