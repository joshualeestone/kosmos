#!/bin/bash
# Refresh the installed `kosmos` CLI on THIS Mac to this release's install/kosmos,
# if there is an installed one, and say so either way (#1758).
#
# 🛑 WHY THIS EXISTS. The release publishes to installs and step 10 restarts the
# developer board, but nothing refreshed the `kosmos` COMMAND that agents run. An
# in-app update swaps app/, NEVER bin/ (tools/build-kosmos-bundle.sh says so at the
# bin/kosmos copy: "an UPDATE (which swaps app/, never bin/)"), so an installed CLI
# stays whatever the first install put there. On this Mac that is a 21 KB copy with
# no --help handling at all, while the tree's install/kosmos is 45 KB. #1674
# (`kosmos reply --help` sent `--help` as a message) merged, shipped in the bundle,
# and still bit an agent the next day -- because agents do not run the repo or the
# bundle, they run that binary. The fix reached every layer except the one that
# executes. The release is the moment the code on disk is the code that should run,
# so the release refreshes it: the same #360 reasoning restart-local-board.sh uses
# for the board, for the CLI.
#
# 🔑 GATED ON REALITY, NOT ASSUMED. It refreshes only when a `kosmos` on PATH
# resolves to a real file OUTSIDE this repo -- a genuine install. A `kosmos` that
# IS this repo's install/kosmos is never stale and is left alone; a Mac with no
# installed kosmos is left alone; and each case says which it found. The refresh is
# byte-verified against the tree AFTER the copy: a copy that did not land, or landed
# wrong, is a refusal (exit 1), not a silent skip -- a silent skip here recreates
# exactly the defect this closes.
#
# 🔬 PROVABLE. tools/test-refresh-local-cli.sh drives this against a sandbox CLI via
# the overrides below, stales it deliberately, and asserts BOTH the refresh arm and
# the refusal arm. A check that has only ever seen a good state has not been tested.
#
# Usage: bash tools/refresh-local-cli.sh            (from the release)
#        bash tools/refresh-local-cli.sh --check    (report only, no copy)
#
# Overrides (for the test; unset in normal use):
#   REFRESH_CLI_TARGET  the installed CLI to refresh   (default: `command -v kosmos`)
#   REFRESH_CLI_SOURCE  the tree CLI to refresh FROM    (default: $REPO/install/kosmos)
#   REFRESH_CLI_REPO    repo root for the "is it the repo copy?" gate
#                       (default: this script's repo)
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

SOURCE="${REFRESH_CLI_SOURCE:-$REPO/install/kosmos}"
GUARD_REPO="${REFRESH_CLI_REPO:-$REPO}"

# Follow symlinks to the real file the install owns, so the copy lands on the file
# and not on the ~/.local/bin link. Portable on purpose: readlink -f is not on
# every macOS, and the loop also passes a plain (non-symlink) file straight through,
# which is what the sandbox test hands it.
resolve() {
  local p="$1" t
  while [ -L "$p" ]; do
    t="$(readlink "$p")"
    case "$t" in
      /*) p="$t" ;;
      *)  p="$(cd "$(dirname "$p")" && cd "$(dirname "$t")" && pwd)/$(basename "$t")" ;;
    esac
  done
  printf '%s' "$p"
}

# The installed command, found on PATH exactly as an agent would find it. The
# override is honoured when SET even to empty (the test's "no install" case): a
# `:-` default would treat an explicit empty as unset and fall through to the real
# machine's kosmos, so the test must be able to say "" and mean it.
if [ "${REFRESH_CLI_TARGET+set}" = set ]; then
  TARGET="$REFRESH_CLI_TARGET"
else
  TARGET="$(command -v kosmos 2>/dev/null || true)"
fi
if [ -z "$TARGET" ]; then
  echo "   no installed kosmos CLI on this machine, so nothing to refresh (a fresh install carries this release's CLI)"
  exit 0
fi

REAL="$(resolve "$TARGET")"

# A kosmos that IS this repo's own copy runs from source and is never stale; the
# board check (step 10) leaves an install alone for the mirror reason.
case "$REAL" in
  "$GUARD_REPO"/*)
    echo "   kosmos on PATH is this repo's own install/kosmos ($REAL), never stale; leaving it alone"
    exit 0 ;;
esac

# A missing or unreadable source is a real failure, not a skip: the release cannot
# claim the CLI is fresh if it cannot read what fresh is.
if [ ! -r "$SOURCE" ]; then
  echo "COULD NOT REFRESH THE INSTALLED CLI: the release CLI source is missing or unreadable ($SOURCE)"
  exit 1
fi

if cmp -s "$SOURCE" "$REAL"; then
  echo "   the installed CLI at $REAL already matches this release; nothing to refresh"
  exit 0
fi

if [ "$CHECK" = 1 ]; then
  echo "   the installed CLI at $REAL is STALE (differs from this release's install/kosmos); a real run would refresh it"
  exit 0
fi

# Atomic replace: write beside the target on the same filesystem, make it
# executable (cp does not preserve mode), then mv over. Any step that cannot
# complete is a refusal that names why.
tmp="$REAL.kosmos-refresh.$$"
if ! cp "$SOURCE" "$tmp" 2>/dev/null; then
  rm -f "$tmp" 2>/dev/null || true
  echo "COULD NOT REFRESH THE INSTALLED CLI: cannot write beside $REAL (a read-only install dir, or no permission)"
  exit 1
fi
chmod +x "$tmp" 2>/dev/null || true
if ! mv "$tmp" "$REAL" 2>/dev/null; then
  rm -f "$tmp" 2>/dev/null || true
  echo "COULD NOT REFRESH THE INSTALLED CLI: cannot replace $REAL"
  exit 1
fi

# Byte-verify the result. A copy that did not land the tree's bytes is the defect
# this step exists to prevent, so it reds the cut rather than passing quietly.
if ! cmp -s "$SOURCE" "$REAL"; then
  echo "THE INSTALLED CLI DID NOT REFRESH: $REAL still differs from the tree after the copy"
  exit 1
fi

echo "   refreshed the installed CLI at $REAL to this release's install/kosmos"
exit 0
