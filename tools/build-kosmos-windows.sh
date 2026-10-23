#!/usr/bin/env bash
# Build the Windows package: a zip somebody downloads, unpacks and runs.
#
# 🛑 JOSH'S v1, HIS WORDS (2026-08-29): "visit installkosmos.com and click
# Download for Windows. It downloads an application that they can run locally,
# launch and install Kosmos, and access their agents just like they can on the
# Mac." And his ruling the same afternoon: "Let's ship one unsigned to see it
# function and then let's walk through the process of what we have to do to buy
# a certificate."
#
# 🔏 THAT CERTIFICATE NOW EXISTS, SO THIS IS NO LONGER UNSIGNED (#6679). The two
# programs Kosmos makes are Authenticode-signed by Kosmos Agent Manager, Inc.
# BEFORE they reach this script, which signs nothing itself: Kosmos.exe (the
# committed launcher, see "the entry point" below) and the Plus connector,
# app/bin/kosmos-tunnel.exe. The build refuses either one unsigned, and the
# manifest's "signatures" records each one as this build saw it. node.exe and
# WebView2Loader.dll are other publishers' signed files, shipped as downloaded.
# ⚠️ SIGNED IS NOT "NO WARNING". A new certificate has no SmartScreen reputation
# yet, so Windows can still show "Windows protected your PC" with More info ->
# Run anyway the first time, and the read-me still walks a person through it.
#
# 🛑 WHAT THIS PACKAGE DOES AND DOES NOT DO, so nobody ships it believing more.
# It carries the BOARD, a Node runtime, and everything Windows AGENTS need (#570,
# slice 7c). An agent is a headless Scheduled Task whose supervisor holds the
# agent's pipes, so the board can make one, show its state, TALK to it, stop,
# restart, remove and restore it, and the fleet comes back after a reboot. An
# agent answers through the `kosmos` command the zip carries in `bin\` (#570,
# win32-kosmos-cli-570), which is how its reply reaches the board. The
# first double-click of Kosmos.exe registers the board's own logon task and hands
# the board to it (engine/win32handoff.js), so the board runs with no window.
# The agent lifecycle was measured by the R1-R8 rehearsal on a Windows 11 box
# (from a source checkout, .claude/plans/WINDOWS-ROADMAP.md §2). A zip built by
# this script was then checked end to end on the same box on 2026-09-11: create,
# talk (the agent's answer reaching the board), restart, remove, restore, the
# hand-off, and an update unpacked over the install.
#
# 🛑 AND IT UPDATES BY HAND. The Mac bundle ships `install/setup.sh`, which is how
# a Mac install updates itself. There is no Windows equivalent: a person updates
# by downloading the new zip and running its Kosmos.exe, which replaces the
# running board. Josh approved that for the first Windows release (2026-09-10),
# with an in-app updater as a fast-follow (WINDOWS-ROADMAP.md, BLOCKER 2).
#
# 📌 THIS HAS NOW BEEN RUN ON WINDOWS (2026-09-04), and the note that used to
# stand here -- "every claim here is about what the script stages, not about what
# happens when somebody double-clicks it" -- is retired rather than deleted so
# the answers are recorded next to the guesses. Of its two predicted surprises,
# the launcher's QUOTING was the real one: it is why the browser-open helper was
# split into its own file, and it is now moot because the entry point is a binary
# that passes argv rather than a .cmd that interpolates. APPDATA was populated
# and was never the problem. The build has been run, unpacked and launched on
# Windows 11, and the board serves.
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
# #6677: node sets the zip's file modes (tools/lib/zip-modes.js) on EVERY build, so it
# is checked here, before the downloads, not found missing after them.
command -v node >/dev/null 2>&1 || { echo "node is needed to build the Windows zip (it sets the zip's file modes, #6677); put it on PATH" >&2; exit 1; }

# ---- source provenance (#1749) --------------------------------------------
# The artifact must be able to say WHICH commit built it and whether that tree
# was clean. Without it a dirty, behind-origin PREVIEW build is byte-for-byte
# indistinguishable from a reproducible origin/main cut -- which is exactly how a
# 2-behind, 27-file-dirty zip nearly shipped as the real one on 2026-09-01.
# 🔑 STAMP, DO NOT REFUSE. A dirty preview ("ship one unsigned to see it
# function") is a legitimate build, so blocking it would break the workflow Josh
# asked for. Instead every zip is made self-describing, and a dirty tree WARNS
# loudly HERE -- before the ~35 MB Node download -- so the builder is told at
# build time rather than left to read a manifest nobody opens.
# ⚠️ source_dirty is only meaningful when source_sha is a real commit. If git is
# absent or this is not a repo, rev-parse fails to `unknown` and the dirty check
# defaults to false -- so a manifest reader must treat `source_dirty: false` as
# "clean" ONLY when source_sha is a sha, and as "could not determine" when it is
# `unknown`. The ambiguous middle (sha resolves but status fails) does not occur
# in practice: if rev-parse can read the repo, status can too.
SOURCE_SHA="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)"
if [ -n "$(git -C "$REPO" status --porcelain 2>/dev/null)" ]; then
  SOURCE_DIRTY=true
  echo "⚠️  build-kosmos-windows: the source tree is DIRTY (uncommitted changes)." >&2
  echo "    The zip is NOT reproducible and manifest.source_dirty=true. For a real" >&2
  echo "    cut, build from a clean worktree off origin/main." >&2
else
  SOURCE_DIRTY=false
fi

STAGE="$(mktemp -d)"
# kosmos#6831: one EXIT guard for the whole build. It removes $STAGE, and $TMP only once this script has made it
# (TMP is a common environment variable; an inherited one is never removed). It also turns a death after it (a
# missing library, an unset variable) into a failure, which bash 3.2 would otherwise report as exit 0.
. "$REPO/tools/lib/exit-guard.sh"
_win_tmp_made=0
_cleanup() { rm -rf "$STAGE"; [ "$_win_tmp_made" != 1 ] || rm -rf "$TMP"; }
kosmos_exit_guard _cleanup build-kosmos-windows
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
# kosmos#6587: the signed service key set ships beside the engine that checks it, checked (tools/lib/stage-service-keys.sh).
. "$REPO/tools/lib/stage-service-keys.sh"
kosmos_stage_service_keys "$REPO" "$STAGE/app/engine" || exit 1
cp -R "$REPO/web" "$STAGE/app/web"
cp "$REPO/bin/agent-supervisor.sh" "$STAGE/app/bin/"
cp "$REPO/bin/codex-report-bridge.js" "$STAGE/app/bin/"
# #3296: the gemini report bridge ships on both platforms (create.js resolves it via
# geminiBridgeSource() and installSupervisor copies it to supportDir), so the mac and
# windows builders must stage the same app/bin -- the tools.build-windows-570 cross-
# builder test fails the moment one platform ships a bin/ file the other does not.
cp "$REPO/bin/gemini-report-bridge.js" "$STAGE/app/bin/"
# #3391: the grok report bridge ships on both platforms for the same reason as the
# gemini bridge above -- the tools.build-windows-570 cross-builder test fails the
# moment one platform ships a bin/ file the other does not.
cp "$REPO/bin/grok-report-bridge.js" "$STAGE/app/bin/"
# #4043: the agy report bridge ships on both platforms (the cross-builder test requires bin/ to match).
cp "$REPO/bin/agy-report-bridge.js" "$STAGE/app/bin/"

# ---- the Plus connector (kosmos#4597) ---------------------------------------
# The program engine/remote.js starts for everything Kosmos Plus does (sign-in, the
# running tunnel, the Allow verbs). Without it the Plus pane says "the Plus connector
# is not installed on this computer yet", which is what every Windows build said
# before this. It is kosmos-relay's kosmos-tunnel.exe, built on the Windows PC by
# tools/build-tunnel-release-windows.ps1 -Sign, and it rides in app/bin, where
# remote.js looks for it on Windows (bundledConnector: bin/kosmos-tunnel.exe).
# 🛑 REFUSE, NEVER SHIP WITHOUT IT, like the Mac builder: missing or mismatched
# sidecars (connector-provenance.sh), behind kosmos-relay main (connector-currency.sh), needing
# a coordinator not yet deployed (coordinator-floor.sh), not a Windows x86-64 program, or
# unsigned (connector-windows.sh) all stop the build.
# 🔏 SIGNED BEFORE IT GETS HERE, NOT HERE, the launcher's rule (see Kosmos.exe
# below): the .sha256 names the signed bytes, so provenance, signature and the
# staged copy are one set of bytes. On Windows the build also asks Windows whether
# the signature is Valid and by whom, checks the verbs the board uses, and runs the
# staged copy with nothing but System32 on PATH. A non-Windows host can only check
# that a signature is PRESENT, and says so.
TUNNEL_BIN="${KOSMOS_TUNNEL_BIN:-$HOME/work/kosmos-relay/dist/kosmos-tunnel.exe}"
[ -f "$TUNNEL_BIN" ] || { echo "the Plus connector is missing: no kosmos-tunnel.exe at $TUNNEL_BIN (build it with kosmos-relay tools/build-tunnel-release-windows.ps1 -Sign <signing script>, or set KOSMOS_TUNNEL_BIN)" >&2; exit 1; }
. "$REPO/tools/lib/connector-provenance.sh"
. "$REPO/tools/lib/connector-windows.sh"
_connector_provenance_check "$TUNNEL_BIN" || exit 1
_tunnel_src="$CONNECTOR_COMMIT"; _tunnel_in="$CONNECTOR_SHA"
# #6628: the Mac cut refuses a connector behind kosmos-relay main (#3884, release.sh step 1d); so does this, for the
# connector the Windows build script made. KOSMOS_ALLOW_STALE_TUNNEL=1 ships it on purpose.
. "$REPO/tools/lib/connector-currency.sh"
connector_currency_check "$TUNNEL_BIN" "${KOSMOS_RELAY_REPO:-$HOME/work/kosmos-relay}" \
  tools/build-tunnel-release-windows.ps1 || exit 1
# And, as the Mac cut does next (release.sh step 1d2, #5037), the coordinator serving traffic must carry what that
# connector needs. KOSMOS_ALLOW_COORDINATOR_BEHIND=1 ships anyway.
. "$REPO/tools/lib/coordinator-floor.sh"
coordinator_floor_check "$TUNNEL_BIN" "${KOSMOS_RELAY_REPO:-$HOME/work/kosmos-relay}" "$REPO/tools/coordinator-floor" || exit 1
connector_pe_signed "$TUNNEL_BIN" || exit 1
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) _on_windows=1 ;; *) _on_windows=0 ;; esac
_tunnel_sig="present (not verified: this build did not run on Windows)"
if [ "$_on_windows" = 1 ]; then
  connector_authenticode "$TUNNEL_BIN" || exit 1
  _tunnel_sig="Valid"
  . "$REPO/tools/lib/connector-verbs.sh"
  connector_verbs_check "$TUNNEL_BIN" "$REPO/engine/phonenotify.js" || exit 1
fi
cp "$TUNNEL_BIN" "$STAGE/app/bin/kosmos-tunnel.exe"
_tunnel_staged="$(shasum -a 256 "$STAGE/app/bin/kosmos-tunnel.exe" | awk '{print $1}')"
[ "$_tunnel_staged" = "$_tunnel_in" ] || { echo "the connector changed under its sidecars between the check and the copy (sidecar $_tunnel_in, staged $_tunnel_staged); re-run the build" >&2; exit 1; }
if [ "$_on_windows" = 1 ]; then
  # Nothing but Windows itself on PATH: a toolchain DLL found on the build PC would be
  # missing on a customer's.
  PATH="/c/Windows/System32" "$STAGE/app/bin/kosmos-tunnel.exe" --help >/dev/null 2>&1 || { echo "the staged connector does not run (--help failed with only System32 on PATH)" >&2; exit 1; }
  echo "==> Plus connector: kosmos-tunnel.exe $_tunnel_staged, Authenticode Valid, runs with only System32 on PATH, built from kosmos-relay commit $_tunnel_src"
else
  echo "==> Plus connector: kosmos-tunnel.exe $_tunnel_staged, signature present (Authenticode and a test run need Windows; not done on this host), built from kosmos-relay commit $_tunnel_src"
fi

# #2007: the browser-open helper. It mirrors bash cmd_open's nonce flow so the
# ENFORCING Windows board (it runs unsandboxed) authenticates the browser instead
# of 403'ing it. It ships at the zip ROOT beside the launcher, NOT under app/,
# so it is a launcher artifact like the exe and the README rather than an app
# module -- which also keeps it out of the two-builder app-parity scan
# (tools.build-windows-570.test.js reads only `cp ... "$STAGE/app` lines).
cp "$REPO/tools/kosmos-open-board.js" "$STAGE/open-board.js"

# #570: the AGENT's `kosmos` command. Every message the board delivers ends "to
# answer, run: kosmos reply", and every agent's instructions teach `kosmos msg` and
# `kosmos post` -- and this zip shipped no `kosmos` at all, so a Windows agent's
# answer never reached the board (measured: "The term 'kosmos' is not recognized").
# tools/windows/kosmos-cli.js is that command in Node, run by this zip's own
# node.exe, and engine/win32launch.js puts `<zip>\bin` first on every agent's PATH
# (it looks for the kosmos-cli.js copied here). At the zip ROOT like open-board.js,
# not under app/, for the same reason: a launcher-side artifact, outside the
# two-builder app-parity scan.
# 🛑 ONE SHIM PER SHELL CLAUDE CODE USES, BOTH MEASURED ON THE BOX, AND NO .cmd.
# PowerShell resolves a bare `kosmos` to kosmos.ps1 (and Claude Code runs its
# PowerShell with a Bypass execution policy); Git Bash resolves the extensionless
# sh script. A .cmd was tried first and REMOVED: cmd's %* kept only the first line
# of a multi-line message and ran the tail of one holding `"...&...` as a command
# (review round 1). The .ps1 hands the arguments over as JSON in a private temp
# file, so no Windows command line ever carries the message, whatever its length.
# ⚠️ The sh shim is copied with any CR stripped: a builder whose git checks out
# CRLF would otherwise ship `#!/bin/sh\r`, which bash cannot run.
mkdir -p "$STAGE/bin"
cp "$REPO/tools/windows/kosmos-cli.js" "$STAGE/bin/kosmos-cli.js"
cp "$REPO/tools/windows/kosmos.ps1" "$STAGE/bin/kosmos.ps1"
tr -d '\r' < "$REPO/tools/windows/kosmos.sh" > "$STAGE/bin/kosmos"

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

# #4928: the What's new highlights must be for THIS version, as the Mac cut requires (release.sh step
# 1b-ii, #3955). The board shows web/whats-new.json only for the version it is running, so a Windows
# build on another number than the file's (or the file's "also" list) shipped with no "Kosmos has been
# updated" window at all. Same opt-out as the Mac cut: KOSMOS_CUT_NO_WHATS_NEW=1 for a hotfix with
# nothing to announce.
if [ "${KOSMOS_CUT_NO_WHATS_NEW:-}" = "1" ]; then
  echo "==> KOSMOS_CUT_NO_WHATS_NEW=1: the highlights check is not enforced for $_ver; with no highlights for $_ver there is no \"Kosmos has been updated\" window"
else
  _wn=0
  node "$REPO/tools/whats-new-check.js" "$_ver" "$STAGE/app/web/whats-new.json" --platform=windows || _wn=$?
  case "$_wn" in
    0) ;;
    3) echo "the Windows build stops: web/whats-new.json is not ready for $_ver, and the reason is printed above. If it has no highlight for Windows (#5224), tag one \"platforms\": [\"windows\"] or leave one untagged. If it is not for $_ver and this is the same release as the Mac's, add \"$_ver\" to its \"also\" list and COMMIT it on the release branch (the board does not open the same words twice, #4928). Or set KOSMOS_CUT_NO_WHATS_NEW=1." >&2; exit 1 ;;
    *) echo "the Windows build stops: the highlights check could not run (exit $_wn), so whether $_ver shows a window is not known (#4928)" >&2; exit 1 ;;
  esac
fi

# ---- the runtime -----------------------------------------------------------
# ⚠️ CHECKSUM-VERIFIED AGAINST nodejs.org's OWN SHASUMS, and the build DIES on a
# mismatch. A package from a new publisher is already asking somebody to click
# through a warning; shipping an unverified runtime inside it would be asking them to
# trust something we did not check ourselves.
echo "==> downloading node v$NODE_VERSION (win-$ARCH)"
ZIP="node-v$NODE_VERSION-win-$ARCH.zip"
BASE="https://nodejs.org/dist/v$NODE_VERSION"
# 🛑 OUTSIDE THE STAGING TREE, NOT `$STAGE/dl` (#2086). The scratch dir for the
# ~35 MB node download used to live inside the very tree that gets packed, with
# only a later `rm -rf` standing between it and the user's folder. On a Windows
# builder that was not enough: Windows keeps a directory with an open handle in
# a PENDING-DELETE state, where `test -e` reports it GONE (opens fail) while
# directory enumeration still returns it -- so the cleanup check passed and the
# packer shipped an empty `dl/` in the download anyway. The two disagreed, and
# the one that was wrong was the one doing the checking.
# ⇒ Staging is now the only thing under $STAGE, so no cleanup timing, on any
# platform, can put scratch into the artifact. A guard that depends on deletion
# winning a race is weaker than not putting the file there.
TMP="$(mktemp -d)"
_win_tmp_made=1   # the guard's cleanup now removes it too (kosmos#6831)
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
# ⚠️ AND ASSERT THE STAGING TREE CARRIES NO SCRATCH, which is the check that
# actually matters now that the download lives elsewhere. It is stated as "what
# is in the artifact" rather than "did a delete succeed", because the delete is
# what lied on Windows. Every other assertion in this file checks that something
# expected is PRESENT; nothing checked that something unexpected was ABSENT, and
# an empty `dl/` shipped to users through that gap.
[ ! -e "$STAGE/dl" ] || { echo "staging carries a scratch dir it should not: $STAGE/dl" >&2; exit 1; }

# ---- the window's loader (#1118) ---------------------------------------------
# Kosmos.exe shows the board in its own window, hosted by the Microsoft Edge WebView2 Runtime that
# Windows itself installs and updates. The one file of Microsoft's Kosmos ships for that is the
# small native loader that finds the Runtime, WebView2Loader.dll, which Microsoft publishes only
# inside the Microsoft.Web.WebView2 NuGet package. It goes in runtime\ beside node.exe: a folder the
# updater (win32update ENTRIES) and the move already carry whole, and the path KosmosLauncher.cs
# loads it from (WebView2LoaderRelativePath). Without it the launcher still works: it opens the
# browser, as before, and says why.
# 🔑 PINNED BY HASH, like the node runtime. NuGet has no SHASUMS file to check against, but a NuGet
# package version is immutable, so the sha256 measured when this version was chosen is the check:
# the build DIES on any other bytes. Bump the version and the hash together.
# 📌 Its LICENSE (BSD-style) asks that binary redistribution reproduce the notice, so it ships
# beside the DLL.
WEBVIEW2_SDK_VERSION="1.0.4191.47"
WEBVIEW2_SDK_SHA256="f492bbf547d0da329553b6727435b677579b1e9f91cc9e4a1ad029366d5f23d0"
case "$ARCH" in x64|arm64|x86) ;; *) echo "the WebView2 package has no loader for win-$ARCH" >&2; exit 1 ;; esac
echo "==> downloading the WebView2 loader (SDK $WEBVIEW2_SDK_VERSION, win-$ARCH)"
TMP="$(mktemp -d)"
curl -fsSL "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$WEBVIEW2_SDK_VERSION/microsoft.web.webview2.$WEBVIEW2_SDK_VERSION.nupkg" -o "$TMP/webview2.nupkg"
GOT="$(shasum -a 256 "$TMP/webview2.nupkg" | awk '{print $1}')"
[ "$GOT" = "$WEBVIEW2_SDK_SHA256" ] || { echo "WebView2 package checksum mismatch: want $WEBVIEW2_SDK_SHA256 got $GOT" >&2; exit 1; }
( cd "$TMP" && unzip -q webview2.nupkg "build/native/$ARCH/WebView2Loader.dll" LICENSE.txt )
cp "$TMP/build/native/$ARCH/WebView2Loader.dll" "$STAGE/runtime/WebView2Loader.dll"
cp "$TMP/LICENSE.txt" "$STAGE/runtime/WebView2Loader.LICENSE.txt"
rm -rf "$TMP"
echo "==> checksum ok"

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
# 📌 open-board.cmd IS GONE (#2086). It existed to spare the .cmd launcher a
# nested-quoting problem that cannot be tested from a Mac -- `start` inside
# `cmd /c` with quoted paths. The launcher is a PE binary now and starts the
# opener with an argv array, so there is no quoting to get wrong and no reason
# for the wrapper to exist. open-board.js, which holds the actual #2007 nonce
# flow, is unchanged and still ships at the zip root; only its .cmd shim went.

# ---- the entry point -------------------------------------------------------
# 🛑 A PREBUILT .exe, NOT THE .cmd THIS USED TO WRITE (#2086, Baron's ruling).
# The file a person double-clicks is the ONLY file a certificate can be worth
# anything on, and a .cmd CANNOT CARRY ONE -- measured, not assumed:
# Get-AuthenticodeSignature on a .cmd returns UnknownError, because a batch file
# has nowhere to put a signature. So the entry point had to become a PE binary
# before the certificate Josh was buying could sign anything a user ever sees.
# The launcher does exactly what the .cmd did and nothing more; its source and
# the reasoning are in tools/windows/.
# 🔏 THE COMMITTED EXE IS NOW AUTHENTICODE-SIGNED (Kosmos Agent Manager, Inc.,
# Azure Artifact Signing, RFC 3161 timestamped), and this script copies it
# UNCHANGED. Signing happens on the Windows box, to the committed file, never
# here: the Mac cannot sign it, and re-signing during the cut would make the
# release depend on that box after all. A launcher source change therefore
# means rebuild + re-sign + commit, together (tools/windows/README.md).
# ⚠️ COMMITTED, NOT COMPILED HERE, and that is the whole of the ruling. Building
# it during the cut would make a Windows machine a dependency of every release,
# and the release lane runs on a Mac. A committed binary is acceptable ONLY
# because its provenance is checkable: tools/windows/verify-launcher.ps1
# rebuilds it from the committed source and compares, which a reviewer runs on
# Windows. See tools/windows/README.md for why the compare is masked, and how a
# signed exe is compared as the unsigned image it was made from.
LAUNCHER="$REPO/tools/windows/Kosmos.exe"
[ -f "$LAUNCHER" ] || { echo "the committed launcher is missing: tools/windows/Kosmos.exe" >&2; exit 1; }

# 🛑 #6512: A SOURCE CHANGE WITHOUT A REBUILD IS REFUSED. #6437 and #6449 changed
# KosmosLauncher.cs "source only", and a cut from main would have shipped the
# older binary without them, silently. A Mac cannot rebuild or byte-check the exe
# (verify-launcher.ps1 is Windows-only), but it can see the ORDER of commits: the
# last commit that touched an input of the build (the source, or the icon compiled
# into it) must also be in the history of the last commit that touched the exe (the
# same commit counts). If it is not, the exe is older than what it is built from.
# Without full git history to read (an export, or a shallow clone, where `git log`
# names the shallow boundary for every file) this says so and goes on: it is a
# tripwire for drift, not the provenance check, which stays verify-launcher.ps1.
LAUNCHER_INPUTS="tools/windows/KosmosLauncher.cs assets/kosmos.ico"
LAUNCHER_SRC_AT=""
LAUNCHER_EXE_AT=""
if [ "$(git -C "$REPO" rev-parse --is-shallow-repository 2>/dev/null)" = "false" ]; then
  # shellcheck disable=SC2086 # the two input paths, split on purpose
  LAUNCHER_SRC_AT="$(git -C "$REPO" log -1 --format=%H -- $LAUNCHER_INPUTS 2>/dev/null || true)"
  LAUNCHER_EXE_AT="$(git -C "$REPO" log -1 --format=%H -- tools/windows/Kosmos.exe 2>/dev/null || true)"
fi
if [ -n "$LAUNCHER_SRC_AT" ] && [ -n "$LAUNCHER_EXE_AT" ]; then
  LAUNCHER_ORDER=0
  git -C "$REPO" merge-base --is-ancestor "$LAUNCHER_SRC_AT" "$LAUNCHER_EXE_AT" || LAUNCHER_ORDER=$?
  if [ "$LAUNCHER_ORDER" = 1 ]; then
    echo "tools/windows/Kosmos.exe is older than what it is built from ($LAUNCHER_INPUTS):" >&2
    echo "they changed in $LAUNCHER_SRC_AT, after the exe's last rebuild in $LAUNCHER_EXE_AT." >&2
    echo "Rebuild and re-sign Kosmos.exe on the Windows box (tools/windows/README.md), and commit it." >&2
    exit 1
  elif [ "$LAUNCHER_ORDER" != 0 ]; then
    echo "git could not compare the launcher's commits (merge-base exit $LAUNCHER_ORDER), so the cut stops here (#6512)." >&2
    exit 1
  fi
else
  echo "note: no full git history for the launcher here, so its source-vs-exe order is not checked (#6512)" >&2
fi

# 🛑 THE PORT IS BAKED INTO THE LAUNCHER AND READ OUT OF server.js HERE, so this
# is the THIRD copy of one number and the one nobody can see. The launcher's
# source names its own default; if server.js ever moves and the launcher is not
# rebuilt, the package ships a binary that opens a browser on a dead port while
# the board sits there working -- which is precisely the class of bug the
# PORT_DEFAULT read above exists to prevent, one file further along.
# ⇒ Compare them and REFUSE, rather than shipping a mismatch nobody would see
# until a user did. The source is what is checked because verify-launcher.ps1
# already ties the binary to that source.
LAUNCHER_PORT="$(sed -n 's/.*DefaultPort *= *\([0-9][0-9]*\).*/\1/p' "$REPO/tools/windows/KosmosLauncher.cs" | head -1)"
[ -n "$LAUNCHER_PORT" ] || { echo "could not read DefaultPort out of tools/windows/KosmosLauncher.cs" >&2; exit 1; }
[ "$LAUNCHER_PORT" = "$PORT_DEFAULT" ] || {
  echo "the launcher's baked port ($LAUNCHER_PORT) is not the board's default ($PORT_DEFAULT)." >&2
  echo "Update DefaultPort in tools/windows/KosmosLauncher.cs, rebuild Kosmos.exe" >&2
  echo "(see tools/windows/README.md), and commit both together." >&2
  exit 1
}
# 🔏 #6679: THE READ-ME SAYS Kosmos.exe IS SIGNED, so the build holds the launcher to
# what the read-me says, the way it holds the connector above: a signature must be
# PRESENT on any host, and on Windows, Windows itself must call it Valid and by
# Kosmos Agent Manager, Inc. Both checks are connector-windows.sh's general PE ones
# (pe_signature_present, pe_authenticode): the launcher is a 32-bit (AnyCPU) PE, which
# the connector's x86-64 check rightly refuses. What was checked lands in the manifest.
_launcher_why="$(pe_signature_present "$LAUNCHER" 2>&1 >/dev/null)" || {
  echo "tools/windows/Kosmos.exe is not signed, and the zip's read-me tells people it is (#6679): ${_launcher_why#pe_signature_present: }" >&2
  echo "Sign it on the Windows box (tools/windows/README.md) and commit it." >&2
  exit 1
}
_launcher_sig="present (not verified: this build did not run on Windows)"
if [ "$_on_windows" = 1 ]; then
  # The signer is the read-me's own words, NOT KOSMOS_WIN_SIGNER: the read-me names this
  # publisher, so a launcher signed by anyone else is refused whatever that override says.
  _launcher_why="$(KOSMOS_WIN_SIGNER="Kosmos Agent Manager, Inc." pe_authenticode "$LAUNCHER" Kosmos.exe 2>&1 >/dev/null)" || {
    echo "Windows does not accept tools/windows/Kosmos.exe's signature (#6679): ${_launcher_why#pe_authenticode: }" >&2
    exit 1
  }
  _launcher_sig="Valid"
fi
cp "$LAUNCHER" "$STAGE/Kosmos.exe"

# 🛑 THE FILENAME IS THE WARNING, BECAUSE THE README CANNOT REACH HER IN TIME.
# The SmartScreen dialog appears when she double-clicks the launcher, BEFORE a
# single line we ship has run. Nothing inside this package can speak at that
# moment. The one thing she sees first is the FOLDER LISTING, so the warning has
# to be in a filename, and the file has to sort above `Kosmos.exe`.
# ⇒ `! READ ME FIRST - Windows will warn you.txt`. Clumsy, and it is the only
# surface that exists at the moment she acts.
# ⚠️ THE `!` IS LOAD-BEARING AND I HAD IT WRONG. My first version was
# `READ ME FIRST...` and I wrote in this very comment that it "sorts above
# Kosmos.exe". IT DOES NOT: Explorer sorts alphabetically and `K` comes before
# `R`, so the launcher was listed FIRST and the warning second. I checked by
# printing the sorted listing, which is the only reason I know. A `!` sorts
# before letters.
# ⚠️ AND THE DIALOG'S VISIBLE BUTTON IS "Don't run". The way past is behind
# "More info", which does not look like a button. Somebody who has not been told
# stops there, and we learn nothing about the installer because it never ran.
# 🔑 A README A PERSON ACTUALLY READS, because the FIRST thing they see is a
# security warning, which is expected and not obvious. (The launcher window that
# used to close by itself is gone: Kosmos.exe is a GUI exe, win32-launcher-native.)
# 🔑 IN WINDOWS' OWN WORDS: "Extract All...", "sign in", the Task Scheduler path
# spelled out. A Windows person has never been told to "unpack" anything.
# ⚠️ THE FOLDER IS THE INSTALL. There is no installer: the board's and every
# agent's logon task run the app from wherever the zip was extracted (the engine
# pointer, engine/win32anchor.js), so a folder extracted into Downloads and
# tidied away later leaves Kosmos unable to start at the next sign-in. That is
# why the README's first instruction is where to extract it. The example is
# %LOCALAPPDATA%\Programs\Kosmos, the per-user program folder, and NOT
# C:\Users\<name>\Kosmos, which is where Kosmos keeps the person's Projects.
# After the first run the README sends people to the Start menu, never back to
# Kosmos.exe: it has just told them they can delete the zip (and so the folder
# they extracted), and the Start menu shortcut runs the installed Kosmos.exe, the
# same program, so it also signs an open window in again (tools/windows/README.md).
# The one exception it names is a first run that never got as far as the Start
# menu (the person pressed "Don't run"): then the extracted Kosmos.exe is the way.
{
  printf 'Kosmos for Windows\r\n'
  printf '\r\n'
  printf 'To install: right-click the zip in your Downloads folder, choose\r\n'
  printf 'Extract All..., and click Extract. Then open the extracted folder\r\n'
  printf 'and double-click Kosmos.exe.\r\n'
  printf '\r\n'
  printf 'The first time, Kosmos installs itself into its own folder on this\r\n'
  printf 'computer (%%LOCALAPPDATA%%\\Programs\\Kosmos), adds itself to the Start\r\n'
  printf 'menu and to Settings > Apps, and opens. Nothing asks you where to\r\n'
  printf 'put it, and no administrator is needed. From then on, open Kosmos\r\n'
  printf 'from the Start menu. You can delete the zip you downloaded.\r\n'
  printf '\r\n'
  printf 'Tip: before you extract, right-click the zip, choose Properties, tick\r\n'
  printf 'Unblock at the bottom, then click OK. Windows then warns you less\r\n'
  printf 'about the files inside it.\r\n'
  printf '\r\n'
  printf 'Kosmos.exe is signed by Kosmos Agent Manager, Inc. Kosmos is still\r\n'
  printf 'new, so the first time you open it Windows may try to stop you\r\n'
  printf 'anyway. That is expected.\r\n'
  printf '\r\n'
  printf 'A blue box says "Windows protected your PC". The only button you can\r\n'
  printf 'see says "Don\047t run". DO NOT PRESS IT. Click the small "More info"\r\n'
  printf 'text above it, and then "Run anyway".\r\n'
  printf '\r\n'
  printf 'If a box asks whether to run Kosmos.exe\r\n'
  printf 'from Kosmos Agent Manager, Inc., click Run.\r\n'
  printf '\r\n'
  printf 'Kosmos opens in its own window. Closing that window does not stop\r\n'
  printf 'Kosmos: it keeps running in the background and starts by itself when\r\n'
  printf 'you sign in to Windows. Your agents do too. To open Kosmos again\r\n'
  printf 'later, open it from the Start menu.\r\n'
  printf '\r\n'
  printf 'Agents need Claude Code on this computer, signed in. If it is\r\n'
  printf 'missing, the board shows you the command that installs it. If it is\r\n'
  printf 'not signed in, the board shows you how to sign in.\r\n'
  printf '\r\n'
  printf 'To update by hand: download the new zip, extract it, and double-click\r\n'
  printf 'Kosmos.exe in it. It updates the Kosmos installed on this computer\r\n'
  printf 'rather than making a second one. Your agents keep running.\r\n'
  printf '\r\n'
  printf 'Everything Kosmos starts when you sign in is listed in Task\r\n'
  printf 'Scheduler: open Start, type Task Scheduler, press Enter, and open\r\n'
  printf 'Task Scheduler Library, then the Kosmos folder.\r\n'
  printf '\r\n'
  printf 'If Kosmos does not open, or the board says it is not signed in,\r\n'
  printf 'open Kosmos from the Start menu again. If Kosmos is not in the\r\n'
  printf 'Start menu yet, double-click Kosmos.exe in the extracted folder once\r\n'
  printf 'more. Bookmarks to Kosmos don\047t stay signed in. Always open\r\n'
  printf 'Kosmos from the Start menu.\r\n'
} > "$STAGE/! READ ME FIRST - Windows will warn you.txt"

# ---- the manifest ----------------------------------------------------------
# 🔏 #6679: "signatures" replaces the old `"signed": false`, which stopped being
# true the day Kosmos.exe was signed. It is PER FILE, for the two programs Kosmos
# signs, and says what THIS BUILD checked: "Valid" (Windows said so, by Kosmos
# Agent Manager, Inc.) or "present (not verified: ...)" (a non-Windows build can
# only see that a signature is there). It is a record for people, never a trust
# input: nothing reads it to decide anything, and the updater asks Windows about
# the update's own Kosmos.exe itself (win32update.js signatureRefusal). There is
# deliberately no single "signed": true, which a reader could take as covering
# every file in the zip.
# connector.signature (older, #4597) repeats the connector's entry on purpose: it
# stays where existing readers of the connector block look for it.
cat > "$STAGE/manifest.json" <<JSON
{
  "product": "kosmos",
  "platform": "win32",
  "arch": "$ARCH",
  "version": "$_ver",
  "source_sha": "$SOURCE_SHA",
  "source_dirty": $SOURCE_DIRTY,
  "signatures": { "Kosmos.exe": "$_launcher_sig", "app/bin/kosmos-tunnel.exe": "$_tunnel_sig" },
  "node": { "version": "v$NODE_VERSION", "download_sha256": "$NODE_SHA" },
  "webview2_loader": { "sdk_version": "$WEBVIEW2_SDK_VERSION", "download_sha256": "$WEBVIEW2_SDK_SHA256" },
  "agents_supported": true,
  "connector": { "file": "app/bin/kosmos-tunnel.exe", "sha256": "$_tunnel_staged", "commit": "$_tunnel_src", "signature": "$_tunnel_sig" }
}
JSON

# ---- the zip ---------------------------------------------------------------
# 🛑 AN ABSOLUTE OUTDIR WAS SILENTLY JOINED TO THE REPO ROOT. `"$REPO/$OUT"` with
# `$OUT=/tmp/x` produced `/Users/.../agent-workforce//tmp/x`, created it, wrote a
# 36 MB zip into it, and printed that path as if it were what you asked for.
# ⇒ Nothing failed. The artifact simply was not where the caller said, and a
# verification script looking in `/tmp/x` found nothing and reported the runtime
# CORRUPTED. I hit exactly that while verifying this builder.
# ⚠️ ABSOLUTE WINS, RELATIVE IS STILL REPO-RELATIVE, so `dist` keeps meaning what
# it has always meant and nobody's existing invocation changes.
case "$OUT" in
  /*) OUTDIR="$OUT" ;;
  *)  OUTDIR="$REPO/$OUT" ;;
esac
mkdir -p "$OUTDIR"
ZIPOUT="$OUTDIR/kosmos-win-$ARCH.zip"
rm -f "$ZIPOUT"
( cd "$STAGE" && zip -qr "$ZIPOUT" . )
# 🛑 #6677: SANE MODES, WHICHEVER TOOL MADE THE ZIP. On the Windows release box `zip`
# is a shim over Windows' bsdtar, which stores every file 0666 and every folder and
# .exe 0777 (0.7.60: all 369 entries world-writable); Info-ZIP on a Mac copies
# whatever the checkout had. tools/lib/zip-modes.js rewrites each entry to 0644,
# 0755 for programs (.exe .dll .cmd .bat, or a #! script) and 0755 for folders, in
# place, BEFORE the .sha256 is taken, and the checks below read the result back.
node "$REPO/tools/lib/zip-modes.js" set "$ZIPOUT" "$STAGE" || { rm -f "$ZIPOUT"; echo "could not set the zip's file modes (#6677); the reason is printed above" >&2; exit 1; }
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
# 🛑 A REFUSED BUILD MUST NOT LEAVE THE THING IT REFUSED. Every check below runs
# AFTER the zip is written, because they inspect the zip. Without this, a build
# that correctly refused still left a 36 MB artifact on disk with the exact
# defect it refused for, and the next person to reach for `dist/` finds it.
# ⚠️ The exit code is the signal a script reads; the FILE is the signal a human
# reads, and they were saying opposite things.
refuse() { echo "$1" >&2; rm -f "$ZIPOUT" "$ZIPOUT.sha256"; exit 1; }

LISTING="$(unzip -l "$ZIPOUT")"
for want in "Kosmos.exe" "open-board.js" "! READ ME FIRST - Windows will warn you.txt" "manifest.json" "runtime/node.exe" "app/server.js" "app/web/index.html" "app/engine/kosmos-report-hook.js" "bin/kosmos-cli.js" "bin/kosmos.ps1"; do
  case "$LISTING" in
    *" $want"*) ;;
    *) refuse "the zip is missing $want" ;;
  esac
done
# The Git Bash shim has no extension, so " bin/kosmos" alone would also match
# " bin/kosmos-cli.js" above: it is checked as a whole listing line.
case "$LISTING" in
  *" bin/kosmos"$'\n'*) ;;
  *) refuse "the zip is missing bin/kosmos (the Git Bash shim)" ;;
esac
# #1118: the window's loader. Not in the list above on purpose: that list is win32update's
# REQUIRED_ENTRIES (a build without one is incomplete, and cannot be moved or updated to), while a
# build without the loader still runs, in the browser. A build THIS script makes always has it.
case "$LISTING" in
  *" runtime/WebView2Loader.dll"$'\n'*) ;;
  *) refuse "the zip is missing runtime/WebView2Loader.dll (Kosmos's own window)" ;;
esac
# kosmos#4597: the Plus connector, without which Kosmos Plus cannot sign in on Windows.
case "$LISTING" in
  *" app/bin/kosmos-tunnel.exe"$'\n'*) ;;
  *) refuse "the zip is missing app/bin/kosmos-tunnel.exe (the Plus connector)" ;;
esac
# 🛑 NO TEST FILES, AND THE ENGINE COUNT MUST MATCH THE REPO (Renet's finding).
# His parallel builder's engine glob had no filter: it staged 137 .js of which
# only 59 were real modules, so 78 TEST FILES SHIPPED TO USERS.
# ⭐ AND THE PART WORTH COPYING IS WHY HIS OWN GUARD DID NOT CATCH IT: he had a
# floor of "at least 50 engine files", AND THE FLOOR WAS SATISFIED BY THE TEST
# FILES. A count that the defect itself inflates cannot detect the defect.
# ⇒ So this asserts TWO things that cannot both be satisfied by the same
# mistake: ZERO test files, and a count that EQUALS the repo rather than clears
# a floor. Equality is what makes shipping too many as loud as shipping too few.
_tests="$(printf '%s\n' "$LISTING" | grep -c '\.test\.js' || true)"
[ "$_tests" = "0" ] || refuse "the zip ships $_tests test file(s); the engine glob lost its filter"
_zipmods="$(printf '%s\n' "$LISTING" | grep -c ' app/engine/[^ ]*\.js$' || true)"
_repomods="$(ls "$REPO"/engine/*.js | grep -vc '\.test\.js')"
[ "$_zipmods" = "$_repomods" ] || refuse "the zip carries $_zipmods engine modules and the repo has $_repomods"
echo "==> $_repomods engine modules, 0 test files"
# #6677: read the modes back from the finished zip, not from what `set` said it did.
node "$REPO/tools/lib/zip-modes.js" check "$ZIPOUT" "$STAGE" || refuse "the zip carries entries with the wrong file mode (#6677)"

echo "==> $ZIPOUT"
# The zip's own size first: unzip -l's total line is the UNPACKED size, which
# once read as the download tripling (45 MB zip, 121 MB unpacked).
_zipbytes="$(wc -c < "$ZIPOUT" | tr -d ' ')"
read -r _unpacked _nfiles _ <<<"$(printf '%s\n' "$LISTING" | tail -1)"
echo "==> zip $_zipbytes bytes; unpacked $_unpacked bytes in $_nfiles files"

# ---- the signed release manifest (#6466) -----------------------------------
# The Windows twin of the Mac's signed manifest (#6468): every file in the zip with its sha256, the zip's sha256 and
# version, in the Mac's format plus "platform": "win32". Installs of THIS build refuse an update whose manifest is
# missing or not signed by the release key engine/manifest-verify.js pins (engine/win32update.js B1b/B3b), and
# tools/windows/publish-r2.ps1 refuses to stage this build without it. Written from the STAGE the zip was made from,
# then checked against the zip itself once signed (publish-r2.ps1 does that check again before uploading).
# Signed with the SAME key and the SAME step as the Mac release (tools/lib/manifest-sign.js sign), on whichever
# computer holds kosmos-manifest-signing: here when KOSMOS_MANIFEST_KEY names it (a computer that holds the key; not
# the Windows PC, where the key never comes), otherwise by the key holder after publish-r2.ps1 -ForSigning puts the
# zip and this manifest up (tools/windows/RELEASING.md, the per-release order).
MANIFEST_OUT="$OUTDIR/kosmos-$_ver-win-$ARCH.manifest.json"
rm -f "$MANIFEST_OUT" "$MANIFEST_OUT.sig"
command -v node >/dev/null 2>&1 || refuse "node is needed to write the signed release manifest (#6466)"
node "$REPO/tools/lib/win-release-manifest.js" write "$STAGE" "$ZIPOUT" "$_ver" "$ARCH" "$MANIFEST_OUT" \
  || { rm -f "$MANIFEST_OUT"; refuse "the release manifest could not be written (#6466)"; }
if [ -n "${KOSMOS_MANIFEST_KEY:-}" ]; then
  node "$REPO/tools/lib/manifest-sign.js" sign "$KOSMOS_MANIFEST_KEY" "$MANIFEST_OUT" "$MANIFEST_OUT.sig" \
    || { rm -f "$MANIFEST_OUT" "$MANIFEST_OUT.sig"; refuse "the release manifest could not be signed (#6466)"; }
  node "$REPO/tools/lib/win-release-manifest.js" check "$MANIFEST_OUT" "$MANIFEST_OUT.sig" "$ZIPOUT" "$_ver" "$ARCH" \
    || { rm -f "$MANIFEST_OUT" "$MANIFEST_OUT.sig"; refuse "the signed release manifest does not check out against the zip (#6466)"; }
  echo "==> signed: $(basename "$MANIFEST_OUT").sig"
else
  echo "==> NOT SIGNED YET: $(basename "$MANIFEST_OUT"). Next: put it up for signing (no pointer moves):"
  echo "      pwsh tools/windows/publish-r2.ps1 -Zip $ZIPOUT -ForSigning"
  echo "    then send the key holder the version and manifest sha256 it prints. publish-r2.ps1 refuses to stage this build without the .sig."
fi
kosmos_finished
