#!/bin/bash
# The build-machine home-path gate (#6549, from the #1760 shipped-artifact pass). A release must not carry the
# account folder of the Mac that built it: the connector once held the build Mac's home path hundreds of times
# (the Rust compiler's source paths, now remapped by kosmos-relay tools/build-tunnel-release.sh).
# Two checks over the stage (the upstream Node runtime is skipped: it is not ours to rebuild):
#   1. every file under app/ and bin/, read as bytes (binary or text), for THIS build user's home folder, ending at
#      anything that cannot continue a folder name (so /Users/sam is caught in `path.relative('/Users/sam', p)` but
#      /Users/samantha is not a hit for /Users/sam), in any case (macOS volumes ignore case);
#   2. every compiled (Mach-O) file under app/bin/ and the app's Contents/MacOS/, for ANY account's build folders
#      (/Users/<name>/.cargo/, .rustup/ or work/), because the connector may be built on another Mac and copied in.
# A home it cannot use (empty, relative, the root or one component), a missing app/ or bin/, or a file it cannot
# read, or a symlink it would not follow, is refused, never skipped: a gate that passes because it could not look is
# the failure this repo bans.
#
# Usage: source this file, then `home_path_gate_tree <stage> [<home>]` (home defaults to $HOME).
# Prints each offending file (relative to the stage) and returns 1 when any is found or a check could not run.

home_path_gate_tree() {
  local stage="$1" home="${2:-$HOME}" part esc out rc bad="" f magic
  while [ "${home%/}" != "$home" ]; do home="${home%/}"; done   # review 3: judge the home without trailing slashes
  case "$home" in
    /*/[!/]*) ;;
    *) echo "FAIL: the home-path gate needs the build user's home folder (got '$home')" >&2; return 1 ;;
  esac
  [ -d "$stage" ] || { echo "FAIL: the home-path gate has no stage at $stage" >&2; return 1; }
  # review 2: grep -r does not follow a symlink, so a link (or what it points at) would never be read. The build stages
  # none; refuse one rather than pass it unread.
  out="$(/usr/bin/find "$stage/app" "$stage/bin" -type l 2>/dev/null)"
  [ -z "$out" ] || { echo "FAIL: the home-path gate cannot read through symlinks, and the stage has some:" >&2; printf '%s\n' "$out" | /usr/bin/sed 's/^/  /' >&2; return 1; }
  esc="$(printf '%s' "$home" | /usr/bin/sed 's/[^A-Za-z0-9/]/\\&/g')"
  for part in app bin; do
    [ -d "$stage/$part" ] || { echo "FAIL: the home-path gate found no $part/ in the stage" >&2; return 1; }
    out="$(LC_ALL=C /usr/bin/grep -rlaiE -e "${esc}([^A-Za-z0-9._-]|\$)" "$stage/$part")"; rc=$?
    [ "$rc" -le 1 ] || { echo "FAIL: the home-path gate could not read every file under $part/ (grep rc $rc)" >&2; return 1; }
    [ -n "$out" ] && bad="$bad$out"$'\n'
  done
  for f in "$stage"/app/bin/* "$stage"/app/*.app/Contents/MacOS/*; do
    [ -f "$f" ] || continue
    # review 3: compiled (Mach-O) files only; app/bin/ also holds scripts, whose comments are check 1's business.
    magic="$(/usr/bin/head -c4 "$f" | /usr/bin/od -An -tx1 | /usr/bin/tr -d ' \n')"
    case "$magic" in cffaedfe|cefaedfe|cafebabe|feedfacf|feedface|bebafeca) ;; *) continue ;; esac
    out="$(LC_ALL=C /usr/bin/grep -laE -e '/Users/[^/[:cntrl:]]+/(\.cargo|\.rustup|work)/' "$f")"; rc=$?
    [ "$rc" -le 1 ] || { echo "FAIL: the home-path gate could not read $f (grep rc $rc)" >&2; return 1; }
    [ -n "$out" ] && bad="$bad$out"$'\n'
  done
  [ -z "$bad" ] && return 0
  echo "FAIL: these staged files name a build Mac's home folder (#6549):" >&2
  printf '%s' "$bad" | LC_ALL=C /usr/bin/sort -u | while IFS= read -r f; do [ -n "$f" ] && printf '  %s\n' "${f#"$stage"/}" >&2; done
  return 1
}
