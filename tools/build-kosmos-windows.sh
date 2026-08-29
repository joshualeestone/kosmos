#!/usr/bin/env bash
# Build an UNSIGNED Windows bundle of Kosmos.
#
# Josh, 2026-08-29: "Let's ship one unsigned to see it function and then let's
# walk through the process of what we have to do to buy a certificate."
#
# ⚠️ UNSIGNED IS DELIBERATE AND TEMPORARY. Windows shows "Windows protected
# your PC" on an unsigned installer; the way through is More info -> Run
# anyway. That is expected, not a defect. Signing is #1112 item 1 and needs a
# certificate Josh has not bought yet.
#
# ## What this does NOT do, on purpose
#
# 🛑 **No agents.** The agent path needs tmux and launchd, neither of which
# exists on Windows, and the paneless path is inert anyway (#1502). A Windows
# board will say it cannot see anything running, which is correct on a fresh
# machine. v1 is "download, install, comes online", which is the board and the
# projects.
#
# ## Why this is a separate script rather than a flag on the Mac builder
#
# The Mac builder compiles a Swift app, runs `lipo` universal checks, fetches
# and builds tmux, and constructs a `.app`. None of that has a Windows
# meaning. A `--windows` flag would thread a condition through all of it to
# reach a small subset. This stages the subset directly.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-dist}"
NODE_VERSION="${KOSMOS_NODE_VERSION:-24.19.0}"
NARCH="${KOSMOS_WIN_ARCH:-x64}"

# FULL (default) ships ~35MB with node.exe inside and installs with NO NETWORK.
# THIN ships ~2MB and has the installer fetch the runtime, re-hashing what lands.
#
# 🛑 FULL IS THE DEFAULT, AND I HAD THIS BACKWARDS FOR AN HOUR FOR A BAD REASON.
# I made THIN the default because 35MB exceeded the 25MB attachment limit on the
# chat tool I was using to send Josh a test build. **That is a constraint of MY
# MESSAGING TOOL, not of the person installing**, and it has no business
# deciding what the product ships.
#
# ⭐ THE USER DECIDES THIS, AND THE USER IS SOMEBODY'S SISTER ON A DEFAULT
# WINDOWS MACHINE WITH ONE ATTEMPT. Weigh the two failure modes against her:
#   THIN fails at a corporate proxy or a firewall, MID-INSTALL, after she has
#        already committed -- and the failure is a network error she cannot act
#        on.
#   FULL costs her a 35MB download, which is unremarkable for an application
#        and happens BEFORE she commits to anything.
# ⇒ **A bigger download is a cost. An install that dies at a firewall is a
# failure.** They are not the same kind of thing and should not be traded off as
# if they were.
#
# THIN is kept for a constrained channel (an attachment limit, a bandwidth cap)
# and for the case where a build machine cannot reach nodejs.org. It is the
# exception, and it must be asked for by name.
MODE="${KOSMOS_WIN_MODE:-full}"
case "$MODE" in thin|full) ;; *) echo "KOSMOS_WIN_MODE must be thin or full, got '$MODE'" >&2; exit 1 ;; esac

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

step() { printf '\n==> %s\n' "$*"; }

step "staging the app (JavaScript, no dependencies)"
mkdir -p "$STAGE/Kosmos/app/engine" "$STAGE/Kosmos/runtime"
cp "$REPO/server.js" "$REPO/package.json" "$STAGE/Kosmos/app/"
cp "$REPO"/engine/*.js "$STAGE/Kosmos/app/engine/"
cp -R "$REPO/web" "$STAGE/Kosmos/app/web"
echo "    engine modules: $(ls "$STAGE/Kosmos/app/engine" | wc -l | tr -d ' ')"

# ⚠️ A FLOOR, NOT A COMMENT. An empty or near-empty engine dir would produce a
# bundle that builds cleanly, downloads fine, and fails at first request. The
# Mac builder copies by glob too, so this failure mode is shared; it just has
# not bitten yet.
_engine_count="$(ls "$STAGE/Kosmos/app/engine" | wc -l | tr -d ' ')"
[ "$_engine_count" -ge 50 ] || { echo "only $_engine_count engine modules staged; expected 50+. Refusing." >&2; exit 1; }
[ -s "$STAGE/Kosmos/app/server.js" ] || { echo "server.js did not stage" >&2; exit 1; }
[ -d "$STAGE/Kosmos/app/web" ] || { echo "web/ did not stage" >&2; exit 1; }

# 🛑 REFUSE TO BUILD A WINDOWS BUNDLE FROM CODE WHOSE DATA ROOT IS NOT
# PLATFORM-AWARE. Caught by building one: the first bundle this script produced
# was staged from a tree without the fix, so it would have installed cleanly on
# Windows and then written its store to a literal "Library/Application Support"
# folder that means nothing there. Nothing about the install would have looked
# wrong. That exact folder was later found on the real Windows test box, created
# 2026-08-25 by an earlier install, holding bin/agent-supervisor.sh.
#
# ⚠️ ASSERTS THE POSITIVE, AND THE FIRST VERSION OF THIS GUARD DID NOT.
# It searched for the ABSENCE of "Library ... Application Support", which:
#   (a) is defeated by any re-spelling that is correct on a Mac and broken on
#       Windows -- a line-wrapped path.join(, column-aligned quotes, a hoisted
#       const, or 'Application' + ' Support'; and
#   (b) REFUSES A CORRECT TREE, measured: store.js's dataRootFor contains that
#       string three times in its own darwin branch and its docblock, entirely
#       legitimately.
# Routing through dataRootFor is what must actually be true, and no re-spelling
# fakes it.
_root_wiring_ok=1
# ⚠️ MATCHES THE CALL SITE, NOT THE DECLARATION, AND NOT AS A BARE SUBSTRING.
# `grep "function dataRootFor"` passes on `function dataRootForRenamed(` --
# measured, this guard BUILT a bundle from a tree whose resolver had been
# renamed away. What must be true is that ROOT is actually BUILT from it.
if ! grep -qE "ROOT = dataRootFor\(" "$STAGE/Kosmos/app/engine/store.js"; then
  echo "    store.js does not build ROOT from dataRootFor: not platform-aware" >&2
  _root_wiring_ok=0
fi
if ! grep -qE "store\.dataRootFor\s*\(" "$STAGE/Kosmos/app/engine/create.js"; then
  echo "    create.js does not route through store.dataRootFor" >&2
  _root_wiring_ok=0
fi
if [ "$_root_wiring_ok" -ne 1 ]; then
  echo "" >&2
  echo "Refusing to build: the app-data root is not platform-aware in every staged site." >&2
  echo "A Windows bundle from this tree installs fine and then writes its store to a" >&2
  echo "folder Windows does not know about. Nothing about the install looks wrong." >&2
  echo "Land #570 and the create.js delegation first, then rebuild." >&2
  exit 1
fi
echo "    data root routes through dataRootFor in both staged sites"

step "fetching the Windows Node runtime, v$NODE_VERSION-win-$NARCH"
BASE="https://nodejs.org/dist/v$NODE_VERSION"
ZIP="node-v$NODE_VERSION-win-$NARCH.zip"
TMP="$(mktemp -d)"; trap 'rm -rf "$STAGE" "$TMP"' EXIT

if [ -n "${KOSMOS_WIN_NODE_SOURCE:-}" ]; then
  # Offline/test override, same idea as the Mac builder's NODE_SOURCE.
  echo "    using KOSMOS_WIN_NODE_SOURCE=$KOSMOS_WIN_NODE_SOURCE"
  cp "$KOSMOS_WIN_NODE_SOURCE" "$TMP/$ZIP"
else
  curl -fsSL -o "$TMP/$ZIP" "$BASE/$ZIP"
fi

step "verifying it against nodejs.org's own SHASUMS256.txt"
curl -fsSL -o "$TMP/SHASUMS256.txt" "$BASE/SHASUMS256.txt"
WANT="$(grep " $ZIP\$" "$TMP/SHASUMS256.txt" | awk '{print $1}')"
[ -n "$WANT" ] || { echo "no checksum published for $ZIP" >&2; exit 1; }
GOT="$(shasum -a 256 "$TMP/$ZIP" | awk '{print $1}')"
if [ "$WANT" != "$GOT" ]; then
  echo "checksum MISMATCH for $ZIP" >&2
  echo "  expected $WANT" >&2
  echo "  got      $GOT" >&2
  exit 1
fi
echo "    sha256 $GOT  MATCH"

step "unpacking the runtime"
( cd "$TMP" && unzip -q "$ZIP" )

# ⚠️ PROVE IT IS A WINDOWS BINARY, IN BOTH MODES. A silently-wrong download that
# happened to unpack would otherwise ship (or instruct the installer to fetch) a
# Mac node and fail at run time with something unreadable. In thin mode this
# checks the same bytes the installer will later fetch and verify, so the check
# is not skipped just because the file does not travel.
case "$(file -b "$TMP/node-v$NODE_VERSION-win-$NARCH/node.exe")" in
  *"PE32+"*|*"MS Windows"*) echo "    node.exe is a Windows executable" ;;
  *) echo "node.exe is not a Windows executable: $(file -b "$TMP/node-v$NODE_VERSION-win-$NARCH/node.exe")" >&2; exit 1 ;;
esac

# The installer needs to know WHAT to fetch and what it must hash to. Recorded
# at build time from the bytes actually verified above, never hand-written.
cat > "$STAGE/Kosmos/runtime/runtime.json" <<JSON
{
  "version": "$NODE_VERSION",
  "arch": "$NARCH",
  "url": "$BASE/$ZIP",
  "zip_sha256": "$GOT",
  "note": "Recorded by tools/build-kosmos-windows.sh from the bytes it verified against nodejs.org SHASUMS256.txt. The installer re-verifies; it does not trust this file to be the only check."
}
JSON

if [ "$MODE" = "full" ]; then
  cp "$TMP/node-v$NODE_VERSION-win-$NARCH/node.exe" "$STAGE/Kosmos/runtime/node.exe"
  cp "$TMP/node-v$NODE_VERSION-win-$NARCH/LICENSE" "$STAGE/Kosmos/runtime/LICENSE"
  echo "    runtime bundled (full mode)"
else
  echo "    runtime NOT bundled (thin mode); the installer fetches and verifies it"
fi

step "writing the launcher and installer"
cp "$REPO/install/windows/kosmos-launch.cmd" "$STAGE/Kosmos/Kosmos.cmd"
cp "$REPO/install/windows/install-kosmos.cmd" "$STAGE/Kosmos/Install Kosmos.cmd"
cp "$REPO/install/windows/install-kosmos.ps1" "$STAGE/Kosmos/install-kosmos.ps1"
cp "$REPO/install/windows/README.txt" "$STAGE/Kosmos/README.txt"

step "packing"
mkdir -p "$REPO/$OUT"
# The DEFAULT gets the plain name; the exception is labelled. Otherwise the
# unqualified filename is the one that needs a network at install time, and
# whoever publishes it will not know that from looking.
if [ "$MODE" = "thin" ]; then
  ARCHIVE="$REPO/$OUT/kosmos-windows-$NARCH-thin.zip"
else
  ARCHIVE="$REPO/$OUT/kosmos-windows-$NARCH.zip"
fi
rm -f "$ARCHIVE"
( cd "$STAGE" && zip -q -r "$ARCHIVE" Kosmos )
echo "    $ARCHIVE"
echo "    $(du -h "$ARCHIVE" | awk '{print $1}')"

step "done (UNSIGNED)"
echo "    Windows will warn on first run. More info -> Run anyway."
