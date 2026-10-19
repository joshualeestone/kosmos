#!/bin/bash
# The build-machine home-path gate (#6549, from the #1760 shipped-artifact pass). A release must not carry the
# account folder of the Mac that built it: the connector once held the build Mac's home path hundreds of times
# (the Rust compiler's source paths, now remapped by kosmos-relay tools/build-tunnel-release.sh).
# Every staged file but the upstream Node runtime is read as bytes, binary or text, so a source comment that quotes
# the build Mac is caught the same way. A home it cannot use (empty, relative, or the root) is refused, never skipped:
# a gate that passes because it could not look is the failure this repo bans.
#
# Usage: source this file, then `home_path_gate_tree <stage> [<home>]` (home defaults to $HOME).
# Prints each offending file (relative to the stage) and returns 1 when any is found.

home_path_gate_tree() {
  local stage="$1" home="${2:-$HOME}" part hits=""
  case "$home" in
    /*/*) ;;
    *) echo "FAIL: the home-path gate needs the build user's home folder (got '$home')" >&2; return 1 ;;
  esac
  [ -d "$stage" ] || { echo "FAIL: the home-path gate has no stage at $stage" >&2; return 1; }
  home="${home%/}/"
  for part in app bin; do
    [ -d "$stage/$part" ] || { echo "FAIL: the home-path gate found no $part/ in the stage" >&2; return 1; }
    hits="$hits$(LC_ALL=C /usr/bin/grep -rlaF -e "$home" "$stage/$part" 2>/dev/null)"$'\n'
  done
  hits="$(printf '%s' "$hits" | /usr/bin/sed '/^$/d')"
  [ -z "$hits" ] && return 0
  echo "FAIL: these staged files name the build Mac's home folder ${home} (#6549):" >&2
  printf '%s\n' "$hits" | /usr/bin/sed "s|^$stage/|  |" >&2
  return 1
}
