#!/usr/bin/env bash
# #2860: tools/lib/board-shape.sh is the ONE board deploy-shape classifier, used by BOTH
# tools/release.sh (step 10a refresh) and tools/restart-local-board.sh (the #360 restart).
# Because both callers use these functions, they cannot drift; this test pins the
# classifier's behavior across every shape both callers rely on, including the deliberate
# exact-match decision for symlinked/aliased paths.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$REPO/tools/lib/board-shape.sh"
fails=0
ok()  { printf 'PASS: %s\n' "$1"; }
bad() { printf 'FAIL: %s\n' "$1"; fails=$((fails+1)); }

eq() { # eq <label> <got> <want>
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (got '$2', want '$3')"; fi
}

# ---- board_shape_libexec_default -------------------------------------------
# The default when KOSMOS_BOARD_LIBEXEC is unset, and the override when set. This is the
# SAME default install-board.sh uses, so a libexec board's WD agrees with it by construction.
eq "default libexec is \$HOME/.local/libexec/kosmos-board" \
  "$(unset KOSMOS_BOARD_LIBEXEC; HOME=/h board_shape_libexec_default)" "/h/.local/libexec/kosmos-board"
eq "KOSMOS_BOARD_LIBEXEC override wins" \
  "$(KOSMOS_BOARD_LIBEXEC=/opt/board board_shape_libexec_default)" "/opt/board"

# ---- board_shape_working_dir (parse launchctl print output) ----------------
# A real launchd `print` block: the working-directory line is extracted, PORT and other
# lines ignored. Tabs/spaces before the key are tolerated (both callers' output has them).
INFO_WITH_WD="$(printf '\tstate = running\n\tworking directory = /some/board/dir\n\tPORT => 16180\n')"
eq "working directory parsed out of a launchctl block" \
  "$(board_shape_working_dir "$INFO_WITH_WD")" "/some/board/dir"
# An end-user bundle's job has NO working-directory line -> empty (shape (c)).
INFO_NO_WD="$(printf '\tstate = running\n\tPORT => 16180\n')"
eq "no working-directory line parses EMPTY (bundle / shape c)" \
  "$(board_shape_working_dir "$INFO_NO_WD")" ""
# Empty input (no job) -> empty.
eq "empty launchctl output parses EMPTY" "$(board_shape_working_dir "")" ""

# ---- board_shape_of <wd> <repo> <libexec> ----------------------------------
eq "WD == repo tree           -> repo"    "$(board_shape_of /a/repo /a/repo /a/libexec)"    "repo"
eq "WD == libexec DEST        -> libexec" "$(board_shape_of /a/libexec /a/repo /a/libexec)" "libexec"
eq "empty WD (bundle)         -> other"   "$(board_shape_of "" /a/repo /a/libexec)"          "other"
eq "foreign WD               -> other"    "$(board_shape_of /some/other /a/repo /a/libexec)" "other"
# release.sh passes an EMPTY repo arg (it acts on shape (b) only): a libexec WD still
# classifies libexec, everything else falls to other -- preserving its "act iff libexec".
eq "empty repo arg: libexec WD  -> libexec" "$(board_shape_of /a/libexec "" /a/libexec)"     "libexec"
eq "empty repo arg: foreign WD  -> other"   "$(board_shape_of /some/other "" /a/libexec)"    "other"
# A WD of "" must never match an empty repo/libexec arg (the -n "$wd" guard).
eq "empty WD with empty repo arg -> other"  "$(board_shape_of "" "" /a/libexec)"             "other"

# ---- deliberate decision: symlinked / aliased paths are NOT normalized -----
# An aliased WD that only RESOLVES to libexec through a symlink classifies as `other`
# (exact string match), NOT libexec. This locks the documented decision: install-board.sh
# sets the WD to the same STRING as libexec, so no normalization is needed, and adding it
# would turn a fail-safe no-op into an action in the cut. If a future change added
# realpath normalization, this assertion would flip to `libexec` and go red.
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/real-libexec"
ln -s "$TMP/real-libexec" "$TMP/alias-libexec"
eq "aliased (symlinked) WD is NOT normalized to libexec -> other" \
  "$(board_shape_of "$TMP/alias-libexec" "" "$TMP/real-libexec")" "other"
# ...and the exact resolved path DOES match (control: the match works when the strings agree).
eq "the exact libexec string still classifies libexec (control)" \
  "$(board_shape_of "$TMP/real-libexec" "" "$TMP/real-libexec")" "libexec"

echo
if [ "$fails" -eq 0 ]; then
  echo "test-board-shape-2860: all board-shape classifier checks hold"
  exit 0
fi
echo "test-board-shape-2860: $fails FAILED"
exit 1
