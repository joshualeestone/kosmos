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
# decides the pkg's BEHAVIOUR, and since #665 that is three paths, not one:
#   install/pkg-scripts/**        the postinstall (what runs)
#   install/pkg-resources/**      the Welcome and Conclusion screens (what the
#                                 person is told; #662/#663 live here)
#   tools/build-installer-pkg.sh  the build itself, because the
#                                 distribution.xml (title, screens, arch,
#                                 choices) is a template INSIDE it
# (The bundle identifier is baked in by the build script, which is hashed, so
# it is not listed a second time here; a copy could drift from the real one.)
# NOT the version (metadata, and the pkg is version-independent) and NOT the
# signature/timestamp (those change every build and are not source), and NOT
# mtimes: bytes only, so a fresh worktree hashes the same as the one it froze.
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
  # ⚠️ DOTFILES AND DOT-DIRECTORIES EXCLUDED. verify-served.sh runs this on the
  # SHARED checkout's working tree, where a .DS_Store from opening the folder
  # in Finder, or an editor's swap file, would report the served pkg as stale
  # against a sha nobody built. pkgbuild ships them too, but a hidden file has
  # never been a deliberate input here; if one ever is, name it and drop this.
  # ⚠️ EVERY INPUT READABLE FIRST: a `cat` failing inside the pipeline below
  # would hash the file as absent (the group's status is its last command),
  # which is "hashing less", the thing this function refuses to do.
  local f
  for f in $(cd "$scripts" && find . -type f ! -path '*/.*' | LC_ALL=C sort | sed "s|^|$scripts/|") \
           $(cd "$resources" && find . -type f ! -path '*/.*' | LC_ALL=C sort | sed "s|^|$resources/|") "$build"; do
    [ -r "$f" ] || { echo "pkg_input_sha: cannot read input $f" >&2; return 1; }
  done
  {
    printf 'section:pkg-scripts\n'
    ( cd "$scripts" && find . -type f ! -path '*/.*' | LC_ALL=C sort | while IFS= read -r f; do
        printf '%s\n' "$f"; cat "$f"
      done )
    printf 'section:pkg-resources\n'
    ( cd "$resources" && find . -type f ! -path '*/.*' | LC_ALL=C sort | while IFS= read -r f; do
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

# The sidecar, Kosmos.pkg.inputs, is TWO lines and vouches for bytes, not
# only for inputs:
#   line 1   the input sha (pkg_input_sha) the pkg was built from
#   line 2   pkg:<sha256 of the Kosmos.pkg bytes>
# Without line 2 a mixed edge state (a new sidecar beside the PRIOR pkg pair,
# each self-consistent) passed every served check. With it, the sidecar names
# the bytes it describes, and any reader can bind the three files together.
pkg_sidecar_write() {   # <pkg-file> <input-sha> <sidecar-file>
  local pkg="${1:?}" insha="${2:?}" out="${3:?}"
  printf '%s\npkg:%s\n' "$insha" "$(_pkg_hash < "$pkg" | awk '{print $1}')" > "$out"
}
pkg_sidecar_inputs() { sed -n '1p' "${1:?}" | tr -d '[:space:]'; }             # <sidecar-file>
pkg_sidecar_pkgsha() { sed -n '2p' "${1:?}" | sed 's/^pkg://' | tr -d '[:space:]'; }

# Does the site's copy of the pkg need rebuilding + republishing? Prints ONE
# reason line and returns 0 (needed) or 1 (current). The decision reads the
# SITE checkout's dist (what the next deploy will serve), never the served
# host: the served host is what step 9c confirms AFTER the deploy.
#
# Five ways to need it, each named, because "rebuild" without a reason is the
# re-run-instead-of-read habit #708 is about:
#   no pkg          nothing to serve
#   no sidecar      the pkg predates the guard, its inputs are unknown
#   inputs differ   someone changed a postinstall, a screen or the build
#   pair broken     Kosmos.pkg and Kosmos.pkg.sha256 disagree (the one-cache
#                   wedge shape, or a half-copied publish)
#   sidecar orphan  the sidecar vouches for different bytes than the pkg's
pkg_publish_needed() {
  local dist="${1:?pkg_publish_needed needs the site dist dir}"
  local want="${2:?pkg_publish_needed needs the source input sha}"
  local pkg="$dist/Kosmos.pkg" side="$dist/Kosmos.pkg.inputs" sum="$dist/Kosmos.pkg.sha256"
  local have real pub vouch
  [ -f "$pkg" ]  || { echo "no Kosmos.pkg in the site dist"; return 0; }
  [ -f "$side" ] || { echo "Kosmos.pkg has no input sidecar (it predates the guard)"; return 0; }
  have="$(pkg_sidecar_inputs "$side")"
  [ "$have" = "$want" ] || { echo "the pkg's inputs (${have:0:12}) differ from source (${want:0:12})"; return 0; }
  [ -f "$sum" ] || { echo "Kosmos.pkg has no .sha256 beside it"; return 0; }
  real="$(_pkg_hash < "$pkg" | awk '{print $1}')"
  pub="$(awk '{print $1}' < "$sum")"
  [ "$real" = "$pub" ] || { echo "Kosmos.pkg and Kosmos.pkg.sha256 disagree"; return 0; }
  vouch="$(pkg_sidecar_pkgsha "$side")"
  [ "$vouch" = "$real" ] || { echo "the sidecar vouches for other bytes (${vouch:0:12}) than Kosmos.pkg's (${real:0:12})"; return 0; }
  echo "current: inputs match source (${want:0:12}), the pair agrees, the sidecar vouches for these bytes"
  return 1
}
