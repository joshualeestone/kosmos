#!/usr/bin/env bash
#
# #2276: push the site's release commit to origin/main, surviving a concurrent
# site merge that lands MID-CUT, without ever touching the shared site checkout's
# working tree or index.
#
# THE RACE. Agents merge chaoskosmos-site PRs through GitHub while a cut runs, so
# origin/main can move between release.sh reading the local site HEAD and pushing
# it, and the push is then rejected non-fast-forward. Before this, 7b's only
# recovery was a MANUAL `git pull --rebase` and a re-cut (a forced version bump,
# because the bundle is not byte-reproducible) -- a routine race turned into an
# aborted release.
#
# WHY NOT `git pull --rebase` IN THE SCRIPT. The site checkout is SHARED and
# "carries other people's in-progress page work" (see 7b's header and step 8 in
# release.sh); a rebase needs a clean tree, so an in-script rebase would fail on,
# or disturb, a colleague's uncommitted edits. A local lock cannot help either:
# the merges that cause the race happen on GitHub, not through this script.
#
# WHAT THIS DOES INSTEAD. On a rejection it REPLAYS only the release-owned files
# onto the fetched tip, in a TEMPORARY index (GIT_INDEX_FILE) with read-tree +
# update-index --cacheinfo + write-tree + commit-tree. None of those read or write
# the working tree or the real .git/index, so a colleague's uncommitted page work
# is untouched. read-tree loads the whole NEW tip, and only the named release paths
# are overlaid from our commit, so a concurrent PAGE merge (design/*.html,
# index.html -- never these release paths) is preserved and re-applied on top of.
# Then it retries, bounded.
#
# Usage (diagnostics go to STDERR; ONLY the finally-pushed sha is printed to
# STDOUT, so the caller captures the sha with $(...)):
#   SITE_SHA="$(site_push_with_replay "$SITE" "$SITE_SHA" "$MSG" "$REINDEX_DIR" 5 "$PATHS")" || exit 1
# PATHS is a single space-separated string of the release paths (word-split inside,
# matching how release.sh carries $_site_paths). REINDEX_DIR is a writable dir for
# the throwaway index (release.sh passes BUILD_ROOT, which its 2b trap removes).
#
# TWO KNOWN LIMITATIONS, both rooted in the same thing (the cut commits on the
# SHARED checkout's local main, which this function does NOT sync), and both a
# design call for the cut owner rather than something this helper can fix alone:
#
#   1. If a concurrent merge edits one of the RELEASE-OWNED paths (most plausibly
#      versions.html), the overlay silently re-applies our version and that edit is
#      lost from the replayed commit. This does NOT happen for the case #2276 is
#      about -- a page/design merge (design/*.html, index.html) never touches these
#      paths -- so the common race is safe. A loud detect-and-abort was considered
#      and rejected here: because local main is left diverged (limitation 2), a
#      naive "did this path change on origin" check would false-fire on our OWN
#      prior replays. The robust fix is to build the release commit on a
#      freshly-fetched origin/main so local main never diverges; that reshapes 7b
#      and belongs to the cut. Until then: release-path edits should not be merged
#      to the site during a cut.
#   2. A successful replay pushes a commit-tree commit to origin/main but does NOT
#      move local main (moving it would need a working-tree update, which would
#      disturb the shared checkout). So after any race, local main stays behind
#      origin/main and EVERY later cut's first push is rejected and takes the
#      replay path even with no concurrent merge. This self-heals each time (the
#      deploy uses the returned sha, not local main) -- it is a slow path, not a
#      correctness failure.

site_push_with_replay() {
  local site="$1" start_sha="$2" msg="$3" reindex_dir="$4" max="$5" paths="$6"
  # The temp index is written via GIT_INDEX_FILE while running git with -C "$site",
  # and git resolves a relative GIT_INDEX_FILE against the -C dir, not the caller's
  # cwd -- so a relative reindex_dir would write the index somewhere surprising.
  # Refuse rather than corrupt silently (release.sh passes BUILD_ROOT, absolute).
  case "$reindex_dir" in
    /*) ;;
    *) echo "site_push_with_replay: reindex_dir must be an absolute path (got '$reindex_dir')" >&2; return 1 ;;
  esac
  local sha="$start_sha" attempt=1
  while :; do
    local push_err push_rc
    # LC_ALL=C so git's rejection text stays English and the discrimination grep
    # below is locale-independent (a translated "non-fast-forward" would otherwise
    # be misread as a non-race failure -- it fails safe, but this removes the risk).
    push_err="$(LC_ALL=C git -C "$site" push -q origin "$sha:refs/heads/main" 2>&1)"; push_rc=$?
    if [ "$push_rc" = 0 ]; then
      printf '%s\n' "$sha"
      return 0
    fi
    # Retry ONLY a genuine non-fast-forward rejection (origin/main moved). Any other
    # push failure -- auth, a protected ref, a broken remote -- is not a race, so
    # burning the retries on it and then reporting "origin/main kept moving" would
    # misdiagnose it; abort immediately with git's own error instead.
    if ! printf '%s' "$push_err" | grep -qiE 'fetch first|non-fast-forward|\[rejected\]|cannot lock ref|failed to (update|lock) ref'; then
      echo "site push failed for a reason that is not a moved origin/main; not retrying. git said:" >&2
      printf '%s\n' "$push_err" >&2
      return 1
    fi
    if [ "$attempt" -ge "$max" ]; then
      echo "could not push the site after $max attempts (origin/main kept moving). The site commit is local ($sha)." >&2
      echo "Recover: git -C \"$site\" fetch origin main, confirm the release paths are the only ones you own on that tip, then re-run release.sh; expect to bump the version, because the bundle build is not byte-reproducible and the versioned name refuses different bytes." >&2
      return 1
    fi
    echo "   site push rejected (origin/main moved); replaying the release files onto the new tip (attempt $attempt of $max)" >&2
    git -C "$site" fetch -q origin main || {
      echo "could not fetch origin/main to replay the site commit (no network?). The site commit is local ($sha)." >&2
      return 1
    }
    local new_base
    new_base="$(git -C "$site" rev-parse FETCH_HEAD)" || return 1
    [ -n "$new_base" ] || { echo "could not resolve the fetched origin/main tip; refusing to replay" >&2; return 1; }
    local reindex="$reindex_dir/site-reindex.$attempt"
    rm -f "$reindex"
    GIT_INDEX_FILE="$reindex" git -C "$site" read-tree "$new_base" || {
      echo "could not read the new site tip into a temp index; refusing to replay" >&2; rm -f "$reindex"; return 1
    }
    local p lt mode osha
    # shellcheck disable=SC2086
    for p in $paths; do
      lt="$(git -C "$site" ls-tree "$sha" -- "$p")"
      [ -n "$lt" ] || { echo "the release file '$p' is missing from the site commit $sha; refusing to replay" >&2; rm -f "$reindex"; return 1; }
      mode="$(printf '%s\n' "$lt" | awk '{print $1}')"
      osha="$(printf '%s\n' "$lt" | awk '{print $3}')"
      [ -n "$mode" ] && [ -n "$osha" ] || { echo "could not parse the tree entry for '$p'; refusing to replay" >&2; rm -f "$reindex"; return 1; }
      GIT_INDEX_FILE="$reindex" git -C "$site" update-index --add --cacheinfo "$mode,$osha,$p" || {
        echo "could not stage '$p' into the replay tree" >&2; rm -f "$reindex"; return 1
      }
    done
    local new_tree
    new_tree="$(GIT_INDEX_FILE="$reindex" git -C "$site" write-tree)"
    rm -f "$reindex"
    [ -n "$new_tree" ] || { echo "could not write the replay tree; refusing to replay" >&2; return 1; }
    sha="$(git -C "$site" commit-tree "$new_tree" -p "$new_base" -m "$msg")"
    [ -n "$sha" ] || { echo "could not create the replay commit; refusing to replay" >&2; return 1; }
    attempt=$((attempt + 1))
  done
}
