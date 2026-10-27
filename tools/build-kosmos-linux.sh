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
TMP=""; SMOKE_LOG=""; SMOKE_ROOTS=""; SMOKE_PID=""
_cleanup() {
  [ -z "${SMOKE_PID:-}" ] || kill "$SMOKE_PID" 2>/dev/null || true
  rm -rf "${TMP:-}" "${SMOKE_LOG:-}" "${SMOKE_ROOTS:-}" 2>/dev/null || true
}
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
# Review 1 (N1): an executable, not any ELF (a relocatable .o or a core file is ELF x86-64 too).
case "$_tunnel_kind" in
  *ELF\ 64-bit\ LSB*executable,\ x86-64*) ;;
  *) echo "the Linux connector must be an ELF 64-bit x86-64 executable; $TUNNEL_IN is: $_tunnel_kind" >&2; exit 1 ;;
esac
# Review 2 (W1): for Linux, and for the loader a stock Ubuntu has. An ELF for another system (FreeBSD) is refused; a
# binary that names a loader must name glibc's (a musl loader is absent from Ubuntu), and only then does the glibc
# floor below apply; one that names none is static and needs no glibc.
case "$_tunnel_kind" in
  *"(SYSV)"*|*"(GNU/Linux)"*) ;;
  *) echo "the Linux connector is not built for Linux: $_tunnel_kind" >&2; exit 1 ;;
esac
_tunnel_dynamic=no
case "$_tunnel_kind" in
  *"interpreter /lib64/ld-linux-x86-64.so.2"*) _tunnel_dynamic=yes ;;
  *interpreter\ *) echo "the Linux connector needs a loader a stock Ubuntu does not have (only glibc's /lib64/ld-linux-x86-64.so.2 is there): $_tunnel_kind" >&2; exit 1 ;;
  *"dynamically linked"*) echo "the Linux connector is dynamically linked but names no loader: $_tunnel_kind" >&2; exit 1 ;;
esac
# Review 1 (B2): the provenance the Mac and Windows builders require, by the same shared check: a .sha256 sidecar
# that matches these bytes and a 40-hex, never -dirty, kosmos-relay commit (tools/lib/connector-provenance.sh).
. "$REPO/tools/lib/connector-provenance.sh"
_connector_provenance_check "$TUNNEL_IN" || exit 1
_tunnel_src="$CONNECTOR_COMMIT"; _tunnel_in="$CONNECTOR_SHA"
# Review 1 (W3): a glibc-linked connector runs only where glibc is at least the newest symbol version it needs. The
# floor is the oldest glibc a Kosmos Linux install supports (kosmos-relay builds it on Ubuntu 22.04: 2.35; cloud
# machines are 24.04). A static connector needs none and passes.
GLIBC_FLOOR="${KOSMOS_LINUX_GLIBC_FLOOR:-2.35}"
# Review 2 (W5): a different floor is a TEST build only (the gate a dirty tree and an unchecked node have), and the
# floor used is recorded in the manifest beside what the connector needs.
[ "$GLIBC_FLOOR" = 2.35 ] || [ "${KOSMOS_ALLOW_DIRTY:-0}" = 1 ] || {
  echo "KOSMOS_LINUX_GLIBC_FLOOR=$GLIBC_FLOOR is for a test build only (KOSMOS_ALLOW_DIRTY=1); a release keeps 2.35" >&2; exit 1; }
# Review 2 (W2): read the file itself (grep -a), never `strings`, whose absence would read as a static binary.
glibc_needed() {   # <file>: the newest GLIBC_x.y[.z] it names, or nothing
  LC_ALL=C grep -aoE 'GLIBC_[0-9]+\.[0-9]+(\.[0-9]+)?' "$1" | sed 's/^GLIBC_//' \
    | LC_ALL=C sort -t. -k1,1n -k2,2n -k3,3n | tail -1 || true
}
_tunnel_glibc=""
[ "$_tunnel_dynamic" = yes ] && _tunnel_glibc="$(glibc_needed "$TUNNEL_IN")"
if [ -n "$_tunnel_glibc" ]; then
  _newest="$(printf '%s\n%s\n' "$_tunnel_glibc" "$GLIBC_FLOOR" | LC_ALL=C sort -t. -k1,1n -k2,2n -k3,3n | tail -1)"
  [ "$_newest" = "$GLIBC_FLOOR" ] || [ "$_tunnel_glibc" = "$GLIBC_FLOOR" ] || {
    echo "the Linux connector needs glibc $_tunnel_glibc, newer than the supported floor $GLIBC_FLOOR: it would not start on an older supported Linux" >&2; exit 1; }
fi

# Review 2 (W3): the shared home-path gate looks at Mach-O files and /Users only, and this connector is ELF built on
# Linux. So the #6549 check is made here, for the Linux connector: no build machine's cargo or rustup home in it.
if LC_ALL=C grep -aqE '/(home/[^/[:cntrl:]]+|root)/(\.cargo|\.rustup)/' "$TUNNEL_IN"; then
  echo "the Linux connector names a build machine's cargo or rustup home (#6549): rebuild it with --remap-path-prefix" >&2; exit 1
fi

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
[ "$_tunnel_sha" = "$_tunnel_in" ] || { echo "the staged connector is not the bytes its sidecar named" >&2; exit 1; }
echo "==> Plus connector: kosmos-tunnel (linux x86-64) $_tunnel_sha, built from kosmos-relay $_tunnel_src"

# ---- the runtime: nodejs.org's linux-x64 node, checksum-checked ------------------
NODE_TARBALL="node-v$NODE_VERSION-linux-$NARCH.tar.gz"
TMP="$(mktemp -d)"
NODE_BASE="https://nodejs.org/dist/v$NODE_VERSION"
if [ "${KOSMOS_NODE_UNCHECKED:-0}" = 1 ] && [ -n "${NODE_LINUX_SOURCE:-}" ]; then
  # Review 1 (W1): a TEST build only, behind the same gate as a dirty tree, and named so in the manifest and VERSION.
  [ "${KOSMOS_ALLOW_DIRTY:-0}" = 1 ] || { echo "an unchecked node is for a test build only (KOSMOS_ALLOW_DIRTY=1)" >&2; exit 1; }
  echo "==> using local node $NODE_LINUX_SOURCE UNCHECKED (TEST BUILD, not for release)"
  cp "$NODE_LINUX_SOURCE" "$TMP/$NODE_TARBALL"
  WANT="unchecked:$(sha256 "$TMP/$NODE_TARBALL")"
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

# ---- release gates the Mac build runs, all platform-neutral (review 1, W2) ------------
# #6549: nothing under app/ or bin/ may name a build machine's home folder (a connector built in someone's home
# folder carries it, hundreds of times).
. "$REPO/tools/lib/home-path-gate.sh"
home_path_gate_tree "$STAGE" || exit 1
# #6468: every name the signed manifest lists must be plain. KEPT EQUAL WITH THE MAC BUILDER'S FUNCTION
# (tools.build-linux-7281.test.js compares the two bodies).
kosmos_bundle_odd_names() {   # <stage>; prints offenders, one per line (a missing stage or part is one too)
  [ -d "$1" ] || { echo "no stage at $1"; return 0; }
  local part
  for part in bin app runtime VERSION; do [ -e "$1/$part" ] || echo "missing: $part"; done
  # A newline anywhere in a path splits it into lines that can each look plain, so it is found by name, not by line.
  ( cd "$1" && { find bin app runtime VERSION -name $'*\n*' -print0 2>/dev/null | tr '\n\0' ' \n' | sed 's/^/a name with a newline in it: /'
                 find bin app runtime VERSION ! -type f ! -type d 2>/dev/null | sed 's/^/not a plain file: /'
                 find bin app runtime VERSION -type f 2>/dev/null | LC_ALL=C grep -vE '^((bin|app|runtime)/[A-Za-z0-9._/@+=,~%#()-]+|VERSION)$' | sed 's/^/name the manifest cannot carry: /'; } ) || true
}

# Smoke test: the staged app boots and serves its own page. The bundled node is a Linux binary, so the build host's
# node runs the STAGED app (dependency-free JavaScript); the Linux node itself is proved by the stock-Ubuntu CI job.
# Disposable roots for every root the app has, as the Mac builder's smoke test (and engine/sandbox.js) requires.
echo "==> smoke test: the staged app boots and serves its page"
SMOKE_LOG="$(mktemp)"; SMOKE_ROOTS="$(mktemp -d)"
PORT=0 AGENT_WORKFORCE_DATA="$SMOKE_ROOTS/data" AGENT_WORKFORCE_PROJECTS="$SMOKE_ROOTS/projects" \
  AGENT_WORKFORCE_LAUNCH="$SMOKE_ROOTS/launch" AGENT_WORKFORCE_WORKERS="$SMOKE_ROOTS/workers" \
  AGENT_WORKFORCE_CONFIG_ROOT="$SMOKE_ROOTS/config" AGENT_WORKFORCE_CLAUDE_CONFIG="$SMOKE_ROOTS/claude.json" \
  AGENT_WORKFORCE_DRY_RUN=1 AGENT_WORKFORCE_TMUX_BIN="$REPO/test-support/fake-tmux.sh" \
  AGENT_WORKFORCE_CREATED_URL=http://127.0.0.1:9/api/created AGENT_WORKFORCE_FEEDBACK_URL=http://127.0.0.1:9/api/feedback \
  AGENT_WORKFORCE_COMMUNITY_URL=http://127.0.0.1:9/ AGENT_WORKFORCE_PERSON_LOCALE=en \
  node "$STAGE/app/server.js" > "$SMOKE_LOG" 2>&1 &
SMOKE_PID=$!
SMOKE_URL=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  SMOKE_URL="$(sed -n 's/.*\(http:\/\/127\.0\.0\.1:[0-9]*\).*/\1/p' "$SMOKE_LOG" | head -1)"
  [ -n "$SMOKE_URL" ] && break
  kill -0 "$SMOKE_PID" 2>/dev/null || break
  sleep 0.5
done
smoke_fail() { echo "FAIL: $1" >&2; sed 's/^/    /' "$SMOKE_LOG" >&2; kill "$SMOKE_PID" 2>/dev/null || true; rm -f "$SMOKE_LOG"; rm -rf "$SMOKE_ROOTS"; exit 1; }
[ -n "$SMOKE_URL" ] || smoke_fail "the staged app never announced a port. It said:"
PAGE="$(curl -fsS -m 5 "$SMOKE_URL/" 2>/dev/null)" || smoke_fail "the staged app did not answer at $SMOKE_URL. It said:"
case "$PAGE" in *Kosmos*) ;; *) smoke_fail "the staged app answered with something that is not its own page:" ;; esac
kill "$SMOKE_PID" 2>/dev/null || true; wait "$SMOKE_PID" 2>/dev/null || true
SMOKE_PID=""   # review 2 (N1): the trap must not kill this id again once another process may have it
rm -f "$SMOKE_LOG"; rm -rf "$SMOKE_ROOTS"
echo "    boots, answers, and serves its own page"

{
  echo "app:    $_app_commit$( [ "$_app_dirty" = yes ] && echo ' (dirty)') (package.json $_ver)"
  echo "node:   v$NODE_VERSION (linux-$NARCH)$(case "$NODE_SHA" in unchecked:*) echo ' UNCHECKED (test build)';; esac)"
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
  # Review 1 (B1): NAME:ID, so GNU tar needs no kosmos user on the build host (a bare name must exist there).
  tar -czf "$TARBALL_OUT" --owner=kosmos:0 --group=kosmos:0 --no-xattrs -C "$STAGE" bin app runtime VERSION
fi
_odd="$(kosmos_bundle_odd_names "$STAGE")"
[ -z "$_odd" ] || { echo "FAIL: the bundle holds names the signed manifest cannot list exactly (#6468):" >&2; printf '%s\n' "$_odd" | sed -n '1,5p' >&2; exit 1; }
# #6562 and #6678, the Mac builder's gates: no build machine's account recorded, no macOS metadata.
. "$REPO/tools/lib/tar-owner-gate.sh"
tar_owner_gate "$TARBALL_OUT" || exit 1
. "$REPO/tools/lib/tar-macmeta-gate.sh"
tar_macmeta_gate "$TARBALL_OUT" || exit 1
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
KM_TUNNEL_SHA="$_tunnel_sha" KM_TUNNEL_COMMIT="$_tunnel_src" KM_TUNNEL_GLIBC="${_tunnel_glibc:-}" KM_GLIBC_FLOOR="$GLIBC_FLOOR" \
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
  // signed_sha256 and input_sha256 as the Mac entry has them (tools/verify-manifest.sh reads them): the Linux
  // connector is not signed, so both are the bytes shipped. glibc: the newest the connector needs (empty when static).
  // (No apostrophes in this program: it sits inside single quotes in the shell.)
  connector: { signed_sha256: e.KM_TUNNEL_SHA, input_sha256: e.KM_TUNNEL_SHA, commit: e.KM_TUNNEL_COMMIT, glibc: e.KM_TUNNEL_GLIBC, glibc_floor: e.KM_GLIBC_FLOOR },
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
