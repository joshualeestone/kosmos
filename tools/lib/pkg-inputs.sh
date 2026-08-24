#!/bin/bash
# The identity of the installer .pkg's INPUTS, so a served pkg can be proven
# current against source rather than trusted (#597's discipline, applied to
# the pkg per Splinter's B ruling, #638).
#
# ⚠️ WHY THIS EXISTS. The .pkg is payload-free and version-independent: it is
# rebuilt only when its own inputs change (the postinstall), NOT every cut. A
# slowly-changing artifact goes stale SILENTLY -- someone edits the postinstall,
# does not rebuild the pkg, and the served pkg runs an OLD postinstall while
# every test passes. And Kosmos.pkg + its .sha256 share one cache, so a stale
# pair verifies itself perfectly (the 0.5.13 wedge, different trigger). So the
# release does not SKIP the pkg (skipping is the hole); it compares the served
# pkg's inputs against what the CURRENT source would build.
#
# The input identity is the sha256 of everything the build consumes that
# decides the pkg's BEHAVIOUR, and since #665 that is four things, not one:
#   install/pkg-scripts/**        the postinstall (what runs)
#   install/pkg-resources/**      the Welcome and Conclusion screens (what the
#                                 person is told; #662/#663 live here)
#   tools/build-installer-pkg.sh  the build itself, because the
#                                 distribution.xml (title, screens, arch,
#                                 choices) is a template INSIDE it
#   the bundle identifier         baked into the component and the distribution
# NOT the version (metadata, and the pkg is version-independent) and NOT the
# signature/timestamp (those change every build and are not source).
# ⚠️ Hashing the whole build script means a comment edit there also asks for a
# rebuild + notarise + publish. That over-asks by minutes; the alternative
# under-asks by silently shipping an old Conclusion screen, which is the hole
# this guard exists to close. Baron's first pkg went out with new screens the
# guard's first draft could not see.
#
# Usage: source this file, then `pkg_input_sha <repo-root>` prints the sha.
pkg_input_sha() {
  local repo="${1:?pkg_input_sha needs a repo root}"
  local scripts="$repo/install/pkg-scripts"
  local resources="$repo/install/pkg-resources"
  local build="$repo/tools/build-installer-pkg.sh"
  # ALL inputs or nothing: a missing one is a refusal, never a sha over less.
  [ -d "$scripts" ]   || { echo "pkg_input_sha: no pkg-scripts at $scripts" >&2; return 1; }
  [ -d "$resources" ] || { echo "pkg_input_sha: no pkg-resources at $resources" >&2; return 1; }
  [ -f "$build" ]     || { echo "pkg_input_sha: no build script at $build" >&2; return 1; }
  # Deterministic: each input's path and bytes, in sorted order, under a
  # section label so a file moving between sections changes the sha too.
  {
    printf 'identifier:com.stonesyndicate.kosmos.installer\n'
    printf 'section:pkg-scripts\n'
    ( cd "$scripts" && find . -type f | LC_ALL=C sort | while IFS= read -r f; do
        printf '%s\n' "$f"; cat "$f"
      done )
    printf 'section:pkg-resources\n'
    ( cd "$resources" && find . -type f | LC_ALL=C sort | while IFS= read -r f; do
        printf '%s\n' "$f"; cat "$f"
      done )
    printf 'section:build-script\n'
    cat "$build"
  } | _pkg_hash | awk '{print $1}'
}

# A hasher that is a real command, never a string run as one.
_pkg_hash() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256; else sha256sum; fi
}

# Does the site's copy of the pkg need rebuilding + republishing? Prints ONE
# reason line and returns 0 (needed) or 1 (current). The decision reads the
# SITE checkout's dist (what the next deploy will serve), never the served
# host: the served host is what step 9c confirms AFTER the deploy.
#
# Four ways to need it, each named, because "rebuild" without a reason is the
# re-run-instead-of-read habit #708 is about:
#   no pkg          nothing to serve
#   no sidecar      the pkg predates the guard, its inputs are unknown
#   inputs differ   someone changed a postinstall, a screen or the build
#   pair broken     Kosmos.pkg and Kosmos.pkg.sha256 disagree (the one-cache
#                   wedge shape, or a half-copied publish)
pkg_publish_needed() {
  local dist="${1:?pkg_publish_needed needs the site dist dir}"
  local want="${2:?pkg_publish_needed needs the source input sha}"
  local pkg="$dist/Kosmos.pkg" side="$dist/Kosmos.pkg.inputs" sum="$dist/Kosmos.pkg.sha256"
  local have real pub
  [ -f "$pkg" ]  || { echo "no Kosmos.pkg in the site dist"; return 0; }
  [ -f "$side" ] || { echo "Kosmos.pkg has no input sidecar (it predates the guard)"; return 0; }
  have="$(tr -d '[:space:]' < "$side")"
  [ "$have" = "$want" ] || { echo "the pkg's inputs (${have:0:12}) differ from source (${want:0:12})"; return 0; }
  [ -f "$sum" ] || { echo "Kosmos.pkg has no .sha256 beside it"; return 0; }
  real="$(_pkg_hash < "$pkg" | awk '{print $1}')"
  pub="$(awk '{print $1}' < "$sum")"
  [ "$real" = "$pub" ] || { echo "Kosmos.pkg and Kosmos.pkg.sha256 disagree"; return 0; }
  echo "current: inputs match source (${want:0:12}) and the pair agrees"
  return 1
}
