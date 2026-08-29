#!/usr/bin/env bash
# Build the unsigned Windows package: a zip somebody downloads, unpacks and runs.
#
# 🛑 JOSH'S v1, HIS WORDS (2026-08-29): "visit installkosmos.com and click
# Download for Windows. It downloads an application that they can run locally,
# launch and install Kosmos, and access their agents just like they can on the
# Mac." And his ruling the same afternoon: "Let's ship one unsigned to see it
# function and then let's walk through the process of what we have to do to buy
# a certificate."
#
# ⇒ SO THIS IS DELIBERATELY UNSIGNED. Windows will show "Windows protected your
# PC" with More info -> Run anyway. That is expected, it is his call, and the
# certificate is a separate purchase with its own lead time.
#
# 🛑 WHAT THIS PACKAGE DOES AND DOES NOT DO, so nobody ships it believing more.
# It carries the BOARD and a Node runtime. The board comes up and serves the real
# UI. AGENTS DO NOT WORK: an agent is a tmux pane and there is no tmux, so most
# agent-facing features are dark. That is the honest first look and it is better
# than a mock, because it makes the remaining work visible instead of abstract.
#
# 🛑 AND IT HAS NO UPDATE PATH. The Mac bundle ships `install/setup.sh`, which is
# how a Mac install updates itself. There is no Windows equivalent, so a person
# updates this by downloading the zip again. That is acceptable for an unsigned
# preview somebody is trying once, and it is NOT acceptable for the thing behind
# a Download for Windows button on installkosmos.com.
#
# ⚠️ THIS HAS NEVER BEEN RUN ON WINDOWS. Every claim here is about what the
# script stages, not about what happens when somebody double-clicks it. Whoever
# has the machine first: that is the thing to find out, and the two most likely
# surprises are the launcher's quoting and whether APPDATA is populated in the
# environment a double-click inherits.
#
#   bash tools/build-kosmos-windows.sh [outdir]
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-dist}"
# ⚠️ ONE DEFAULT, SHARED WITH THE MAC BUILDER ON PURPOSE. Two runtimes drifting
# apart is a class of bug nobody sees until one platform gets a fix the other
# does not.
NODE_VERSION="${KOSMOS_NODE_VERSION:-24.19.0}"
ARCH="${KOSMOS_WIN_ARCH:-x64}"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/app" "$STAGE/runtime"

# ---- the app ---------------------------------------------------------------
# ⚠️ AN EXPLICIT LIST, NOT AN EXCLUDE LIST, for the reason the Mac builder
# records: `cp -R . minus tests` rots the other way and ships the next stray
# repo-root file to every user.
# 🛑 AND IT MUST NOT DRIFT FROM THE MAC LIST. `tools/build-windows-contents.test.js`
# compares the two and fails when one gains a file the other does not. That is
# the #731 defect made impossible rather than remembered: the codex bridge was
# resolved by the engine and never staged, and served 0.5.23 could not create a
# single agent.
echo "==> staging the app"
cp "$REPO/server.js" "$REPO/package.json" "$STAGE/app/"
mkdir -p "$STAGE/app/engine" "$STAGE/app/bin"
for f in "$REPO"/engine/*.js; do
  case "$f" in *.test.js) ;; *) cp "$f" "$STAGE/app/engine/" ;; esac
done
cp -R "$REPO/web" "$STAGE/app/web"
cp "$REPO/bin/agent-supervisor.sh" "$STAGE/app/bin/"
cp "$REPO/bin/codex-report-bridge.js" "$STAGE/app/bin/"

# 🔑 THE VERSION IS BAKED INTO THE PAGE, same as the Mac builder and for the same
# reason (#269): a fact about the bundle must not require the bundle's API. The
# checks below FAIL THE BUILD rather than shipping the marker to a screen.
_ver="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$STAGE/app/package.json" | head -1)"
[ -n "$_ver" ] || { echo "could not read the version to bake into the page" >&2; exit 1; }
sed -i '' "s/__KOSMOS_VERSION__/$_ver/" "$STAGE/app/web/index.html" 2>/dev/null \
  || sed -i "s/__KOSMOS_VERSION__/$_ver/" "$STAGE/app/web/index.html"
if grep -q "__KOSMOS_VERSION__" "$STAGE/app/web/index.html"; then
  echo "the version marker survived the bake; the page would ship it verbatim" >&2; exit 1
fi
grep -q "content=\"$_ver\"" "$STAGE/app/web/index.html" || {
  echo "the version was not baked into the page" >&2; exit 1; }
echo "==> baked version $_ver into the page"

# ---- the runtime -----------------------------------------------------------
# ⚠️ CHECKSUM-VERIFIED AGAINST nodejs.org's OWN SHASUMS, and the build DIES on a
# mismatch. An unsigned installer is already asking somebody to click through a
# warning; shipping an unverified runtime inside it would be asking them to
# trust something we did not check ourselves.
echo "==> downloading node v$NODE_VERSION (win-$ARCH)"
ZIP="node-v$NODE_VERSION-win-$ARCH.zip"
BASE="https://nodejs.org/dist/v$NODE_VERSION"
TMP="$STAGE/dl"; mkdir -p "$TMP"
curl -fsSL "$BASE/$ZIP" -o "$TMP/$ZIP"
curl -fsSL "$BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
WANT="$(grep " $ZIP\$" "$TMP/SHASUMS256.txt" | awk '{print $1}')"
[ -n "$WANT" ] || { echo "nodejs.org lists no checksum for $ZIP" >&2; exit 1; }
GOT="$(shasum -a 256 "$TMP/$ZIP" | awk '{print $1}')"
[ "$WANT" = "$GOT" ] || { echo "node runtime checksum mismatch: want $WANT got $GOT" >&2; exit 1; }
NODE_SHA="$GOT"
echo "==> checksum ok"
( cd "$TMP" && unzip -q "$ZIP" )
cp "$TMP/node-v$NODE_VERSION-win-$ARCH/node.exe" "$STAGE/runtime/node.exe"
cp "$TMP/node-v$NODE_VERSION-win-$ARCH/LICENSE" "$STAGE/runtime/LICENSE"
rm -rf "$TMP"

# ---- the launcher ----------------------------------------------------------
# 🛑 CRLF, NOT LF. A .cmd file with Unix line endings is read by cmd.exe with a
# trailing carriage return on every token, and the failure is not a syntax error
# a person can act on: the command simply does not resolve. This is written on a
# Mac, so it is the single most likely thing to be wrong on first contact.
# ⚠️ %~dp0 IS THE SCRIPT'S OWN FOLDER WITH A TRAILING BACKSLASH, so paths below
# have no separator of their own. Somebody will "fix" that and break it.
# 🛑 THE PORT IS READ OUT OF server.js, NEVER TYPED HERE, and my first version
# typed 4319 because I guessed. THE REAL DEFAULT IS 16180, so the launcher would
# have opened a browser on a dead port while the board sat there working.
# ⇒ Two copies of one fact, and the copy a person SEES would have been the wrong
# one. Read it, and fail the build if it cannot be read, rather than shipping a
# number nobody checked.
PORT_DEFAULT="$(sed -n 's/.*process\.env\.PORT *|| *\([0-9][0-9]*\).*/\1/p' "$STAGE/app/server.js" | head -1)"
[ -n "$PORT_DEFAULT" ] || { echo "could not read the board's default port out of server.js" >&2; exit 1; }
echo "==> the launcher will open http://127.0.0.1:$PORT_DEFAULT"

# 🔑 THE BROWSER OPENS FROM ITS OWN FILE, and that is about quoting rather than
# tidiness. Doing the wait and the open inline needs nested quotes inside a
# `start` inside a `cmd /c`, which is the single most likely thing to be subtly
# wrong when it is written on a Mac by somebody who cannot run it. Two trivial
# files have no nesting at all.
# ⚠️ AND IT OPENS AFTER THE SERVER, not before. My first version opened the
# browser on the line ABOVE the one that starts the board, so the first thing a
# person would have seen is a connection error on a working install.
{
  printf '@echo off\r\n'
  printf 'rem Waits for the board, then opens it. Started by Kosmos.cmd.\r\n'
  printf 'timeout /t 3 /nobreak >nul\r\n'
  printf 'start "" http://127.0.0.1:%s\r\n' "$PORT_DEFAULT"
} > "$STAGE/open-board.cmd"

{
  printf '@echo off\r\n'
  printf 'setlocal\r\n'
  printf 'rem Kosmos, unsigned build. The board runs locally and serves a page.\r\n'
  printf 'rem Agents are not available on Windows yet: an agent is a tmux pane.\r\n'
  printf 'set "KOSMOS_HERE=%%~dp0"\r\n'
  printf 'start "" /min "%%KOSMOS_HERE%%open-board.cmd"\r\n'
  printf 'echo Starting Kosmos. A browser will open in a moment.\r\n'
  printf 'echo If it does not, open http://127.0.0.1:%s yourself.\r\n' "$PORT_DEFAULT"
  printf '"%%KOSMOS_HERE%%runtime\\node.exe" "%%KOSMOS_HERE%%app\\server.js"\r\n'
  printf 'if errorlevel 1 (\r\n'
  printf '  echo Kosmos stopped. The line above says why.\r\n'
  printf '  pause\r\n'
  printf ')\r\n'
} > "$STAGE/Kosmos.cmd"

# 🔑 A README A PERSON ACTUALLY READS, because the FIRST thing they see is a
# security warning and the second is a board with no agents. Both are expected
# and neither is obvious.
{
  printf 'Kosmos for Windows (unsigned preview)\r\n'
  printf '\r\n'
  printf 'Double-click Kosmos.cmd.\r\n'
  printf '\r\n'
  printf 'Windows will say "Windows protected your PC". That is expected: this\r\n'
  printf 'build is not signed yet. Choose More info, then Run anyway.\r\n'
  printf '\r\n'
  printf 'A browser opens on the Kosmos board. Settings and projects work.\r\n'
  printf 'AGENTS DO NOT WORK IN THIS BUILD. An agent is currently a terminal\r\n'
  printf 'window managed by tmux, which does not exist on Windows, so the parts\r\n'
  printf 'of the board that talk about agents will be empty or say they could\r\n'
  printf 'not check. That is the honest state, not a fault in your install.\r\n'
  printf '\r\n'
  printf 'To stop it, close the black window.\r\n'
  printf '\r\n'
  printf 'If no browser opens, go to http://127.0.0.1:%s yourself.\r\n' "$PORT_DEFAULT"
} > "$STAGE/README.txt"

# ---- the manifest ----------------------------------------------------------
cat > "$STAGE/manifest.json" <<JSON
{
  "product": "kosmos",
  "platform": "win32",
  "arch": "$ARCH",
  "version": "$_ver",
  "signed": false,
  "node": { "version": "v$NODE_VERSION", "download_sha256": "$NODE_SHA" },
  "agents_supported": false
}
JSON

# ---- the zip ---------------------------------------------------------------
mkdir -p "$REPO/$OUT"
ZIPOUT="$REPO/$OUT/kosmos-win-$ARCH.zip"
rm -f "$ZIPOUT"
( cd "$STAGE" && zip -qr "$ZIPOUT" . )
shasum -a 256 "$ZIPOUT" | awk '{print $1}' > "$ZIPOUT.sha256"

# 🛑 ASSERT THE ZIP CONTAINS WHAT WE THINK, rather than trusting that the staging
# above ran. A build that silently ships an empty app directory looks exactly
# like a build that worked, right up until somebody downloads it.
# 🛑 THE LISTING IS CAPTURED ONCE, NOT PIPED, AND THAT IS NOT A STYLE CHOICE.
# The first version of this loop was `unzip -l "$ZIPOUT" | grep -q " $want\$"`
# and it REPORTED A GOOD BUILD AS BROKEN: under `set -o pipefail`, `grep -q`
# exits the instant it matches, `unzip` is killed by SIGPIPE, and the pipeline's
# status is the failure rather than the match.
# ⚠️ IT ONLY BITES ON EARLY MATCHES, so it looked entirely reliable: the four
# entries near the END of the listing passed, and the first one grep could
# satisfy early was the one that "failed". A check that works for most of its
# inputs and lies about the rest is worse than one that never worked.
# ⭐ AND IT FAILS IN THE ALARMING DIRECTION, which is the rare safe one: it said
# a correct package was missing its own server. The same shape pointed the other
# way would have shipped an empty zip.
# Measured, three arms: pipefail + grep -q FAILS; without pipefail OK; captured
# first OK.
LISTING="$(unzip -l "$ZIPOUT")"
for want in "Kosmos.cmd" "open-board.cmd" "README.txt" "manifest.json" "runtime/node.exe" "app/server.js" "app/web/index.html"; do
  case "$LISTING" in
    *" $want"*) ;;
    *) echo "the zip is missing $want" >&2; exit 1 ;;
  esac
done
echo "==> $ZIPOUT"
echo "==> $(unzip -l "$ZIPOUT" | tail -1)"
