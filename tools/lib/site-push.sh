#!/usr/bin/env bash
#
# #2276/#2278/#2286: push the site's release commit to origin/main, surviving a
# concurrent site merge that lands MID-CUT, without ever touching the shared site
# checkout's working tree, its real index, or its local main branch.
#
# THE RACE. Agents merge chaoskosmos-site PRs through GitHub while a cut runs, so
# origin/main can move between release.sh reading the site and pushing, and the
# push is then rejected non-fast-forward. Before this, 7b's only recovery was a
# MANUAL `git pull --rebase` and a re-cut (a forced version bump, because the
# bundle is not byte-reproducible) -- a routine race turned into an aborted release.
#
# WHAT #2286 CHANGED (and WHY). #2278 committed the release files on the SHARED
# LOCAL main and pushed that, replaying onto the fetched tip only AFTER a rejection.
# That left two accepted-interim defects, both rooted in committing on local main:
#   1. A concurrent edit to a release-owned path (realistically versions.html) was
#      OVERLAID by the replay -- our whole file won and the concurrent edit was lost
#      from the served tree.
#   2. A successful replay pushed a commit-tree commit but did NOT move local main,
#      so every LATER cut's first push was rejected and took the slow replay path.
# #2286 makes "build on the freshly-fetched origin/main tip" the ONLY path, so:
#   - local main is NEVER given a release commit, so it NEVER diverges (defect 2);
#   - versions.html is RE-INSERTED into the fresh page (its new entry added above
#     the newest existing entry) instead of overlaid, so a concurrent versions.html
#     edit survives (defect 1). The other release paths are cut-generated and
#     cut-owned, so taking our working-tree version of them is correct.
#
# HOW, without disturbing the shared checkout. Each attempt loads the fetched tip
# into a TEMPORARY index (GIT_INDEX_FILE), stages the release files there from the
# WORKING TREE (git add into the temp index reads the working tree read-only and
# writes only the temp index -- the real .git/index and the working tree are
# untouched, so a colleague's uncommitted page work is safe), overlays the
# re-inserted versions.html, write-tree + commit-tree onto the fetched tip, and
# pushes. read-tree loads the whole NEW tip, so a concurrent PAGE merge
# (design/*.html, index.html) is preserved. No `git pull --rebase` (it needs a
# clean tree, and this checkout is shared); no move of local main.
#
# BEHAVIOR CHANGE worth naming: the cut now serves exactly origin/main + the named
# release files. It no longer sweeps up whatever unpushed commits happened to sit
# on the shared local main (#2278 and earlier pushed those as a side effect). That
# is the safer behavior -- a cut should not carry random unpushed work, the same
# class of hazard as `git commit -a` -- but it is a change from the prior path.
#
# Usage (diagnostics go to STDERR; ONLY the finally-pushed sha is printed to
# STDOUT, so the caller captures the sha with $(...)):
#   SITE_SHA="$(site_commit_on_fresh_main "$SITE" "$MSG" "$BUILD_ROOT" 5 "$PATHS" "$V" "$REPO")" || exit 1
# PATHS is a single space-separated string of the release paths (word-split inside,
# matching how release.sh carries $_site_paths); it MUST include versions.html.
# REINDEX_DIR (BUILD_ROOT) is a writable ABSOLUTE dir for the throwaway index and
# temp files (release.sh's 2b trap removes it). V is the version (0.6.37 -> the
# id="v0-6-37" entry to re-insert). REPO is the code checkout, to find the node
# helper tools/reinsert-versions-entry.js.

site_commit_on_fresh_main() {
  local site="$1" msg="$2" reindex_dir="$3" max="$4" paths="$5" version="$6" repo="$7"
  # git resolves a relative GIT_INDEX_FILE against the -C dir, not the caller's
  # cwd, so a relative reindex_dir would write the temp index somewhere surprising.
  # Refuse rather than corrupt silently (release.sh passes BUILD_ROOT, absolute).
  case "$reindex_dir" in
    /*) ;;
    *) echo "site_commit_on_fresh_main: reindex_dir must be an absolute path (got '$reindex_dir')" >&2; return 1 ;;
  esac
  local reinsert="$repo/tools/reinsert-versions-entry.js"
  [ -f "$reinsert" ] || { echo "site_commit_on_fresh_main: cannot find $reinsert" >&2; return 1; }

  # The release paths that are cut-owned (everything except versions.html), staged
  # from the working tree by git add. versions.html is handled separately.
  local other_paths="" p
  # shellcheck disable=SC2086
  for p in $paths; do
    [ "$p" = "versions.html" ] || other_paths="$other_paths $p"
  done
  case " $paths " in
    *" versions.html "*) ;;
    *) echo "site_commit_on_fresh_main: paths must include versions.html (got '$paths')" >&2; return 1 ;;
  esac

  local attempt=1
  while :; do
    git -C "$site" fetch -q origin main || {
      echo "could not fetch origin/main to build the site release commit (no network?). Nothing was pushed." >&2
      return 1
    }
    local new_base
    # Resolve the remote-tracking ref, not FETCH_HEAD: the same fetch updates
    # refs/remotes/origin/main via the clone's default refspec, and unlike FETCH_HEAD
    # it cannot be moved out from under us by another agent's concurrent fetch in
    # this shared checkout between here and the push.
    new_base="$(git -C "$site" rev-parse origin/main)" || return 1
    [ -n "$new_base" ] || { echo "could not resolve the fetched origin/main tip; refusing to build the release commit" >&2; return 1; }

    local reindex="$reindex_dir/site-reindex.$attempt"
    local base_v="$reindex_dir/versions-base.$attempt"
    local merged_v="$reindex_dir/versions-merged.$attempt"
    rm -f "$reindex" "$base_v" "$merged_v"

    GIT_INDEX_FILE="$reindex" git -C "$site" read-tree "$new_base" || {
      echo "could not read the new site tip into a temp index; nothing was pushed" >&2; rm -f "$reindex"; return 1
    }
    # Cut-owned release files: stage the working-tree content (correct mode + bytes)
    # into the temp index only. Reads the working tree; writes only the temp index.
    # shellcheck disable=SC2086
    GIT_INDEX_FILE="$reindex" git -C "$site" add -- $other_paths || {
      echo "could not stage the release files into the temp index; nothing was pushed" >&2; rm -f "$reindex"; return 1
    }
    # versions.html: RE-INSERT our entry into the FRESH page (never overlay the
    # whole file), so a concurrent versions.html edit on origin/main survives.
    git -C "$site" show "$new_base:versions.html" > "$base_v" 2>/dev/null || {
      echo "could not read versions.html from the fetched tip; nothing was pushed" >&2; rm -f "$reindex" "$base_v"; return 1
    }
    node "$reinsert" "$base_v" "$site/versions.html" "$version" > "$merged_v" || {
      echo "could not re-insert the $version entry into the fresh versions.html; nothing was pushed" >&2; rm -f "$reindex" "$base_v" "$merged_v"; return 1
    }
    local vblob
    vblob="$(git -C "$site" hash-object -w "$merged_v")" || { echo "could not hash the merged versions.html" >&2; rm -f "$reindex" "$base_v" "$merged_v"; return 1; }
    [ -n "$vblob" ] || { echo "empty blob for the merged versions.html; refusing" >&2; rm -f "$reindex" "$base_v" "$merged_v"; return 1; }
    GIT_INDEX_FILE="$reindex" git -C "$site" update-index --add --cacheinfo "100644,$vblob,versions.html" || {
      echo "could not stage the merged versions.html into the temp index" >&2; rm -f "$reindex" "$base_v" "$merged_v"; return 1
    }

    local new_tree sha
    new_tree="$(GIT_INDEX_FILE="$reindex" git -C "$site" write-tree)"
    rm -f "$reindex" "$base_v" "$merged_v"
    [ -n "$new_tree" ] || { echo "could not write the release tree; nothing was pushed" >&2; return 1; }
    sha="$(git -C "$site" commit-tree "$new_tree" -p "$new_base" -m "$msg")"
    [ -n "$sha" ] || { echo "could not create the release commit; nothing was pushed" >&2; return 1; }

    local push_err push_rc
    # LC_ALL=C so git's rejection text stays English and the discrimination grep
    # below is locale-independent (a translated "non-fast-forward" would otherwise
    # be misread as a non-race failure -- it fails safe, but this removes the risk).
    push_err="$(LC_ALL=C git -C "$site" push -q origin "$sha:refs/heads/main" 2>&1)"; push_rc=$?
    if [ "$push_rc" = 0 ]; then
      printf '%s\n' "$sha"
      return 0
    fi
    # Retry ONLY a genuine non-fast-forward rejection (origin/main moved again in
    # our fetch->push window). Any other failure -- auth, a protected ref, a broken
    # remote -- is not a race; abort immediately with git's own error rather than
    # burning retries and then misreporting "origin/main kept moving".
    # The `printf | grep` pipe is SAFE here (unlike release_versions_entry_present's
    # deliberate no-pipe capture): $push_err is a few lines of git error text, well
    # under the pipe buffer, so printf never gets SIGPIPE from grep -q exiting early.
    # Do NOT copy this pattern to large data, and do not "fix" the versions check to
    # a pipe -- there the 269KB page DOES trigger the SIGPIPE-under-pipefail abort.
    if ! printf '%s' "$push_err" | grep -qiE 'fetch first|non-fast-forward|\[rejected\]|cannot lock ref|failed to (update|lock) ref'; then
      echo "site push failed for a reason that is not a moved origin/main; not retrying. git said:" >&2
      printf '%s\n' "$push_err" >&2
      return 1
    fi
    if [ "$attempt" -ge "$max" ]; then
      echo "could not push the site after $max attempts (origin/main kept moving). Nothing was pushed; local main is unchanged." >&2
      echo "Recover: re-run release.sh; expect to bump the version, because the bundle build is not byte-reproducible and the versioned name refuses different bytes." >&2
      return 1
    fi
    echo "   site push rejected (origin/main moved); rebuilding the release commit on the new tip (attempt $attempt of $max)" >&2
    attempt=$((attempt + 1))
  done
}

# Verify the pushed release commit carries a versions.html entry for $version.
# Returns 0 present, 1 absent, 2 could not read versions.html from the sha.
#
# 🛑 NO PIPE. `git show ... | grep -q` is WRONG here under the cut's `set -o pipefail`:
# versions.html is ~269KB and the new entry is at the TOP, so grep -q matches early
# and closes the pipe, git show dies of SIGPIPE (141), pipefail makes the pipeline
# status 141, and the caller's `if !` reads that as "entry absent" -- a FALSE abort
# on essentially every real cut, AFTER the commit has already been pushed. Capture
# once (a few hundred KB is fine for a shell variable) and match with `case`, which
# has no subprocess whose exit status pipefail could poison.
release_versions_entry_present() {
  local site="$1" sha="$2" version="$3"
  local id="v${version//./-}" html
  html="$(git -C "$site" show "$sha:versions.html")" || return 2
  case "$html" in
    *"id=\"$id\""*) return 0 ;;
    *) return 1 ;;
  esac
}
