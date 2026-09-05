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

# #2007: the browser-open helper. It mirrors bash cmd_open's nonce flow so the
# ENFORCING Windows board (it runs unsandboxed) authenticates the browser instead
# of 403'ing it. It ships at the zip ROOT beside the launcher, NOT under app/,
# so it is a launcher artifact like the exe and the README rather than an app
# module -- which also keeps it out of the two-builder app-parity scan
# (tools.build-windows-570.test.js reads only `cp ... "$STAGE/app` lines).
cp "$REPO/tools/kosmos-open-board.js" "$STAGE/open-board.js"

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
trap 'rm -rf "$STAGE" "$TMP"' EXIT
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
# before the certificate Josh is buying could sign anything a user ever sees.
# The launcher does exactly what the .cmd did and nothing more; its source and
# the reasoning are in tools/windows/.
# ⚠️ COMMITTED, NOT COMPILED HERE, and that is the whole of the ruling. Building
# it during the cut would make a Windows machine a dependency of every release,
# and the release lane runs on a Mac. A committed binary is acceptable ONLY
# because its provenance is checkable: tools/windows/verify-launcher.ps1
# rebuilds it from the committed source and compares, which a reviewer runs on
# Windows. See tools/windows/README.md for why the compare is masked.
LAUNCHER="$REPO/tools/windows/Kosmos.exe"
[ -f "$LAUNCHER" ] || { echo "the committed launcher is missing: tools/windows/Kosmos.exe" >&2; exit 1; }

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
# security warning and the second is a board with no agents. Both are expected
# and neither is obvious.
{
  printf 'Kosmos for Windows (unsigned preview)\r\n'
  printf '\r\n'
  printf 'Double-click Kosmos.exe.\r\n'
  printf '\r\n'
  printf 'FIRST: Windows will try to stop you, and that is expected.\r\n'
  printf '\r\n'
  printf 'A blue box says "Windows protected your PC". The only button you can\r\n'
  printf 'see says "Don\047t run". DO NOT PRESS IT. Click the small "More info"\r\n'
  printf 'text above it, and then "Run anyway".\r\n'
  printf '\r\n'
  printf 'That happens because this build is not signed yet. Signing is a\r\n'
  printf 'certificate we have not bought, not a problem with the software.\r\n'
  printf '\r\n'
  printf 'You may also see "This file came from another computer and might be\r\n'
  printf 'blocked". If you do: right-click Kosmos.exe, choose Properties, tick\r\n'
  printf 'Unblock at the bottom, then OK. Windows adds that to anything that\r\n'
  printf 'arrives inside a downloaded zip.\r\n'
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
} > "$STAGE/! READ ME FIRST - Windows will warn you.txt"

# ---- the manifest ----------------------------------------------------------
cat > "$STAGE/manifest.json" <<JSON
{
  "product": "kosmos",
  "platform": "win32",
  "arch": "$ARCH",
  "version": "$_ver",
  "source_sha": "$SOURCE_SHA",
  "source_dirty": $SOURCE_DIRTY,
  "signed": false,
  "node": { "version": "v$NODE_VERSION", "download_sha256": "$NODE_SHA" },
  "agents_supported": false
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
for want in "Kosmos.exe" "open-board.js" "! READ ME FIRST - Windows will warn you.txt" "manifest.json" "runtime/node.exe" "app/server.js" "app/web/index.html"; do
  case "$LISTING" in
    *" $want"*) ;;
    *) refuse "the zip is missing $want" ;;
  esac
done
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

echo "==> $ZIPOUT"
echo "==> $(unzip -l "$ZIPOUT" | tail -1)"
