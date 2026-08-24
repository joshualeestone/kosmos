#!/bin/bash
# The tree a release tests is the tree it builds, by construction (#597).
#
# ⚠️ WHY THIS EXISTS. release.sh used to run every step in the shared main
# checkout, and that checkout is pulled by every agent on the Mac (auto-sync).
# On 2026-08-24 two cuts in a row were fast-forwarded mid-run: the suite and
# the page gate ran on one sha and the bundle that shipped was another, and
# only a byte diff of the SERVED bundle showed it. "Clean and on main" at
# step 1 is a fact about one instant.
#
# So the release freezes: a detached worktree at the bump sha, made by the
# release and removed by it, in which steps 3 through 6 run. A pull into the
# shared checkout from then on changes nothing the release tests or builds.
# And the served bundle is compared against that tree, so the log's "built
# <sha>" is measured rather than remembered.
#
# Usage: source this file.
#   build="$(release_freeze <repo> <sha> <root>)"   prints the worktree path
#   release_thaw <repo> <build>                     removes it
#   release_bundle_matches_tree <tarball> <tree>    0 if every app/ file in the
#       tarball equals the tree's (web/index.html after the version bake, the
#       one substitution the bundle build makes); prints each difference

release_freeze() {
  local repo="$1" sha="$2" root="$3" build
  [ -n "$repo" ] && [ -n "$sha" ] && [ -n "$root" ] || { echo "release_freeze: repo, sha and root are required" >&2; return 1; }
  build="$root/kosmos-$sha"
  # git's chatter to stderr, never into the stdout this function returns.
  git -C "$repo" worktree add --detach -q "$build" "$sha" >&2 || return 1
  # ⚠️ Checked, not assumed: the worktree is AT the sha and carries nothing
  # else. A worktree that resolved the sha to something else, or picked up
  # untracked files, would put the whole class back with a reassuring path.
  # ⚠️ THE ADD SUCCEEDED, so a failed check below must remove the worktree it
  # made -- otherwise the shared checkout keeps a phantom registration in
  # .git/worktrees until git gc, and the caller's EXIT trap is not installed
  # until it has this function's return value.
  if [ "$(git -C "$build" rev-parse HEAD)" != "$sha" ]; then
    echo "release_freeze: $build is not at $sha" >&2; release_thaw "$repo" "$build"; return 1
  fi
  if [ -n "$(git -C "$build" status --porcelain)" ]; then
    echo "release_freeze: $build is not clean" >&2; release_thaw "$repo" "$build"; return 1
  fi
  printf '%s' "$build"
}

release_thaw() {
  local repo="$1" build="$2"
  [ -n "$build" ] && [ -d "$build" ] || return 0
  git -C "$repo" worktree remove --force "$build" 2>/dev/null || rm -rf "$build"
  git -C "$repo" worktree prune 2>/dev/null
}

# Where a bundle path comes from in the tree, when it is not the same path.
# ⚠️ ONE RELOCATION, AND IT IS STATED IN TWO PLACES: here and the `cp` in
# tools/build-kosmos-bundle.sh that performs it. Add a relocation there and
# not here and the next release refuses at step 9b with "not in the tree",
# which is the loud direction; the reverse (here and not there) cannot make
# a mismatch pass, because the file would then be missing from the bundle.
# Map a path AS IT SITS IN THE TARBALL to the tree file it was copied from.
# ⚠️ EACH RELOCATION IS STATED HERE AND AT THE `cp` IN build-kosmos-bundle.sh
# THAT PERFORMS IT. app/* mirrors the repo root; two files are relocated
# (bin/kosmos <- install/kosmos, app/bin/kosmos-report-hook.sh <-
# install/kosmos-report-hook.sh); everything else under app/ keeps its path
# with the app/ prefix stripped. Add a relocation there and not here and the
# next release refuses at step 9b with "not in the tree", the loud direction.
release_bundle_source_path() {
  case "$1" in
    bin/kosmos)                    printf '%s' "install/kosmos" ;;
    app/bin/kosmos-report-hook.sh) printf '%s' "install/kosmos-report-hook.sh" ;;
    app/*)                         printf '%s' "${1#app/}" ;;
    *)                             printf '%s' "$1" ;;
  esac
}

# Compare every TREE-DERIVED file the served bundle ships against the tree it
# was built from: app/** and the top-level bin/kosmos (the command every user
# runs). runtime/** (a downloaded Node) and VERSION (a build stamp) are not
# tree files and are deliberately not extracted, so they cannot be compared.
# app/web/index.html is compared after the one substitution the build makes.
# $3 (optional): the expected sha256 of app/bin/kosmos-tunnel. The connector
# is NOT a tree file (kosmos-relay builds it), so it is verified against this
# checksum -- the sha of the tunnel THIS release built -- rather than skipped.
# Passing it empty means no bundle is expected to carry a tunnel, and a tunnel
# appearing anyway is a failure (a file the comparison has no source for).
release_bundle_matches_tree() {
  local tar="$1" tree="$2" want_tunnel_sha="${3:-}" tmp ver rel src cmpfile got_tunnel_sha saw_tunnel=0 bad=0
  [ -f "$tar" ] && [ -d "$tree" ] || { echo "release_bundle_matches_tree: need a tarball and a tree" >&2; return 2; }
  ver="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$tree/package.json" | head -1)"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-bundle-cmp.XXXXXX")" || return 2
  # `app bin`: the two tree-derived trees. A tarball missing either is a
  # failure, not a skip -- tar exits non-zero when a named member is absent.
  tar -xzf "$tar" -C "$tmp" app bin || { rm -rf "$tmp"; echo "release_bundle_matches_tree: could not read app/ and bin/ from $tar" >&2; return 2; }
  local n=0
  while IFS= read -r rel; do
    n=$((n+1))
    if [ "$rel" = app/bin/kosmos-tunnel ]; then
      # The connector: verified against the built tunnel's checksum, not the tree.
      if [ -z "$want_tunnel_sha" ]; then echo "   the bundle carries a connector but no expected checksum was given: $rel"; bad=1; continue; fi
      saw_tunnel=1
      got_tunnel_sha="$(shasum -a 256 "$tmp/$rel" | awk '{print $1}')"
      [ "$got_tunnel_sha" = "$want_tunnel_sha" ] || { echo "   the served connector is not the one this release built ($got_tunnel_sha != $want_tunnel_sha): $rel"; bad=1; }
      continue
    fi
    src="$(release_bundle_source_path "$rel")"
    cmpfile="$tmp/$rel"
    if [ ! -f "$tree/$src" ]; then echo "   not in the tree: $rel"; bad=1
    elif [ "$rel" = app/web/index.html ]; then
      sed "s/__KOSMOS_VERSION__/$ver/" "$tree/$src" | cmp -s - "$cmpfile" || { echo "   differs from the tree beyond the baked version: $rel"; bad=1; }
    else
      cmp -s "$tree/$src" "$cmpfile" || { echo "   differs from the tree: $rel"; bad=1; }
    fi
  done < <(cd "$tmp" && find app bin -type f 2>/dev/null | sed 's|^\./||')
  rm -rf "$tmp"
  # ⚠️ An empty bundle compares equal to everything; zero files is a failure.
  [ "$n" -gt 0 ] || { echo "   the bundle holds no tree-derived files" ; return 1; }
  # ⚠️ PRESENCE, not just checksum-if-present: when a connector sha is
  # expected (a real cut), a bundle that shipped WITHOUT the connector must
  # fail -- a Kosmos with no Plus connector is the exact thing #583 prevents,
  # and its tree files would otherwise all match and pass here.
  if [ -n "$want_tunnel_sha" ] && [ "$saw_tunnel" -eq 0 ]; then
    echo "   the bundle carries no Plus connector (app/bin/kosmos-tunnel) but one was expected"; bad=1
  fi
  return $bad
}
