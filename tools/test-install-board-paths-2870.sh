#!/usr/bin/env bash
# #2870: deploy/install-board.sh must refuse a destination that is unsafe to swap
# the app tree into, BEFORE it copies or moves anything.
#
# 🛑 WHY THIS EXISTS. install-board.sh swaps $DEST: it moves $DEST aside to
# "$DEST.old.$$" and moves a freshly staged tree into place. If $DEST is the
# filesystem root, the source repo, an ancestor of the source, or inside a git
# working tree, that swap corrupts or destroys something it must never touch. A
# relative or dotted $DEST derives a broken ".new"/".old" sibling. These are the
# hardening cases the #1164 blind challenge loop found and deferred.
#
# It drives the validation through the DRY RUN (no --apply): validation runs before
# anything is copied, so the refusals are observable without ever touching a live
# board. Every fixture is an isolated temp dir; nothing here reads or writes the
# real board, plist, or libexec.
#
# ⚠️ The fixture SOURCE repo is a NON-git temp copy of the script on purpose: the
# real checkout is itself a git worktree, so the git-worktree refusal would mask
# the repo-equality / repo-ancestor refusals. Copying the script into a plain temp
# dir lets each refusal be asserted for the reason it is meant to fire.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_SCRIPT="$REPO/deploy/install-board.sh"
fails=0
ok()  { printf 'PASS: %s\n' "$1"; }
bad() { printf 'FAIL: %s\n' "$1"; fails=$((fails+1)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# A NON-git source repo carrying a copy of the script under deploy/, so the
# script's REPO resolves to $FAKE_REPO and the git-worktree check does not fire on
# dests that are really about repo-equality/ancestry.
FAKE_REPO="$TMP/src"
mkdir -p "$FAKE_REPO/deploy"
cp "$SRC_SCRIPT" "$FAKE_REPO/deploy/install-board.sh"
SCRIPT="$FAKE_REPO/deploy/install-board.sh"

# A separate real git working tree, for the inside-a-git-tree case.
GITTREE="$TMP/gittree"
mkdir -p "$GITTREE"
( cd "$GITTREE" && git init -q ) 2>/dev/null

# A plain file, to stand in as a non-directory ancestor.
touch "$TMP/afile"

# run the script (dry run) with a given destination; capture rc + stderr.
# usage: run_dest <dest>   -> sets RC and OUT
run_dest() {
  OUT="$(KOSMOS_BOARD_LIBEXEC="$1" sh "$SCRIPT" 2>&1)"; RC=$?
}

# assert the destination is REFUSED (rc 1) with a message matching a regex.
refuses() {
  local label="$1" dest="$2" re="$3"
  run_dest "$dest"
  if [ "$RC" -eq 1 ] && printf '%s' "$OUT" | grep -qiE "$re"; then
    ok "$label"
  else
    bad "$label (rc=$RC, out: $(printf '%s' "$OUT" | tail -1))"
  fi
}

# assert the destination is ACCEPTED: the dry run completes (rc 0) and says so.
accepts() {
  local label="$1" dest="$2"
  run_dest "$dest"
  if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q 'dry run complete'; then
    ok "$label"
  else
    bad "$label (rc=$RC, out: $(printf '%s' "$OUT" | tail -1))"
  fi
}

# ---- refusals --------------------------------------------------------------
refuses "the filesystem root is refused"                 "/"                     "filesystem root"
refuses "a relative destination is refused"              "relative/board"       "absolute path"
# (an EMPTY KOSMOS_BOARD_LIBEXEC is not testable here: the script's
#  ${KOSMOS_BOARD_LIBEXEC:-<default>} substitutes the default for an empty value,
#  so an empty env var yields the valid default rather than an empty DEST.)
refuses "a '.' path component is refused"                "$TMP/./board"         "path components"
refuses "a '..' path component is refused"               "$TMP/sub/../board"    "path components"
refuses "a file ancestor is refused"                     "$TMP/afile/board"     "not a directory"
# $DEST itself being an existing plain file (not merely a file ANCESTOR of $DEST):
refuses "an existing plain-file destination is refused"  "$TMP/afile"           "already exists and is not a directory"
refuses "a destination inside a git worktree is refused" "$GITTREE/board"       "git working tree"

# repo-equality / ancestry, asserted against the NON-git fake source:
refuses "the source repo itself is refused"              "$FAKE_REPO"           "source repo or inside it|move the source aside"
refuses "a destination inside the source repo is refused" "$FAKE_REPO/sub"      "source repo or inside it"
refuses "a destination ABOVE the source repo is refused" "$TMP"                 "at or above the source"

# an existing NON-EMPTY directory that is not a board install must be refused: the
# apply swap would `mv` it aside and then `rm -rf` it, so a misconfigured
# KOSMOS_BOARD_LIBEXEC=$HOME (or /usr, /Applications) would delete it. server.js is
# the board-install marker; a populated directory lacking it is refused.
mkdir -p "$TMP/not-a-board"
touch "$TMP/not-a-board/some-users-file"
refuses "a non-empty non-board destination is refused"  "$TMP/not-a-board"     "not a board install|no server.js"

# ---- acceptances -----------------------------------------------------------
mkdir -p "$TMP/good-parent"
accepts "a clean sibling destination is accepted"        "$TMP/good-parent/board"
accepts "a trailing slash is normalized, not refused"    "$TMP/good-parent/board/"
# apostrophe-containing paths must survive the path handling, not be mangled:
mkdir -p "$TMP/o'brien"
accepts "an apostrophe in the destination is handled"    "$TMP/o'brien/board"

# a destination that does not exist yet, whose parent does not exist yet either,
# is fine as long as its nearest EXISTING ancestor is a safe directory:
accepts "a deep not-yet-created destination is accepted" "$TMP/good-parent/a/b/c/board"

# an EMPTY existing directory is safe to swap (nothing is lost) and is accepted:
mkdir -p "$TMP/empty-dest"
accepts "an empty existing destination is accepted"      "$TMP/empty-dest"

# an existing directory that IS a prior board install (carries server.js) is a
# legitimate refresh target and is accepted:
mkdir -p "$TMP/prior-board"
touch "$TMP/prior-board/server.js"
accepts "an existing board install (has server.js) is accepted" "$TMP/prior-board"

# ---- the refusal must hold under --apply, the path this feature protects -----
# Every case above drives the DRY RUN. validate_dest runs unconditionally BEFORE
# the apply/staging, so a refusal must also fire under --apply and leave the
# destination byte-for-byte untouched (proving nothing was moved aside or deleted).
# If a future edit moved validate_dest below the apply/staging, this is the case
# that would go red while the dry-run cases stayed green.
mkdir -p "$TMP/apply-guard"
touch "$TMP/apply-guard/precious"
APPLY_OUT="$(KOSMOS_BOARD_LIBEXEC="$TMP/apply-guard" sh "$SCRIPT" --apply 2>&1)"; APPLY_RC=$?
remaining="$(ls -A "$TMP/apply-guard" 2>/dev/null | tr '\n' ',')"
if [ "$APPLY_RC" -eq 1 ] \
   && printf '%s' "$APPLY_OUT" | grep -qiE "not a board install|no server.js" \
   && [ "$remaining" = "precious," ]; then
  ok "under --apply a non-board dest is refused and left untouched"
else
  bad "under --apply a non-board dest is refused and left untouched (rc=$APPLY_RC, remaining=$remaining)"
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "test-install-board-paths-2870: all path-safety checks hold"
  exit 0
fi
echo "test-install-board-paths-2870: $fails FAILED"
exit 1
