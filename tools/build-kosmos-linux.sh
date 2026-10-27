#!/usr/bin/env bash
# Build the Linux x86_64 bundle (kosmos#7281): what a Linux computer installs, a Kosmos cloud machine above all
# (kosmos#4903). Until this, install/setup.sh installed the Mac arm64 bundle on Linux, whose node and Plus
# connector are macOS binaries: on a stock Ubuntu box with no system node, nothing ran.
#
# 🛑 ASSEMBLED, NOT COMPILED, AND ON ANY HOST. Nothing here needs Linux: the app is JavaScript, node is nodejs.org's
# own linux-x64 build (downloaded, its checksum checked against nodejs.org's SHASUMS256), and the connector is
# kosmos-relay's Linux kosmos-tunnel, an INPUT this script checks but never builds (KOSMOS_TUNNEL_LINUX_BIN). So the
# cut builds it on the cut Mac from the same frozen tree as the Mac bundle: one cut, one app commit, both families.
#
# 🛑 WHAT IS NOT IN IT, ON PURPOSE:
#   - no tmux: install/setup.sh's setup_linux_tmux uses the system tmux (stock Ubuntu images ship it) or apt.
#   - no native app, no Kosmos.app, no codesigning or notarisation: those are the Mac's.
#   - no board watchdog: that is a macOS launchd mechanism; a Linux board runs under systemd (engine/linuxboard.js).
#
# Output, beside the Mac bundle's names (tools/release.sh publishes them as kosmos-<V>-linux-x64.*):
#   <out>/kosmos-linux-x64.tar.gz (+ .sha256) and <out>/kosmos-linux-x64.manifest.json
#   The manifest is the Mac shape plus "platform": "linux"; the release signs it with the same key and the same
#   tools/lib/manifest-sign.js, as it signs the Mac and Windows ones.
#
#   KOSMOS_TUNNEL_LINUX_BIN=<kosmos-tunnel, ELF x86-64> bash tools/build-kosmos-linux.sh [outdir]
#
# Test builds: KOSMOS_ALLOW_DIRTY=1 packs an uncommitted tree; NODE_LINUX_SOURCE=<node-v*-linux-x64.tar.gz> uses a
# local node tarball (checked against SHASUMS256 all the same unless KOSMOS_NODE_UNCHECKED=1, which says so).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-dist}"
# ⚠️ ONE NODE DEFAULT, SHARED WITH THE MAC AND WINDOWS BUILDERS (tools.build-linux-7281.test.js keeps the three equal).
NODE_VERSION="${KOSMOS_NODE_VERSION:-24.19.0}"
ARCH="linux-x64"
NARCH="x64"
STAGE="$OUT/kosmos-linux-bundle"

. "$REPO/tools/lib/exit-guard.sh"
TMP=""
_cleanup() { [ -z "${TMP:-}" ] || rm -rf "$TMP"; }
kosmos_exit_guard _cleanup build-kosmos-linux

# The build host's node writes the manifest and reads the pinned keys: the bundled node is a Linux binary and does
# not run on the Mac that builds it.
command -v node >/dev/null 2>&1 || { echo "node is needed on the build host to write the manifest; put it on PATH" >&2; exit 1; }
sha256() {   # <file>: its sha256, with whichever tool this host has
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'; else sha256sum "$1" | awk '{print $1}'; fi
}

# ---- the Plus connector, checked FIRST (before any download) ----------------
# A Linux bundle without a Linux connector is the defect this script exists to end (#7281): a cloud machine cannot
# register (`kosmos-tunnel setup cloud`) or admit anyone. So it is required, and it must be ELF x86-64, never the
# Mac's Mach-O that the Mac build signs.
TUNNEL_IN="${KOSMOS_TUNNEL_LINUX_BIN:-}"
[ -n "$TUNNEL_IN" ] || { echo "KOSMOS_TUNNEL_LINUX_BIN is not set: the Linux bundle needs kosmos-relay's Linux x86_64 kosmos-tunnel" >&2; exit 1; }
[ -f "$TUNNEL_IN" ] || { echo "KOSMOS_TUNNEL_LINUX_BIN names no file: $TUNNEL_IN" >&2; exit 1; }
_tunnel_kind="$(file -b "$TUNNEL_IN" 2>/dev/null || echo unknown)"
case "$_tunnel_kind" in
  *ELF\ 64-bit*x86-64*) ;;
  *) echo "the Linux connector must be an ELF 64-bit x86-64 executable; $TUNNEL_IN is: $_tunnel_kind" >&2; exit 1 ;;
esac

# ---- the tree is a commit -----------------------------------------------------
_app_commit="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)"
_app_dirty=no
git -C "$REPO" diff --quiet HEAD -- . 2>/dev/null || _app_dirty=yes
if [ "$_app_dirty" = yes ] && [ "${KOSMOS_ALLOW_DIRTY:-0}" != 1 ]; then
  echo "refusing to package a -dirty tree: its bytes would come from no commit anyone can name. Commit, or KOSMOS_ALLOW_DIRTY=1 for a local test build" >&2
  exit 1
fi

rm -rf "$STAGE"
mkdir -p "$STAGE/bin" "$STAGE/app" "$STAGE/runtime/bin"

# ---- the app ---------------------------------------------------------------
# ⚠️ AN EXPLICIT LIST, NOT AN EXCLUDE LIST, for the Mac builder's reason, and it must not drift from the Mac list:
# tools.build-linux-7281.test.js fails when the Mac bundle stages a file this one does not, unless a reason is
# recorded there (the #731 class: a file the engine resolves, never shipped).
echo "==> staging the app"
cp "$REPO/server.js" "$REPO/package.json" "$STAGE/app/"
mkdir -p "$STAGE/app/engine" "$STAGE/app/bin"
for f in "$REPO"/engine/*.js; do
  case "$f" in *.test.js) ;; *) cp "$f" "$STAGE/app/engine/" ;; esac
done
. "$REPO/tools/lib/stage-service-keys.sh"
kosmos_stage_service_keys "$REPO" "$STAGE/app/engine" || exit 1
cp -R "$REPO/web" "$STAGE/app/web"
# The version baked into the page, as the Mac builder does (#269), and verified so the marker never ships.
_ver="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$STAGE/app/package.json" | head -1)"
[ -n "$_ver" ] || { echo "could not read the version to bake into the page" >&2; exit 1; }
sed -i.bak "s/__KOSMOS_VERSION__/$_ver/" "$STAGE/app/web/index.html" && rm -f "$STAGE/app/web/index.html.bak"
if grep -q "__KOSMOS_VERSION__" "$STAGE/app/web/index.html"; then echo "the version marker survived the bake" >&2; exit 1; fi
grep -q "content=\"$_ver\"" "$STAGE/app/web/index.html" || { echo "the version was not baked into the page" >&2; exit 1; }
cp "$REPO/bin/agent-supervisor.sh" "$STAGE/app/bin/"
cp "$REPO/bin/codex-report-bridge.js" "$STAGE/app/bin/"
cp "$REPO/bin/gemini-report-bridge.js" "$STAGE/app/bin/"
cp "$REPO/bin/grok-report-bridge.js" "$STAGE/app/bin/"
cp "$REPO/bin/agy-report-bridge.js" "$STAGE/app/bin/"
chmod +x "$STAGE/app/bin/agent-supervisor.sh" "$STAGE/app/bin/codex-report-bridge.js" "$STAGE/app/bin/gemini-report-bridge.js" \
  "$STAGE/app/bin/grok-report-bridge.js" "$STAGE/app/bin/agy-report-bridge.js"
# The command, and the Claude Code reporting hook (#561), at the paths the Mac bundle uses: setup.sh installs both
# the same way on either platform.
cp "$REPO/install/kosmos" "$STAGE/bin/kosmos"
cp "$REPO/install/kosmos-report-hook.sh" "$STAGE/app/bin/kosmos-report-hook.sh"
chmod +x "$STAGE/bin/kosmos" "$STAGE/app/bin/kosmos-report-hook.sh"

# ---- the Plus connector -------------------------------------------------------
cp "$TUNNEL_IN" "$STAGE/app/bin/kosmos-tunnel"
chmod +x "$STAGE/app/bin/kosmos-tunnel"
_tunnel_sha="$(sha256 "$STAGE/app/bin/kosmos-tunnel")"
_tunnel_src="unknown"
[ -f "$TUNNEL_IN.commit" ] && _tunnel_src="$(tr -d '[:space:]' < "$TUNNEL_IN.commit")"
echo "==> Plus connector: kosmos-tunnel (linux x86-64) $_tunnel_sha, built from kosmos-relay $_tunnel_src"

# ---- the runtime: nodejs.org's linux-x64 node, checksum-checked ------------------
NODE_TARBALL="node-v$NODE_VERSION-linux-$NARCH.tar.gz"
TMP="$(mktemp -d)"
NODE_BASE="https://nodejs.org/dist/v$NODE_VERSION"
if [ "${KOSMOS_NODE_UNCHECKED:-0}" = 1 ] && [ -n "${NODE_LINUX_SOURCE:-}" ]; then
  echo "==> using local node $NODE_LINUX_SOURCE UNCHECKED (TEST BUILD, not for release)"
  cp "$NODE_LINUX_SOURCE" "$TMP/$NODE_TARBALL"
  WANT="$(sha256 "$TMP/$NODE_TARBALL")"
else
  echo "==> fetching node v$NODE_VERSION (linux-$NARCH) checksums from nodejs.org"
  curl -fsSL "$NODE_BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  WANT="$(grep " $NODE_TARBALL\$" "$TMP/SHASUMS256.txt" | awk '{print $1}')"
  [ -n "$WANT" ] || { echo "error: $NODE_TARBALL is not in nodejs.org's SHASUMS256.txt" >&2; exit 1; }
  # The same cache as the Mac builder, never a trust shortcut: the bytes used are checked against the fresh list.
  NODE_CACHE="${KOSMOS_NODE_CACHE:-$HOME/.cache/kosmos-node-runtime}"
  if [ -n "${NODE_LINUX_SOURCE:-}" ]; then
    cp "$NODE_LINUX_SOURCE" "$TMP/$NODE_TARBALL"
  elif [ -f "$NODE_CACHE/$NODE_TARBALL" ] && [ "$(sha256 "$NODE_CACHE/$NODE_TARBALL")" = "$WANT" ] \
       && cp "$NODE_CACHE/$NODE_TARBALL" "$TMP/$NODE_TARBALL" 2>/dev/null; then
    echo "==> using cached node v$NODE_VERSION (linux-$NARCH)"
  else
    echo "==> downloading node v$NODE_VERSION (linux-$NARCH) from nodejs.org"
    curl -fL --progress-bar "$NODE_BASE/$NODE_TARBALL" -o "$TMP/$NODE_TARBALL"
    if [ "$(sha256 "$TMP/$NODE_TARBALL")" = "$WANT" ] && mkdir -p "$NODE_CACHE" 2>/dev/null; then
      { cp "$TMP/$NODE_TARBALL" "$NODE_CACHE/.$NODE_TARBALL.$$" 2>/dev/null \
          && mv "$NODE_CACHE/.$NODE_TARBALL.$$" "$NODE_CACHE/$NODE_TARBALL" 2>/dev/null; } \
        || rm -f "$NODE_CACHE/.$NODE_TARBALL.$$" 2>/dev/null || :
    fi
  fi
  GOT="$(sha256 "$TMP/$NODE_TARBALL")"
  [ "$GOT" = "$WANT" ] || { echo "FAIL: checksum mismatch on $NODE_TARBALL (want $WANT, got $GOT)" >&2; exit 1; }
  echo "    checksum ok"
fi
NODE_SHA="$WANT"
tar -xzf "$TMP/$NODE_TARBALL" -C "$TMP"
cp "$TMP/node-v$NODE_VERSION-linux-$NARCH/bin/node" "$STAGE/runtime/bin/node"
chmod +x "$STAGE/runtime/bin/node"
# Node's LICENSE travels with the binary (its notices cover OpenSSL, ICU, V8, zlib), as on the Mac.
cp "$TMP/node-v$NODE_VERSION-linux-$NARCH/LICENSE" "$STAGE/runtime/LICENSE"
case "$(file -b "$STAGE/runtime/bin/node" 2>/dev/null)" in
  *ELF\ 64-bit*x86-64*) ;;
  *) echo "the staged node is not an ELF x86-64 executable" >&2; exit 1 ;;
esac

{
  echo "app:    $_app_commit$( [ "$_app_dirty" = yes ] && echo ' (dirty)') (package.json $_ver)"
  echo "node:   v$NODE_VERSION (linux-$NARCH)"
  echo "built:  $(date -u +%Y-%m-%dT%H:%M:%SZ) for linux-$NARCH on $(uname -s)"
} > "$STAGE/VERSION"

# ---- packing ----------------------------------------------------------------
# A neutral owner name, and on a Mac none of its metadata (the Mac builder's #6562 and #6678 reasons): setup.sh
# extracts with --no-same-owner, and a GNU tar on Linux must not meet ._ files or xattr headers.
echo "==> packing"
TARBALL_OUT="$OUT/kosmos-$ARCH.tar.gz"
rm -f "$TARBALL_OUT"
if tar --version 2>/dev/null | grep -qi bsdtar; then
  COPYFILE_DISABLE=1 tar -czf "$TARBALL_OUT" --uname kosmos --gname kosmos -C "$STAGE" --no-mac-metadata --no-xattrs --no-fflags bin app runtime VERSION
else
  tar -czf "$TARBALL_OUT" --owner=kosmos --group=kosmos --no-xattrs -C "$STAGE" bin app runtime VERSION
fi
( cd "$OUT" && printf '%s  %s\n' "$(sha256 "$(basename "$TARBALL_OUT")")" "$(basename "$TARBALL_OUT")" > "$(basename "$TARBALL_OUT").sha256" )

# ---- the release manifest (#776, #6468), the Mac's shape plus platform -----------
MANIFEST_OUT="$OUT/kosmos-$ARCH.manifest.json"
_pk_file="$(cd "$STAGE/app/engine" && pwd)/manifest-verify.js"
KM_PINNED_KEYS="$(node -e 'process.stdout.write(JSON.stringify(require(process.argv[1]).KEYS))' "$_pk_file")"
case "$KM_PINNED_KEYS" in ''|'[]') echo "FAIL: could not read the pinned keys from app/engine/manifest-verify.js (#6468)" >&2; exit 1 ;; esac
( cd "$STAGE" && find bin app runtime VERSION -type f | LC_ALL=C sort | while IFS= read -r f; do printf '%s  %s\n' "$(sha256 "$f")" "$f"; done ) > "$OUT/.files.$$"
KOSMOS_MANIFEST_OUT="$MANIFEST_OUT" KOSMOS_MANIFEST_FILES="$OUT/.files.$$" \
KM_VERSION="$_ver" KM_ARCH="$NARCH" KM_ARTIFACT="$(basename "$TARBALL_OUT")" \
KM_SHA="$(awk '{print $1}' "$TARBALL_OUT.sha256")" \
KM_APP_COMMIT="$_app_commit" KM_APP_DIRTY="$_app_dirty" \
KM_NODE_VERSION="v$NODE_VERSION" KM_NODE_SHA="$NODE_SHA" \
KM_TUNNEL_SHA="$_tunnel_sha" KM_TUNNEL_COMMIT="$_tunnel_src" \
KM_PINNED_KEYS="$KM_PINNED_KEYS" \
KM_SETUP_SHA="$(sha256 "$REPO/install/setup.sh")" \
KM_BUILT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" KM_HOST="$(hostname -s 2>/dev/null || echo '?')" \
node -e '
const fs = require("fs"); const e = process.env;
const files = fs.readFileSync(e.KOSMOS_MANIFEST_FILES, "utf8").trim().split("\n").filter(Boolean)
  .map((l) => ({ path: l.slice(66), sha256: l.slice(0, 64) }));
const m = {
  manifest: 1,
  platform: "linux",
  version: e.KM_VERSION, arch: e.KM_ARCH, artifact: e.KM_ARTIFACT, sha256: e.KM_SHA,
  app: { commit: e.KM_APP_COMMIT, dirty: e.KM_APP_DIRTY === "yes" },
  node: { version: e.KM_NODE_VERSION, download_sha256: e.KM_NODE_SHA },
  connector: { sha256: e.KM_TUNNEL_SHA, commit: e.KM_TUNNEL_COMMIT },
  built: { at: e.KM_BUILT, host: e.KM_HOST },
  pinned_keys: JSON.parse(e.KM_PINNED_KEYS || "[]"),
  setup_sha256: e.KM_SETUP_SHA,
  files,
};
fs.writeFileSync(e.KOSMOS_MANIFEST_OUT, JSON.stringify(m, null, 1) + "\n");
'
rm -f "$OUT/.files.$$"
echo "==> manifest: $MANIFEST_OUT ($(grep -c '"path"' "$MANIFEST_OUT") files)"
echo "==> ok: $(du -sh "$TARBALL_OUT" | cut -f1) at $TARBALL_OUT (+ .sha256, + manifest)"
kosmos_finished
