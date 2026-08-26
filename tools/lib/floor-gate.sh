#!/bin/bash
# The macOS deployment-floor gate, shared by both bundle builders so a fix
# to the parsing (a third load-command spelling, say) reaches both. Reads
# the floor from tools/macos-floor; refuses what it cannot read
# (green-on-blind is the failure shape this repo bans); KOSMOS_ALLOW_MINOS=1
# permits marked LOCAL TEST BUILDS only.
#
# Usage: source this file, then `floor_gate <binary> [<binary> ...]`.

floor_gate_load() {
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  FLOOR="$(cat "$here/macos-floor")"
  case "$FLOOR" in
    *[!0-9.]*|*.*.*|.*|*.) echo "FAIL: tools/macos-floor must be MAJOR.MINOR (got '$FLOOR')" >&2; exit 1 ;;
    *.*) ;;
    *) echo "FAIL: tools/macos-floor must be MAJOR.MINOR (got '$FLOOR')" >&2; exit 1 ;;
  esac
  FLOOR_MAJOR="${FLOOR%%.*}"
  FLOOR_MINOR="${FLOOR#*.}"
}

floor_gate() {
  local f minos major minor
  for f in "$@"; do
    minos="$(otool -l "$f" 2>/dev/null | awk '/LC_BUILD_VERSION/{v=1} v && /minos/{print $2; exit}')"
    [ -n "$minos" ] || minos="$(otool -l "$f" 2>/dev/null | awk '/LC_VERSION_MIN_MACOSX/{v=1} v && /version/{print $2; exit}')"
    if [ -z "$minos" ]; then
      if [ -n "${KOSMOS_ALLOW_MINOS:-}" ]; then
        echo "    WARN: cannot read a deployment target from $(basename "$f") (allowed: TEST BUILD)"
        continue
      fi
      echo "FAIL: cannot read a deployment target from $(basename "$f"); refusing to certify the floor." >&2
      exit 1
    fi
    major="${minos%%.*}"; minor="${minos#*.}"; minor="${minor%%.*}"
    if [ "$major" -gt "$FLOOR_MAJOR" ] || { [ "$major" -eq "$FLOOR_MAJOR" ] && [ "$minor" -gt "$FLOOR_MINOR" ]; }; then
      if [ -n "${KOSMOS_ALLOW_MINOS:-}" ]; then
        echo "    WARN: $(basename "$f") needs macOS $minos > floor $FLOOR_MAJOR.$FLOOR_MINOR (allowed: TEST BUILD)"
      else
        echo "FAIL: $(basename "$f") requires macOS $minos, above the installer's $FLOOR_MAJOR.$FLOOR_MINOR floor." >&2
        echo "      Source a binary built for the floor, or KOSMOS_ALLOW_MINOS=1 for a local test build." >&2
        exit 1
      fi
    fi
  done
}

# Gate EVERY Mach-O under a directory, discovered rather than enumerated
# (#927). An enumerated list is a claim about the ship list that nothing
# rechecks: the bundle build gated runtime/bin/node by name and shipped
# kosmos-app at minos 26.0 for eighteen releases, ninety lines below the
# comment warning about exactly that. Walking the stage means the next binary
# someone adds is covered by default instead of by remembering. Refuses a tree
# with no Mach-O in it at all (a walk that finds nothing is blind, and
# green-on-blind is banned here), and prints what it certified.
floor_gate_tree() {
  local dir="$1" f magic n=0 found=()
  [ -d "$dir" ] || { echo "FAIL: floor_gate_tree: $dir is not a directory" >&2; exit 1; }
  while IFS= read -r -d '' f; do
    magic="$(head -c 4 "$f" 2>/dev/null | xxd -p)"
    case "$magic" in
      cffaedfe|cefaedfe|feedfacf|feedface|cafebabe|bebafeca) found+=("$f") ;;
    esac
  done < <(find "$dir" -type f -print0)
  n="${#found[@]}"
  if [ "$n" -eq 0 ]; then
    echo "FAIL: floor_gate_tree found no Mach-O under $dir; refusing to certify a floor for nothing." >&2
    exit 1
  fi
  floor_gate "${found[@]}"
  echo "    floor $FLOOR_MAJOR.$FLOOR_MINOR certified for $n Mach-O file(s) under $(basename "$dir")"
}

floor_gate_load
