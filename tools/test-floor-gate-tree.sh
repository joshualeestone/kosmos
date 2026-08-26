#!/bin/bash
# #927: the bundle build gated ONE Mach-O by name (runtime/bin/node) and shipped
# kosmos-app stamped minos 26.0, the build Mac's own OS, against an installer
# that promises 13.5, from 0.5.27 through 0.5.45. This proves the two halves of
# the fix on the machine running it, and nothing more:
#
#   1. floor_gate_tree DISCOVERS every Mach-O under a directory and refuses one
#      stamped above the floor (a binary compiled here with no -target, which
#      inherits this Mac's OS), while passing one compiled -target the floor.
#   2. native-app/main.swift itself compiles -target the floor and the artifact
#      reads back at the floor, so the build's flag is not a wish.
#   3. The build script carries both: the -target read from tools/macos-floor,
#      and floor_gate_tree over $STAGE rather than an enumerated file.
#
# ⚠️ THE BOUNDARY, stated so nobody reads this as more than it is: the minos
# stamp, the plist's LSMinimumSystemVersion and the gate's refusal are
# MEASURED. What a person on a Mac below 26 sees when they double-click the
# old binary (a dyld refusal, and whichever dialog macOS shows for it) is
# INFERRED from the load command; no one on the team has a Mac below 26 to
# observe it on as this is written. This test does not claim to have seen the
# launch fail. Branch 1's "refuses an untargeted binary" only runs when this
# Mac's own OS is above the floor (otherwise an untargeted build IS at the
# floor, and the branch says so and skips rather than passing on nothing).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
command -v swiftc >/dev/null || { echo "SKIP: no swiftc on this machine; cannot compile the probes"; exit 0; }
[ "$(uname -m)" = "arm64" ] || { echo "SKIP: probes are arm64-only, this is $(uname -m)"; exit 0; }
. tools/lib/floor-gate.sh
T="$(mktemp -d "${TMPDIR:-/tmp}/floor-tree.XXXXXX")"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/stage/app/bin" "$T/stage/runtime/bin" "$T/empty" "$T/src"
printf 'print("probe")\n' > "$T/src/probe.swift"

fail() { echo "FAIL: $*" >&2; exit 1; }
minos_of() { otool -l "$1" | awk '/LC_BUILD_VERSION/{v=1} v && /minos/{print $2; exit}'; }
gate_tree() { ( floor_gate_tree "$1" ) 2>"$T/err" >"$T/out"; }

# --- 1. a tree gate that discovers, refuses above the floor, passes at it ----
swiftc -target "arm64-apple-macos$FLOOR" "$T/src/probe.swift" -o "$T/stage/app/bin/at-floor" >/dev/null 2>&1
[ "$(minos_of "$T/stage/app/bin/at-floor")" = "$FLOOR" ] || fail "a -target $FLOOR probe reads back minos $(minos_of "$T/stage/app/bin/at-floor")"
printf 'not a binary\n' > "$T/stage/runtime/bin/README"      # text beside it, must be ignored, not refused
gate_tree "$T/stage" || fail "a tree with one at-floor Mach-O and a text file was refused: $(cat "$T/err")"
grep -q "certified for 1 Mach-O" "$T/out" || fail "the walk did not count exactly the one Mach-O: $(cat "$T/out")"

gate_tree "$T/empty" && fail "a tree with no Mach-O was certified (green-on-blind)"
grep -q "found no Mach-O" "$T/err" || fail "the empty-tree refusal did not say why: $(cat "$T/err")"

HOST="$(sw_vers -productVersion)"; HOST_MAJ="${HOST%%.*}"
if [ "$HOST_MAJ" -gt "$FLOOR_MAJOR" ]; then
  swiftc "$T/src/probe.swift" -o "$T/stage/app/bin/untargeted" >/dev/null 2>&1   # the old :222 shape
  U="$(minos_of "$T/stage/app/bin/untargeted")"
  [ "${U%%.*}" -gt "$FLOOR_MAJOR" ] || fail "an untargeted build on macOS $HOST reads minos $U, not above the floor; the premise of this branch does not hold here"
  gate_tree "$T/stage" && fail "the walk certified a stage holding a minos $U binary nested under app/bin"
  grep -q "untargeted requires macOS $U" "$T/err" || fail "the refusal did not name the nested binary and its minos: $(cat "$T/err")"
  echo "  untargeted probe from this macOS $HOST stamps minos $U; the walk found it under app/bin and refused it"
else
  echo "  SKIP branch: this Mac is macOS $HOST, at or below the $FLOOR floor, so an untargeted build cannot exceed it here"
fi

# --- 2. the real app source compiles at the floor and reads back at it -------
swiftc -target "arm64-apple-macos$FLOOR" -O native-app/main.swift -o "$T/kosmos-app" 2>"$T/swift.err" \
  || fail "native-app/main.swift does not compile -target arm64-apple-macos$FLOOR: $(head -5 "$T/swift.err")"
[ "$(minos_of "$T/kosmos-app")" = "$FLOOR" ] || fail "kosmos-app built -target $FLOOR reads back minos $(minos_of "$T/kosmos-app")"
"$T/kosmos-app" --kosmos-app-selftest >/dev/null 2>&1 || fail "the floor-targeted kosmos-app fails its own selftest on this Mac"

# --- 3. the build script carries both halves -----------------------------------
grep -q 'swiftc -target "arm64-apple-macos$(cat "$REPO/tools/macos-floor")"' tools/build-kosmos-bundle.sh \
  || fail "build-kosmos-bundle.sh no longer compiles kosmos-app -target the floor read from tools/macos-floor"
grep -q '^floor_gate_tree "\$STAGE"$' tools/build-kosmos-bundle.sh \
  || fail "build-kosmos-bundle.sh no longer walks \$STAGE with floor_gate_tree (an enumerated gate is the defect)"
grep -q '^floor_gate "\$STAGE/' tools/build-kosmos-bundle.sh && fail "build-kosmos-bundle.sh still gates an enumerated file beside the tree walk"
grep -q '^floor_gate_tree "\$OUT"$' tools/build-tmux-bundle.sh \
  || fail "build-tmux-bundle.sh no longer walks \$OUT with floor_gate_tree (it enumerated bin/tmux + lib/*.dylib before)"
grep -q '^floor_gate "\$OUT' tools/build-tmux-bundle.sh && fail "build-tmux-bundle.sh still gates an enumerated list beside the tree walk"

echo "floor gate walks the stage; kosmos-app builds and reads back at macOS $FLOOR (launch on a pre-26 Mac: not observed here, see header)"
