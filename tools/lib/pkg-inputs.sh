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
# The input identity is the sha256 of everything pkgbuild consumes that decides
# the pkg's BEHAVIOUR: the pkg-scripts (the postinstall) and the bundle
# identifier. NOT the version (metadata, and the pkg is version-independent)
# and NOT the signature/timestamp (those change every build and are not source).
#
# Usage: source this file, then `pkg_input_sha <repo-root>` prints the sha.
pkg_input_sha() {
  local repo="${1:?pkg_input_sha needs a repo root}"
  local scripts="$repo/install/pkg-scripts"
  [ -d "$scripts" ] || { echo "pkg_input_sha: no pkg-scripts at $scripts" >&2; return 1; }
  # Deterministic: every pkg-scripts file's path and bytes, in sorted order,
  # plus the identifier the build bakes in.
  {
    printf 'identifier:com.stonesyndicate.kosmos.installer\n'
    ( cd "$scripts" && find . -type f | LC_ALL=C sort | while IFS= read -r f; do
        printf '%s\n' "$f"; cat "$f"
      done )
  } | _pkg_hash | awk '{print $1}'
}

# A hasher that is a real command, never a string run as one.
_pkg_hash() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256; else sha256sum; fi
}
