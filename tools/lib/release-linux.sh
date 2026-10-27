#!/bin/bash
# The Linux x86_64 family in a cut (kosmos#7281 slice C1). tools/release.sh sources this and calls four functions, in
# order; tools/test-release-linux-7281.sh drives them against a fake site.
#
# 🛑 LOCKSTEP. A board and the setup.sh it spawns disagree (offer X, install Y) only when a channel's Mac pointer and
# Linux pointer name DIFFERENT versions: a board without the engine's Linux arm reads the Mac pointer, setup.sh reads
# the Linux one. So once a channel has a Linux pointer, every cut on that channel writes both at the cut's version,
# and promote-channel.sh moves both. A cut that would move only the Mac one is refused.
#
# OPT-IN UNTIL THE FIRST LINUX CUT. The Linux connector is built by kosmos-relay (tools/build-tunnel-release-linux.sh,
# PigeonPete) and may not exist on the cut Mac yet, so a channel with no Linux pointer skips the family unless
# KOSMOS_CUT_LINUX=1. After the first Linux cut on a channel, skipping is refused (lockstep above).
#
#   release_linux_decide <site> <cut-channel>          sets CUT_LINUX (yes|no) and LINUX_POINTER_FILE, or refuses
#   release_linux_check_manifest <manifest> <commit>   refuses a manifest a release must not publish
#   release_linux_publish <dist> <site> <version> <setup-sha> <key>   the versioned files and the channel pointer
#   release_linux_site_paths <version>                 the paths the site commit takes (prints them)

# The pointer a channel's Linux family is published under (the names engine/update.js and install/setup.sh read).
release_linux_pointer_file() {
  case "$1" in
    staging) printf 'latest-linux-staging.json\n' ;;
    prod) printf 'latest-linux.json\n' ;;
    *) return 1 ;;
  esac
}

release_linux_decide() {
  local site="$1" channel="$2"
  LINUX_POINTER_FILE="$(release_linux_pointer_file "$channel")" || { echo "release-linux: no Linux pointer for channel '$channel'" >&2; return 1; }
  if [ "${KOSMOS_CUT_LINUX:-}" = 1 ]; then
    CUT_LINUX=yes
    return 0
  fi
  # Tracked or not: an untracked one is an aborted cut's leftover, and release_site_restore removes it; either way a
  # pointer on disk means a Linux family is (or was about to be) published on this channel.
  if [ -f "$site/dist/$LINUX_POINTER_FILE" ] || git -C "$site" cat-file -e "origin/main:dist/$LINUX_POINTER_FILE" 2>/dev/null; then
    echo "release-linux: this channel already publishes the Linux family (dist/$LINUX_POINTER_FILE), and its pointer must move with the Mac one (kosmos#7281 lockstep). Set KOSMOS_CUT_LINUX=1 and give the cut the Linux connector." >&2
    return 1
  fi
  CUT_LINUX=no
  echo "   the Linux family is not cut (no Linux pointer on this channel yet; KOSMOS_CUT_LINUX=1 cuts it, kosmos#7281)"
  return 0
}

# A manifest the release must not publish: a test-only build (an unchecked node, a dirty tree, another glibc floor),
# another platform, or a connector other than the one this cut's currency check accepted.
release_linux_check_manifest() {
  local manifest="$1" commit="$2" why
  why="$(node -e '
    const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const want = process.argv[2];
    const bad = [];
    if (m.platform !== "linux") bad.push("it is not a Linux manifest (platform " + JSON.stringify(m.platform) + ")");
    if (!m.node || typeof m.node.download_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(m.node.download_sha256)) bad.push("its node is not checked against nodejs.org (" + JSON.stringify(m.node && m.node.download_sha256) + ")");
    if (!m.app || m.app.dirty !== false) bad.push("it was built from a dirty tree");
    if (!m.connector || m.connector.glibc_floor !== "2.35") bad.push("its glibc floor is " + JSON.stringify(m.connector && m.connector.glibc_floor) + ", not 2.35");
    if (!m.connector || m.connector.commit !== want) bad.push("its connector is from " + JSON.stringify(m.connector && m.connector.commit) + ", not the checked " + want);
    process.stdout.write(bad.join("; "));
  ' "$manifest" "$commit" 2>&1)" || { echo "release-linux: could not read $manifest: $why" >&2; return 1; }
  [ -z "$why" ] || { echo "release-linux: the Linux manifest cannot be released: $why" >&2; return 1; }
  return 0
}

release_linux_publish() {
  local dist="$1" site="$2" v="$3" setup_sha="$4" key="$5" tools sha
  tools="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  [ -n "${LINUX_POINTER_FILE:-}" ] || { echo "release-linux: release_linux_decide did not run" >&2; return 1; }
  [ -f "$dist/kosmos-linux-x64.tar.gz" ] && [ -f "$dist/kosmos-linux-x64.tar.gz.sha256" ] && [ -f "$dist/kosmos-linux-x64.manifest.json" ] \
    || { echo "release-linux: $dist has no Linux build (kosmos-linux-x64.tar.gz, .sha256, manifest)" >&2; return 1; }
  # The versioned name is a promise of immutability, as for the Mac tarball: never republish $v with other bytes.
  if [ -f "$site/dist/kosmos-$v-linux-x64.tar.gz" ] && ! cmp -s "$dist/kosmos-linux-x64.tar.gz" "$site/dist/kosmos-$v-linux-x64.tar.gz"; then
    echo "release-linux: refusing to republish $v's Linux tarball with different bytes (the versioned name is cache-immutable); bump the version" >&2; return 1
  fi
  cp "$dist/kosmos-linux-x64.manifest.json" "$site/dist/kosmos-$v-linux-x64.manifest.json" || return 1
  node "$tools/manifest-sign.js" sign "$key" "$site/dist/kosmos-$v-linux-x64.manifest.json" "$site/dist/kosmos-$v-linux-x64.manifest.json.sig" \
    || { echo "release-linux: could not sign the Linux manifest; nothing is published" >&2; return 1; }
  cp "$dist/kosmos-linux-x64.tar.gz" "$site/dist/kosmos-$v-linux-x64.tar.gz" || return 1
  . "$tools/sha256-name.sh"
  sha256_publish_as "$dist/kosmos-linux-x64.tar.gz.sha256" "$site/dist/kosmos-$v-linux-x64.tar.gz.sha256" || return 1
  sha="$(awk 'NR==1{print $1}' "$site/dist/kosmos-$v-linux-x64.tar.gz.sha256")"
  [ -n "$sha" ] || { echo "release-linux: could not read the Linux tarball's sha256" >&2; return 1; }
  KM_LJ_VERSION="$v" KM_LJ_SHA="$sha" KM_LJ_SETUP_SHA="$setup_sha" \
  KM_LJ_ARTIFACT="kosmos-$v-linux-x64.tar.gz" KM_LJ_MANIFEST="kosmos-$v-linux-x64.manifest.json" \
  KM_LJ_VERSIONED="kosmos-$v-linux-x64.tar.gz" \
    node "$tools/write-latest-pointer.js" "$site/dist/$LINUX_POINTER_FILE" || return 1
  echo "   $LINUX_POINTER_FILE -> $(cat "$site/dist/$LINUX_POINTER_FILE")"
}

release_linux_site_paths() {
  printf 'dist/%s dist/kosmos-%s-linux-x64.manifest.json dist/kosmos-%s-linux-x64.manifest.json.sig\n' "$LINUX_POINTER_FILE" "$1" "$1"
}
