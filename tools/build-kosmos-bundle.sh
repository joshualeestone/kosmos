#!/bin/bash
# Build the Kosmos app bundle the installer downloads: kosmos-<arch>.tar.gz,
# containing the app, a private Node runtime, and the `kosmos` command.
#
# The installer (install/setup.sh) extracts this into $KOSMOS_HOME and expects:
#
#   bin/kosmos          the command (install/kosmos, this repo)
#   runtime/bin/node    a Node that runs from a home folder on a clean Mac
#   app/                server.js, engine/, web/, bin/, package.json
#
# ⚠️ WHY A WHOLE NODE SHIPS. The app is dependency-free by design (node:*
# builtins only, no node_modules), so the ONLY thing between a clean Mac and a
# running board is a Node binary. macOS does not ship one, and asking a
# non-technical person to install Node is the install we are replacing. The
# official arm64 binary is ~50MB on disk and ~30MB compressed, which is the
# bulk of this bundle; that is the price of "paste one line".
#
# ⚠️ THE RUNTIME IS DOWNLOADED FROM nodejs.org AND CHECKSUM-VERIFIED against
# the SHASUMS256.txt published next to it, then the four files we take keep
# Apple's own signature (nodejs.org macOS binaries are signed and notarised;
# re-signing them ad-hoc would replace a real identity with none). The version
# is PINNED, not "latest": the bundle must not change under us because a
# release day happened.
#
# ⚠️ NODE_SOURCE overrides the download for offline builds and tests, same
# pattern as TMUX_SOURCE in build-tmux-bundle.sh. A bundle built that way is
# for TESTING: a Homebrew node links only system libraries today, but the
# release bundle is built from the official binary, always.
#
# Usage:  tools/build-kosmos-bundle.sh [output-dir]
# Output: <out>/kosmos-<arch>.tar.gz plus the staged tree it was made from.

set -euo pipefail
# One EXIT trap, registered before anything can create a temp resource: six
# exit-1 paths once sat between the download's mktemp and a trap that was
# "folded in" later, each leaking ~150MB of Node tarball per failed build.
TMP=""; SMOKE_LOG=""; SMOKE_ROOTS=""
trap 'rm -rf "${TMP:-}" "${SMOKE_LOG:-}" "${SMOKE_ROOTS:-}"' EXIT

NODE_VERSION="${KOSMOS_NODE_VERSION:-24.19.0}"
OUT="${1:-dist}"
ARCH="$(uname -m)"
STAGE="$OUT/kosmos-bundle"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

rm -rf "$STAGE"
mkdir -p "$STAGE/bin" "$STAGE/app" "$STAGE/runtime/bin"

# ---- the app ---------------------------------------------------------------
# ⚠️ AN EXPLICIT LIST, NOT AN EXCLUDE LIST. `cp -R . minus tests` rots the
# other way: the next stray file in the repo root ships to every user. Naming
# what ships means a new runtime file has to be added here consciously, and
# the smoke test below fails loudly if a required one is forgotten.
echo "==> staging the app"
cp "$REPO/server.js" "$REPO/package.json" "$STAGE/app/"
mkdir -p "$STAGE/app/engine" "$STAGE/app/bin"
for f in "$REPO"/engine/*.js; do
  case "$f" in *.test.js) ;; *) cp "$f" "$STAGE/app/engine/" ;; esac
done
cp -R "$REPO/web" "$STAGE/app/web"
# 🛑 BAKE THE VERSION INTO THE PAGE. It used to be readable only from the status
# poll, so on a machine whose board was not running the version was unknown for
# the same reason everything else was (#269). A fact about the bundle must not
# require the bundle's API.
#
# ⚠️ SUBSTITUTED HERE RATHER THAN COMMITTED, so a source checkout keeps the
# marker and the page falls back to the polled value. And VERIFIED, because a
# silent no-op sed would ship the marker itself to a person's screen: the check
# below fails the build rather than shipping "version __KOSMOS_VERSION__".
# ⚠️ READ WITHOUT AN INTERPRETER, and that is an ordering fact rather than a
# preference. The first version used "$STAGE/runtime/bin/node", which is not
# staged yet at this point in the build, so the whole build died one line later
# with "No such file or directory". package.json IS already copied, and one
# field out of it does not need a JSON parser.
_ver="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$STAGE/app/package.json" | head -1)"
[ -n "$_ver" ] || { echo "could not read the version to bake into the page" >&2; exit 1; }
sed -i '' "s/__KOSMOS_VERSION__/$_ver/" "$STAGE/app/web/index.html" 2>/dev/null \
  || sed -i "s/__KOSMOS_VERSION__/$_ver/" "$STAGE/app/web/index.html"
grep -q "__KOSMOS_VERSION__" "$STAGE/app/web/index.html" && {
  echo "the version marker survived the bake; the page would ship it verbatim" >&2; exit 1; }
grep -q "content=\"$_ver\"" "$STAGE/app/web/index.html" || {
  echo "the version was not baked into the page" >&2; exit 1; }
echo "==> baked version $_ver into the page"
cp "$REPO/bin/agent-supervisor.sh" "$STAGE/app/bin/"
chmod +x "$STAGE/app/bin/agent-supervisor.sh"
# 🛑 EVERY runtime file engine/create.js resolves under bin/ ships, by name
# (this file's explicit-list rule). The codex notify bridge was resolved by
# create.js since #245 and never copied here: served 0.5.23 could not create a
# single agent, and the refusal blamed the supervisor, which had shipped
# (#731). bundle.contents.test.js now fails the moment the engine resolves a
# bin/ file this list does not carry.
cp "$REPO/bin/codex-report-bridge.js" "$STAGE/app/bin/"
chmod +x "$STAGE/app/bin/codex-report-bridge.js"
# The app icon artwork, when it exists: the installer looks for
# app/assets/Kosmos.icns is the ONE asset that ships, named explicitly
# per this file's own explicit-list rule: a wildcard copy of assets/
# would silently ship the next stray master/mock dropped in that folder
# to every user. Build-time sources (the 1024 masters) stay repo-only.
if [ -f "$REPO/assets/Kosmos.icns" ]; then
  mkdir -p "$STAGE/app/assets"
  cp "$REPO/assets/Kosmos.icns" "$STAGE/app/assets/Kosmos.icns"
fi

# ---- the command ------------------------------------------------------------
# ⚠️ A relocation (install/kosmos -> bin/kosmos): tools/lib/release-freeze.sh
# names it too (release_bundle_source_path), so the served bundle's command can
# be compared against the tree it came from.
cp "$REPO/install/kosmos" "$STAGE/bin/kosmos"
# The reporting hook script (#561) rides in app/bin so an UPDATE (which swaps
# app/, never bin/) carries fixes to it, while the path settings.json points
# at -- $KOSMOS_HOME/app/bin/kosmos-report-hook.sh -- stays constant. Its CLI
# is resolved from its own location, so the pair can never version-skew.
# ⚠️ A relocation: tools/lib/release-freeze.sh names it too (release_bundle_source_path),
# so the served bundle can be compared file for file against the tree it came from.
cp "$REPO/install/kosmos-report-hook.sh" "$STAGE/app/bin/kosmos-report-hook.sh"
chmod +x "$STAGE/app/bin/kosmos-report-hook.sh"
chmod +x "$STAGE/bin/kosmos"
# ---- the Plus connector (#583) ---------------------------------------------
# The tunnel binary engine/remote.js SPAWNS for every Plus verb (setup, the
# running tunnel, the Allow verbs). It rides in app/bin, versioned WITH the
# app, for the report-hook's reason: remote.js drives specific verbs of it, so
# the two must never version-skew, and an UPDATE swaps app/ as one unit.
#
# ⚠️ NOT BUILT HERE AND NOT IN THIS REPO. It is a universal (x86_64 + arm64)
# Mach-O built by kosmos-relay's tools/build-tunnel-release.sh (a different
# repo). This step takes it as an INPUT, the same way the Node runtime is a
# downloaded input rather than a tree file. Provide it at KOSMOS_TUNNEL_BIN;
# the default is kosmos-relay's release output beside this checkout.
# Its .commit and .sha256 sidecars must sit beside it (the relay's build writes
# them); a copied binary needs its sidecars copied too (#621).
#
# ⚠️ THE INPUT IS UNSIGNED (kosmos-relay builds it, does not sign it). This
# step signs it Developer ID below, in the build that produces the final bytes,
# so the checksum captured after signing IS what ships and nothing signs after.
# Why Developer ID and not ad-hoc even though the tunnel is spawned, not
# launched: a nested ad-hoc binary makes the whole bundle's notarisation
# Invalid, so every binary in the bundle is Developer ID from the start.
TUNNEL_BIN="${KOSMOS_TUNNEL_BIN:-$HOME/work/kosmos-relay/dist/kosmos-tunnel}"
[ -f "$TUNNEL_BIN" ] || { echo "the Plus connector is missing: no kosmos-tunnel at $TUNNEL_BIN (build it with kosmos-relay tools/build-tunnel-release.sh, or set KOSMOS_TUNNEL_BIN)" >&2; exit 1; }
# Refuse anything but a universal Mach-O carrying BOTH arches: a per-arch or
# wrong file would install and then fail Plus on the other arch, silently.
# Require BOTH arches by NAME, and reject arm64e-standing-in-for-arm64: `lipo
# -archs` prints the slice arch names space-separated ("x86_64 arm64"), so match
# space-padded tokens exactly rather than as substrings ("arm64" is a substring
# of "arm64e", which stock arm64 Macs cannot run). A non-Mach-O input makes lipo
# fail with empty output, which falls to the refuse branch.
_tunnel_arches="$(lipo -archs "$TUNNEL_BIN" 2>/dev/null || echo '')"
case " $_tunnel_arches " in
  *" x86_64 "*) case " $_tunnel_arches " in *" arm64 "*) : ;; *) echo "the Plus connector at $TUNNEL_BIN lacks a plain arm64 slice (lipo: $_tunnel_arches)" >&2; exit 1 ;; esac ;;
  *) echo "the Plus connector at $TUNNEL_BIN is not a universal x86_64+arm64 Mach-O (lipo: ${_tunnel_arches:-not a Mach-O})" >&2; exit 1 ;;
esac
# 🛑 PROVENANCE FROM THE BINARY'S OWN SIDECARS, before a byte is staged (#621):
# the commit it was compiled from and the sha256 it was written with, both
# written by kosmos-relay's build beside it. Refused when missing, mismatched
# (a stale or half-copied pair), dirty, or malformed. `git describe` in the
# checkout used to stand in for this and could name a commit the bytes were
# not built from.
. "$REPO/tools/lib/connector-provenance.sh"
# One check, read directly (not through $( ), which would run it in a subshell
# and lose the values): two separate reads could straddle a relay rebuild and
# log the old commit beside the new bytes, the very shape #621 closes.
_connector_provenance_check "$TUNNEL_BIN" || exit 1
_tunnel_src="$CONNECTOR_COMMIT"; _tunnel_in="$CONNECTOR_SHA"
cp "$TUNNEL_BIN" "$STAGE/app/bin/kosmos-tunnel"
chmod +x "$STAGE/app/bin/kosmos-tunnel"
# The bytes STAGED are the bytes the sidecar vouched for: a relay rebuild landing
# between the check and the copy (rebuilt minutes before a cut is the shape
# #621 is about) would otherwise ship bytes the check never saw.
_tunnel_staged="$(shasum -a 256 "$STAGE/app/bin/kosmos-tunnel" | awk '{print $1}')"
[ "$_tunnel_staged" = "$_tunnel_in" ] || { echo "the connector changed under its sidecars between the provenance check and the copy (sidecar $_tunnel_in, staged $_tunnel_staged); re-run the build" >&2; exit 1; }
# ⚠️ SIGNED HERE, Developer ID, in the build that produces the final bytes, so
# the checksum captured below IS what ships and nothing signs after (#583,
# Splinter's Apple-lane ruling). The tunnel is spawned not launched, but a
# nested ad-hoc binary makes the whole bundle's notarisation Invalid (measured
# on the tmux case), so the connector is Developer ID from the start.
# FAIL LOUD if the identity is absent: a release binds to a machine holding the
# cert, and a silent ad-hoc fallback would build fine and fail notarisation
# later -- the same defect one layer down.
_codesign_id="${KOSMOS_CODESIGN_ID:-Developer ID Application: Stone Syndicate LLC (864QZ69GF2)}"
codesign --force --options runtime --timestamp -s "$_codesign_id" "$STAGE/app/bin/kosmos-tunnel" 2>&1 | sed 's/^/    /' || {
  printf '%s\n' "could not Developer ID sign the Plus connector as \"$_codesign_id\" (is this the machine holding the cert? set KOSMOS_CODESIGN_ID to override). NOT falling back to ad-hoc." >&2; exit 1; }
codesign -v "$STAGE/app/bin/kosmos-tunnel" 2>&1 | sed 's/^/    /' || { echo "the connector's signature did not verify after signing" >&2; exit 1; }
# ⚠️ RUN IT, not just verify the signature. Under hardened runtime a binary can
# sign clean and still fail to LOAD if a linked library is unsigned. otool -L
# shows the tunnel links only /usr/lib/libiconv and /usr/lib/libSystem (both
# always-valid system libs, no bundled dylibs), so one codesign of the
# executable is sufficient and no inside-out dylib pass is needed -- but this
# runs it to prove the signed binary loads and executes on THIS build machine's
# native slice: under hardened runtime the load-time signature check of the
# linked libraries happens at exec, so any invocation that starts the process
# proves the load. The x86_64 slice's own load is covered when an Intel install
# runs it, not provable here on Apple silicon without emulation.
"$STAGE/app/bin/kosmos-tunnel" --help >/dev/null 2>&1 || { echo "the signed connector does not run (--help failed); it may not load under hardened runtime" >&2; exit 1; }
# Provenance, logged not baked. Two checksums on purpose: the INPUT sha is the
# one the relay build wrote beside the binary (what its sidecar names), the
# SIGNED sha is the staged copy after Developer ID signing, which is what ships
# and what the release's 9b compares the served bytes against. They never
# match each other; a reader comparing the signed one with the sidecar would
# read a fresh connector as stale. The commit is the sidecar's (#621), so it is
# the bytes' own and cannot name a checkout state the binary was not built from.
_tunnel_sha="$(shasum -a 256 "$STAGE/app/bin/kosmos-tunnel" | awk '{print $1}')"
echo "==> Plus connector: kosmos-tunnel signed $_tunnel_sha, input $_tunnel_in (its .sha256), built from kosmos-relay commit $_tunnel_src (per its sidecars beside $TUNNEL_BIN)"

# ---- the native app binary (#677) -------------------------------------------
# Replaces the old bash-heredoc launcher install/setup.sh wrote into
# Contents/MacOS/Kosmos. Unlike kosmos-tunnel this is NOT a separate-repo
# input -- native-app/main.swift lives in this checkout, compiled fresh in
# THIS build, not carried in as bytes. That makes this script's dirty-tree
# refusal (below, near the version stamp) load-bearing for the app binary's
# provenance, not just hygiene: it is the only thing standing in for the
# tunnel's commit/sha256 sidecars, which exist only because the tunnel
# crosses a repo boundary and this does not. Do not remove that guard as a
# nuisance without knowing this leans on it.
#
# Arm64-only, matching the bundle's own LSArchitecturePriority arm64 /
# LSRequiresNativeExecution (install/setup.sh's Info.plist). Unlike the
# tunnel, which is spawned by whatever Mac is running Kosmos and so must run
# on both architectures, this binary IS the app itself, and this repo does
# not build or test on Intel.
echo "==> compiling the native app (native-app/main.swift)"
[ "$ARCH" = "arm64" ] || { echo "the native app is compiled arm64-only; this build machine is $ARCH (an Intel build is not part of this bundle's support)" >&2; exit 1; }
# Built TO THE FLOOR, not to this machine (#927): with no -target, swiftc
# stamps the build Mac's own OS as the binary's minimum (measured: minos 26.0
# from this Mac, on a bundle whose installer promises 13.5), and the selftest
# below cannot see it, because a selftest on a macOS 26 host can never detect
# a macOS 26 floor. The same number the installer promises, read from the
# same file, and the tree gate further down reads it back out of the artifact.
swiftc -target "arm64-apple-macos$(cat "$REPO/tools/macos-floor")" -O "$REPO/native-app/main.swift" -o "$STAGE/app/bin/kosmos-app" 2>&1 | sed 's/^/    /'
[ -x "$STAGE/app/bin/kosmos-app" ] || { echo "the native app failed to compile" >&2; exit 1; }
# Signed here, Developer ID, same reasoning and the same cert as the
# connector above (a nested ad-hoc binary makes the whole bundle's
# notarisation Invalid) -- the checksum captured below is what ships.
codesign --force --options runtime --timestamp -s "$_codesign_id" "$STAGE/app/bin/kosmos-app" 2>&1 | sed 's/^/    /' || {
  printf '%s\n' "could not Developer ID sign the native app as \"$_codesign_id\" (is this the machine holding the cert? set KOSMOS_CODESIGN_ID to override). NOT falling back to ad-hoc." >&2; exit 1; }
codesign -v "$STAGE/app/bin/kosmos-app" 2>&1 | sed 's/^/    /' || { echo "the native app's signature did not verify after signing" >&2; exit 1; }
# Run it, not just verify the signature -- the same "prove it loads under
# hardened runtime on this build machine" step as the tunnel's --help check.
# --kosmos-app-selftest exits before touching NSApplication/app.run(), so it
# proves the signed binary loads and executes without needing a window
# server, which a build machine may not have.
"$STAGE/app/bin/kosmos-app" --kosmos-app-selftest >/dev/null 2>&1 || { echo "the signed native app does not run (--kosmos-app-selftest failed); it may not load under hardened runtime" >&2; exit 1; }
# The Reload state machine (#965), diffed against its expected eight-row
# table -- the hatch exists so this decision logic is machine-checked at
# build time instead of only by a headed walk. A drift here is a real
# behavior change in Cmd-R, so the build refuses it.
_reload_table_expected='startInFlight=false committed=false lastLoadFailed=false -> startBoard
startInFlight=false committed=false lastLoadFailed=true -> startBoard
startInFlight=false committed=true lastLoadFailed=false -> reload
startInFlight=false committed=true lastLoadFailed=true -> startBoard
startInFlight=true committed=false lastLoadFailed=false -> ignore
startInFlight=true committed=false lastLoadFailed=true -> ignore
startInFlight=true committed=true lastLoadFailed=false -> ignore
startInFlight=true committed=true lastLoadFailed=true -> ignore'
# stdout only: folding stderr in would let incidental runtime noise from a
# clean-exiting binary masquerade as a drifted table.
_reload_table_actual="$("$STAGE/app/bin/kosmos-app" --kosmos-app-reload-decision-selftest 2>/dev/null)" || { echo "the native app's --kosmos-app-reload-decision-selftest failed to run" >&2; exit 1; }
[ "$_reload_table_actual" = "$_reload_table_expected" ] || { printf '%s\n' "the native app's Reload decision table drifted from the expected eight rows (#965):" "$_reload_table_actual" >&2; exit 1; }
_app_bin_sha="$(shasum -a 256 "$STAGE/app/bin/kosmos-app" | awk '{print $1}')"
echo "==> native app: kosmos-app signed $_app_bin_sha"

# ---- the runtime ------------------------------------------------------------
node_arch() {
  case "$ARCH" in
    arm64) echo arm64 ;;
    x86_64) echo x64 ;;
    *) echo "error: unsupported arch $ARCH" >&2; exit 1 ;;
  esac
}

if [ -n "${NODE_SOURCE:-}" ]; then
  echo "==> using local node: $NODE_SOURCE (TEST BUILD, not for release)"
  NODE_SHA="local:$(shasum -a 256 "$NODE_SOURCE" | awk '{print $1}')"
  [ -x "$NODE_SOURCE" ] || { echo "error: $NODE_SOURCE is not executable" >&2; exit 1; }
  cp "$NODE_SOURCE" "$STAGE/runtime/bin/node"
else
  NARCH="$(node_arch)"
  TARBALL="node-v$NODE_VERSION-darwin-$NARCH.tar.gz"
  BASE="https://nodejs.org/dist/v$NODE_VERSION"
  TMP="$(mktemp -d)"
  echo "==> downloading node v$NODE_VERSION ($NARCH) from nodejs.org"
  curl -fL --progress-bar "$BASE/$TARBALL" -o "$TMP/$TARBALL"
  curl -fsSL "$BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  echo "==> verifying checksum"
  WANT="$(grep " $TARBALL\$" "$TMP/SHASUMS256.txt" | awk '{print $1}')"
  [ -n "$WANT" ] || { echo "error: $TARBALL not in SHASUMS256.txt" >&2; exit 1; }
  GOT="$(shasum -a 256 "$TMP/$TARBALL" | awk '{print $1}')"
  if [ "$WANT" != "$GOT" ]; then
    echo "FAIL: checksum mismatch on $TARBALL" >&2
    echo "  want $WANT" >&2
    echo "  got  $GOT" >&2
    exit 1
  fi
  echo "    checksum ok"
  NODE_SHA="$GOT"   # the bytes that were actually downloaded, for the manifest (#776)
  tar -xzf "$TMP/$TARBALL" -C "$TMP"
  cp "$TMP/node-v$NODE_VERSION-darwin-$NARCH/bin/node" "$STAGE/runtime/bin/node"
  # ⚠️ Node's LICENSE travels with the binary. It is the single file that
  # carries the notices for Node AND everything Node bundles (OpenSSL, ICU,
  # V8, zlib, ...), all of which require their notices to accompany binary
  # redistribution. The tmux bundle refuses to pack without its notices;
  # the same rule holds here.
  cp "$TMP/node-v$NODE_VERSION-darwin-$NARCH/LICENSE" "$STAGE/runtime/LICENSE"
fi
if [ ! -f "$STAGE/runtime/LICENSE" ]; then
  # ⚠️ Its own flag, not KOSMOS_ALLOW_MINOS: one flag meaning both "I accept
  # a wrong floor" and "I accept a missing licence" does not stay legible,
  # and someone overriding the floor for its documented dev-machine reason
  # must not silently disable the licence check too.
  if [ -n "${KOSMOS_ALLOW_NO_LICENSE:-}" ]; then
    echo "TEST BUILD: runtime licence file not available from NODE_SOURCE" > "$STAGE/runtime/LICENSE"
    echo "    WARN: no runtime LICENSE (allowed: KOSMOS_ALLOW_NO_LICENSE test build)"
  else
    echo "FAIL: no LICENSE for the bundled runtime; binaries may not ship without their notices." >&2
    echo "      (NODE_SOURCE test builds may set KOSMOS_ALLOW_NO_LICENSE=1.)" >&2
    exit 1
  fi
fi
chmod +x "$STAGE/runtime/bin/node"

# ⚠️ VERIFY THE RUNTIME RUNS HERE, the same lesson as the tmux bundle: an
# arm64 binary with a broken signature does not run at all, and finding that
# out on a stranger's Mac is the expensive place to find it.
"$STAGE/runtime/bin/node" --version >/dev/null || {
  echo "FAIL: the staged node does not run" >&2; exit 1; }

# ⚠️ THE DEPLOYMENT FLOOR IS GATED AT BUILD TIME. The installer refuses
# machines below macOS 13.5 in a sentence; that number is only honest if no
# shipped binary demands MORE. A binary copied off a new build machine
# quietly inherits that machine's OS as its minimum (measured: a Homebrew
# tmux from this Mac stamps minos 26.0 and would load on nothing older),
# so the floor is read out of the artifact with otool and compared, not
# assumed. KOSMOS_ALLOW_MINOS=1 overrides for LOCAL TEST BUILDS ONLY.
# EVERY Mach-O in the stage, discovered by walking it (#927): this line once
# named runtime/bin/node alone, and kosmos-app shipped at minos 26.0 for
# eighteen releases while the gate stood here, pointed at one file.
. "$(dirname "${BASH_SOURCE[0]}")/lib/floor-gate.sh"
floor_gate_tree "$STAGE"

# ---- smoke test -------------------------------------------------------------
# ⚠️ THE STAGED TREE IS WHAT GETS TESTED, not the repo, AND A REAL REQUEST IS
# MADE. "The process stayed alive" cannot catch the ship list missing a file
# the server reads per request (web/index.html is read on every GET), so a
# bundle with no UI at all would boot, idle, and ship. PORT=0 still asks the
# OS for a free port -- the server prints the port it actually bound, and
# that line is parsed rather than guessed, so this never collides with a
# real board on this machine.
echo "==> smoke test: the staged app boots and serves its page"
SMOKE_LOG="$(mktemp)"
# ⚠️ Disposable roots for EVERY root the app has, and an inert tmux: without
# these the staged server points at the BUILD MACHINE'S live store, projects
# folder, workers folder, launchd directory, tmux fleet, claude config and
# config-root scan. And the boot WRITES: a start with this environment puts
# the agent supervisor and the codex bridge into the data root (measured),
# so the roots are not a courtesy, they are what keeps a build off the
# operator's real data.
# 🛑 THE APP ENFORCES THIS NOW (#634, engine/sandbox.js): a board with some
# roots sandboxed and others live refuses to start. This smoke test set
# three of the four directories and no tmux stub, so the build failed at
# its own smoke test the evening #634 merged, with the release's step 4
# behind it (2026-08-24). tools/test-build-smoke-sandbox.sh runs the gate's
# own audit over the environment below, so the two cannot drift again; if
# the app grows a root, the gate names it and that test goes red here.
SMOKE_ROOTS="$(mktemp -d)"
PORT=0 AGENT_WORKFORCE_DATA="$SMOKE_ROOTS/data" \
  AGENT_WORKFORCE_PROJECTS="$SMOKE_ROOTS/projects" \
  AGENT_WORKFORCE_LAUNCH="$SMOKE_ROOTS/launch" \
  AGENT_WORKFORCE_WORKERS="$SMOKE_ROOTS/workers" \
  AGENT_WORKFORCE_CONFIG_ROOT="$SMOKE_ROOTS/config" \
  AGENT_WORKFORCE_CLAUDE_CONFIG="$SMOKE_ROOTS/claude.json" \
  AGENT_WORKFORCE_DRY_RUN=1 \
  "$STAGE/runtime/bin/node" "$STAGE/app/server.js" > "$SMOKE_LOG" 2>&1 &
SMOKE_PID=$!
SMOKE_URL=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  SMOKE_URL="$(sed -n 's/.*\(http:\/\/127\.0\.0\.1:[0-9]*\).*/\1/p' "$SMOKE_LOG" | head -1)"
  [ -n "$SMOKE_URL" ] && break
  kill -0 "$SMOKE_PID" 2>/dev/null || break
  sleep 0.5
done
smoke_fail() {
  echo "FAIL: $1" >&2
  sed 's/^/    /' "$SMOKE_LOG" >&2
  kill "$SMOKE_PID" 2>/dev/null || true
  rm -f "$SMOKE_LOG"
  rm -rf "$SMOKE_ROOTS"
  exit 1
}
[ -n "$SMOKE_URL" ] || smoke_fail "the staged app never announced a port. It said:"
PAGE="$(curl -fsS -m 5 "$SMOKE_URL/" 2>/dev/null)" || smoke_fail "the staged app did not answer at $SMOKE_URL. It said:"
# ⚠️ A case STATEMENT, NOT `printf | grep -q`, AND THIS WAS MEASURED HERE:
# under pipefail, grep -q exits on its early match, printf takes SIGPIPE
# writing the rest of a 250KB page, and the PIPELINE reports failure on a
# page that matched. The first run of this smoke test failed its own
# healthy bundle exactly that way. No pipe, no signal, no lie.
case "$PAGE" in
  *"Agent Workforce"*|*Kosmos*) ;;
  *) smoke_fail "the staged app answered with something that is not its own page:" ;;
esac
# `|| true` on the kill as well: a smoke server that answered and then
# exited on its own makes a bare kill fail, and under set -e that aborted
# the build AFTER the smoke test had passed.
kill "$SMOKE_PID" 2>/dev/null || true
wait "$SMOKE_PID" 2>/dev/null || true
echo "    boots, answers at $SMOKE_URL, and serves its own page"
rm -f "$SMOKE_LOG"
rm -rf "$SMOKE_ROOTS"

# ---- the tarball ------------------------------------------------------------
# What shipped, recorded, same argument as the tmux bundle and stronger
# here: this is the half that pins the exact build (package.json is bumped
# per release since 0.1.1, but the commit is what a user report must be
# traceable to, and the stamp carries both).
# 🛑 A -dirty STAMP DOES NOT SHIP (#776 instance 1). "e2d563c-dirty" admits that
# what shipped was a commit plus an unrecorded delta nobody can reconstruct.
# The release freezes to a sha, so this never fires on the frozen path; it is
# the guard for every OTHER path (a hand build, a test build promoted by
# mistake). KOSMOS_ALLOW_DIRTY=1 is for local test builds only.
_app_commit="$(cd "$REPO" && git rev-parse HEAD 2>/dev/null || echo unknown)"
_app_dirty=no
(cd "$REPO" && git diff --quiet HEAD -- . 2>/dev/null) || _app_dirty=yes
if [ "$_app_dirty" = yes ] && [ "${KOSMOS_ALLOW_DIRTY:-0}" != 1 ]; then
  echo "refusing to package a -dirty tree: its bytes would come from no commit anyone can name (git status is not clean). Commit, or KOSMOS_ALLOW_DIRTY=1 for a local test build." >&2
  exit 1
fi
{
  echo "app:    $(cd "$REPO" && git describe --always --dirty 2>/dev/null || echo unknown) (package.json $(KOSMOS_PKG="$STAGE/app/package.json" "$STAGE/runtime/bin/node" -p 'JSON.parse(require("fs").readFileSync(process.env.KOSMOS_PKG,"utf8")).version' 2>/dev/null || echo '?'))"
  echo "node:   $("$STAGE/runtime/bin/node" --version)"
  echo "built:  $(date -u +%Y-%m-%dT%H:%M:%SZ) on macOS $(sw_vers -productVersion 2>/dev/null || echo '?')"
} > "$STAGE/VERSION"

echo "==> packing"
TARBALL_OUT="$OUT/kosmos-$ARCH.tar.gz"
rm -f "$TARBALL_OUT"
tar -czf "$TARBALL_OUT" -C "$STAGE" bin app runtime VERSION
# ⚠️ The .sha256 is what install/setup.sh verifies before extracting; a
# tarball published without it refuses to install, on purpose.
( cd "$OUT" && shasum -a 256 "$(basename "$TARBALL_OUT")" > "$(basename "$TARBALL_OUT").sha256" )
# ---- the release manifest (#776) -------------------------------------------
# Accountability, not reproducibility: codesign embeds a timestamp and binds
# to this machine, tar and gzip embed mtimes, so these bytes cannot be rebuilt
# byte for byte and nobody should try. What CAN be answered, cheaply, is
# "given these served bytes, what produced them": the artifact's sha, the app
# commit and whether the tree was clean, the Node version and the sha of the
# runtime actually downloaded, the connector's signed and input shas and its
# commit (its own sidecars, #621), every file in the tree with its sha, and
# when and where. A few KB, committed beside the pointer by the release, so a
# person who was not there can audit any release from the site repo alone
# (tools/verify-manifest.sh). Everything here the build already knew.
MANIFEST_OUT="$OUT/kosmos-$ARCH.manifest.json"
_pkg_version="$(KOSMOS_PKG="$STAGE/app/package.json" "$STAGE/runtime/bin/node" -p 'JSON.parse(require("fs").readFileSync(process.env.KOSMOS_PKG,"utf8")).version')"
( cd "$STAGE" && find bin app runtime VERSION -type f | LC_ALL=C sort | while read -r f; do printf '%s  %s\n' "$(shasum -a 256 "$f" | awk '{print $1}')" "$f"; done ) > "$OUT/.files.$$"
KOSMOS_MANIFEST_OUT="$MANIFEST_OUT" KOSMOS_MANIFEST_FILES="$OUT/.files.$$" \
KM_VERSION="$_pkg_version" KM_ARCH="$ARCH" KM_ARTIFACT="$(basename "$TARBALL_OUT")" \
KM_SHA="$(awk '{print $1}' "$TARBALL_OUT.sha256")" \
KM_APP_COMMIT="$_app_commit" KM_APP_DIRTY="$_app_dirty" \
KM_NODE_VERSION="$("$STAGE/runtime/bin/node" --version)" KM_NODE_SHA="${NODE_SHA:-unknown}" \
KM_TUNNEL_SIGNED="${_tunnel_sha:-unknown}" KM_TUNNEL_INPUT="${_tunnel_in:-unknown}" KM_TUNNEL_COMMIT="${_tunnel_src:-unknown}" \
KM_NATIVE_APP_SIGNED="${_app_bin_sha:-unknown}" \
KM_BUILT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" KM_HOST="$(hostname -s 2>/dev/null || echo '?')" KM_MACOS="$(sw_vers -productVersion 2>/dev/null || echo '?')" \
"$STAGE/runtime/bin/node" -e '
const fs = require("fs"); const e = process.env;
const files = fs.readFileSync(e.KOSMOS_MANIFEST_FILES, "utf8").trim().split("\n").filter(Boolean)
  .map((l) => { const [sha, ...p] = l.split(/\s+/); return { path: p.join(" "), sha256: sha }; });
const m = {
  manifest: 1,
  version: e.KM_VERSION, arch: e.KM_ARCH, artifact: e.KM_ARTIFACT, sha256: e.KM_SHA,
  app: { commit: e.KM_APP_COMMIT, dirty: e.KM_APP_DIRTY === "yes" },
  node: { version: e.KM_NODE_VERSION, download_sha256: e.KM_NODE_SHA },
  connector: { signed_sha256: e.KM_TUNNEL_SIGNED, input_sha256: e.KM_TUNNEL_INPUT, commit: e.KM_TUNNEL_COMMIT },
  native_app: { signed_sha256: e.KM_NATIVE_APP_SIGNED },
  built: { at: e.KM_BUILT, host: e.KM_HOST, macos: e.KM_MACOS },
  files,
};
fs.writeFileSync(e.KOSMOS_MANIFEST_OUT, JSON.stringify(m, null, 1) + "\n");
'
rm -f "$OUT/.files.$$"
echo "==> manifest: $MANIFEST_OUT ($(wc -c < "$MANIFEST_OUT" | tr -d ' ') bytes, $(grep -c '"path"' "$MANIFEST_OUT") files)"
echo "==> ok: $(du -sh "$TARBALL_OUT" | cut -f1) at $TARBALL_OUT (+ .sha256, + manifest)"
echo "    contains: $(tar -tzf "$TARBALL_OUT" | wc -l | tr -d ' ') files"

# ---- the installer travels WITH the release ---------------------------------
# ⚠️ Card #54, and 2026-08-17 is the incident it closes: install/setup.sh
# was reviewed and correct while the SITE served a 1569-line stale copy
# for 51 minutes -- review was spent on the right file and a different
# file shipped. The build now emits the installer beside the tarball, so
# the site release step copies dist/* and cannot cut a release that
# leaves /setup behind. The version number is the forcing function: a
# bundle at N with an installer from N-1 cannot happen when both ride
# one dist/ from one build.
cp "$REPO/install/setup.sh" "$OUT/setup"
( cd "$OUT" && shasum -a 256 setup > setup.sha256 )
echo "==> installer emitted at $OUT/setup (+ .sha256), byte-for-byte install/setup.sh"
