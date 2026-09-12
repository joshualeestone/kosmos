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

# Make the fake source fully STAGEABLE (the exact files stage_app copies), so the
# --refresh-only regression case at the end can actually reach the destructive swap
# when the guard is absent. Without these, stage_app aborts on the first missing
# file BEFORE the swap, and the "nothing touched" assertion would be vacuous (it
# would hold guard-present AND guard-absent). Dry-run and refusal tests never stage,
# so these files do not affect any other case.
mkdir -p "$FAKE_REPO/engine" "$FAKE_REPO/bin" "$FAKE_REPO/web"
printf '{"version":"0.0.0-test"}\n'          > "$FAKE_REPO/package.json"
printf 'process.exit(0)\n'                   > "$FAKE_REPO/server.js"
printf '// noop\n'                            > "$FAKE_REPO/engine/noop.js"
printf '<html>__KOSMOS_VERSION__</html>\n'    > "$FAKE_REPO/web/index.html"
printf '#!/bin/sh\n'                          > "$FAKE_REPO/bin/agent-supervisor.sh"
printf '#!/usr/bin/env node\n'                > "$FAKE_REPO/bin/codex-report-bridge.js"

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
# a dot component at the very END of the path is the case the "/$DEST/" wrapping
# exists for: a bare */../* would miss a trailing "/.." (no following slash). These
# would pass if the wrapping were removed, so they guard that logic specifically.
refuses "a trailing '.' component is refused"            "$TMP/x/."             "path components"
refuses "a trailing '..' component is refused"           "$TMP/x/.."            "path components"
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
# KOSMOS_BOARD_LIBEXEC=$HOME (or /usr, /Applications) would delete it. The marker is
# server.js AND engine/; a populated directory lacking either is refused.
mkdir -p "$TMP/not-a-board"
touch "$TMP/not-a-board/some-users-file"
refuses "a non-empty non-board destination is refused"  "$TMP/not-a-board"     "not a board install|needs both"
# a directory with a top-level server.js but NO engine/ (e.g. a user's own Node
# project) must still be refused -- server.js alone is not proof of a board install:
mkdir -p "$TMP/half-board"
touch "$TMP/half-board/server.js"
refuses "a server.js-only dir (no engine/) is refused"  "$TMP/half-board"      "needs both a server.js file"
# a dir whose "server.js" is itself a DIRECTORY (plus an engine/ dir) must still be
# refused: -e would misclassify it as a board and destroy it, -f does not:
mkdir -p "$TMP/fake-board/server.js" "$TMP/fake-board/engine"
refuses "a dir with server.js as a DIRECTORY is refused" "$TMP/fake-board"     "needs both a server.js file"

# a symlink whose target resolves INTO the source repo must be caught by the pwd -P
# canonicalization -- a plain string compare on the symlink path would miss it. This
# exercises the _anc_real/pwd -P resolution, the most novel code in the change.
ln -s "$FAKE_REPO" "$TMP/sneaky-link"
refuses "a symlink resolving INTO the source repo is refused" "$TMP/sneaky-link/board" "source repo or inside it"

# an existing populated dir we cannot ENUMERATE (execute-only: cd works, ls does not)
# must fail CLOSED -- never be read as empty, which would let the swap delete contents
# it never inspected. (000 would fail earlier at the ancestor cd; 111 reaches the
# emptiness check, which is the one under test.)
mkdir -p "$TMP/noread"; touch "$TMP/noread/hidden"
chmod 111 "$TMP/noread"
refuses "an unreadable existing destination fails closed" "$TMP/noread" "could not read destination"
chmod 755 "$TMP/noread"   # restore so the EXIT trap's rm -rf can clean it up

# ---- acceptances -----------------------------------------------------------
mkdir -p "$TMP/good-parent"
accepts "a clean sibling destination is accepted"        "$TMP/good-parent/board"
accepts "a trailing slash is normalized, not refused"    "$TMP/good-parent/board/"
# apostrophe-containing paths must survive the path handling, not be mangled:
mkdir -p "$TMP/o'brien"
accepts "an apostrophe in the destination is handled"    "$TMP/o'brien/board"
# a space and glob-metacharacters in the path must be treated literally by the
# quoting/`case` handling, not word-split or expanded:
mkdir -p "$TMP/with space"
accepts "a space in the destination is handled"          "$TMP/with space/board"
mkdir -p "$TMP/star*dir"
accepts "a glob metacharacter in the destination is handled" "$TMP/star*dir/board"

# a symlinked ancestor that resolves to a SAFE dir must resolve and be accepted (the
# positive counterpart to the sneaky-into-repo refusal above):
mkdir -p "$TMP/realtarget"
ln -s "$TMP/realtarget" "$TMP/safe-link"
accepts "a symlinked-ancestor destination resolves and is accepted" "$TMP/safe-link/board"

# a destination that does not exist yet, whose parent does not exist yet either,
# is fine as long as its nearest EXISTING ancestor is a safe directory:
accepts "a deep not-yet-created destination is accepted" "$TMP/good-parent/a/b/c/board"

# an EMPTY existing directory is safe to swap (nothing is lost) and is accepted:
mkdir -p "$TMP/empty-dest"
accepts "an empty existing destination is accepted"      "$TMP/empty-dest"

# an existing directory that IS a prior board install (carries server.js AND engine/)
# is a legitimate refresh target and is accepted:
mkdir -p "$TMP/prior-board/engine"
touch "$TMP/prior-board/server.js"
accepts "an existing board install (server.js + engine/) is accepted" "$TMP/prior-board"

# ---- the refusal must hold on a REAL destructive path, not just the dry run ---
# Every case above drives the dry run, which never reaches the swap. --refresh-only
# (APPLY=1) DOES: it stages, then `mv "$DEST" "$DEST.old.$$"`, moves the new tree
# into place, `rm -rf`s the old tree, and exits before any plist/launchctl. Because
# the fake source is fully stageable (see the fixture above), if validate_dest were
# removed or moved below staging, this run WOULD reach the swap and destroy
# "precious" -- so the "nothing touched" assertion is genuinely load-bearing here,
# not vacuous. validate_dest runs before staging, so a non-board dest is refused
# with nothing moved aside or deleted. (Proven red-capable out of band: neutering
# the marker check makes this exact run delete "precious".)
mkdir -p "$TMP/apply-guard"
touch "$TMP/apply-guard/precious"
APPLY_OUT="$(KOSMOS_BOARD_LIBEXEC="$TMP/apply-guard" sh "$SCRIPT" --refresh-only 2>&1)"; APPLY_RC=$?
remaining="$(ls -A "$TMP/apply-guard" 2>/dev/null | tr '\n' ',')"
if [ "$APPLY_RC" -eq 1 ] \
   && printf '%s' "$APPLY_OUT" | grep -qiE "not a board install|no server.js" \
   && [ "$remaining" = "precious," ]; then
  ok "under --refresh-only a non-board dest is refused with nothing touched"
else
  bad "under --refresh-only a non-board dest is refused with nothing touched (rc=$APPLY_RC, remaining=$remaining)"
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "test-install-board-paths-2870: all path-safety checks hold"
  exit 0
fi
echo "test-install-board-paths-2870: $fails FAILED"
exit 1
