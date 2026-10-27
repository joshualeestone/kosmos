#!/bin/bash
# The Linux family in a Mac promote (kosmos#7281 slice C2). tools/promote-channel.sh sources this. A channel's Mac and
# Linux pointers always name one version (LOCKSTEP, tools/lib/release-linux.sh says why), so a Mac promote of V moves
# latest-linux-staging.json onto latest-linux.json in the same run, or refuses before writing anything.
#
#   promote_linux_prepare <site> <version> [named]   before any write: decides PROMOTE_LINUX (yes|no), snapshots the
#                                                    Linux staging pointer and checks it, or refuses
#   promote_linux_unchanged <site>                   right before the writes: the staging pointer is still the snapshot
#   promote_linux_write <site>                       right after latest.json: the atomic copy onto latest-linux.json
#   promote_linux_cleanup                            removes the snapshot (the caller's EXIT trap)

PROMOTE_LINUX=no
PROMOTE_LINUX_SNAP=""

promote_linux_prepare() {
  local site="$1" v="$2" named="${3:-}" stg="$1/dist/latest-linux-staging.json" prod="$1/dist/latest-linux.json" tools field
  tools="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROMOTE_LINUX=no
  if [ ! -f "$stg" ]; then
    # No Linux family on staging. A Linux PROD pointer would then stay put while latest.json moves: refuse.
    if [ -f "$prod" ]; then
      echo "promote-linux: prod publishes the Linux family (dist/latest-linux.json) but staging has no Linux pointer to move it to $v; its pointer must move with latest.json (kosmos#7281 lockstep). Nothing was written." >&2
      return 1
    fi
    return 0
  fi
  # A named promote reads the Mac pointer from a commit; moving the Linux one by name is not built, so it is refused
  # rather than leaving the two apart (kosmos#7281 follow-up).
  if [ -n "$named" ]; then
    echo "promote-linux: a named promote (--version) cannot move the Linux pointer yet, and staging publishes the Linux family; promote from the staging pointer instead (kosmos#7281). Nothing was written." >&2
    return 1
  fi
  PROMOTE_LINUX_SNAP="$(mktemp "${TMPDIR:-/tmp}/promote-linux-staging.XXXXXX")" || { echo "promote-linux: could not make a temp file" >&2; return 1; }
  cp "$stg" "$PROMOTE_LINUX_SNAP" || { echo "promote-linux: could not snapshot $stg" >&2; return 1; }
  field() { node -e 'try{process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]]||""))}catch{}' "$PROMOTE_LINUX_SNAP" "$1" 2>/dev/null || true; }
  local lv lsha lver lman
  lv="$(field version)"; lsha="$(field sha256)"; lver="$(field versioned)"; lman="$(field manifest)"
  [ "$lv" = "$v" ] || { echo "promote-linux: latest-linux-staging.json names $lv, not $v; a channel's two pointers must name one version (kosmos#7281 lockstep). Nothing was written." >&2; return 1; }
  [ "$lver" = "kosmos-$v-linux-x64.tar.gz" ] && [ "$lman" = "kosmos-$v-linux-x64.manifest.json" ] \
    || { echo "promote-linux: latest-linux-staging.json does not name $v's Linux tarball and manifest. Nothing was written." >&2; return 1; }
  ( cd "$site/dist" && shasum -a 256 --status -c "$lver.sha256" ) 2>/dev/null && [ "$(awk 'NR==1{print $1}' "$site/dist/$lver.sha256")" = "$lsha" ] \
    || { echo "promote-linux: $lver is missing, or does not match its .sha256 and the pointer's sha256. Nothing was written." >&2; return 1; }
  [ -f "$site/dist/$lman" ] && [ -f "$site/dist/$lman.sig" ] \
    || { echo "promote-linux: $lman or its signature is missing. Nothing was written." >&2; return 1; }
  node "$tools/manifest-sign.js" verify "$site/dist/$lman" "$site/dist/$lman.sig" >/dev/null 2>&1 \
    || { echo "promote-linux: $lman's signature does not verify under the pinned keys. Nothing was written." >&2; return 1; }
  PROMOTE_LINUX=yes
  echo "   the Linux family moves with it: latest-linux-staging.json names $v ($lver, sha256 $lsha)"
}

promote_linux_unchanged() {
  [ "$PROMOTE_LINUX" = yes ] || return 0
  cmp -s "$1/dist/latest-linux-staging.json" "$PROMOTE_LINUX_SNAP" \
    || { echo "promote-linux: latest-linux-staging.json changed while the promote ran; nothing was written. Re-run the promote." >&2; return 1; }
}

promote_linux_write() {
  local site="$1" t
  [ "$PROMOTE_LINUX" = yes ] || return 0
  t="$(mktemp "$site/dist/.latest-linux.json.XXXXXX")" || { echo "promote-linux: could not make a temp file (latest.json IS promoted; latest-linux.json is NOT: copy dist/latest-linux-staging.json onto it by hand before any deploy)" >&2; return 1; }
  cp "$PROMOTE_LINUX_SNAP" "$t" && cmp -s "$PROMOTE_LINUX_SNAP" "$t" && mv "$t" "$site/dist/latest-linux.json" \
    || { rm -f "$t"; echo "promote-linux: could not write latest-linux.json (latest.json IS promoted; copy dist/latest-linux-staging.json onto it by hand before any deploy)" >&2; return 1; }
  cmp -s "$PROMOTE_LINUX_SNAP" "$site/dist/latest-linux.json" \
    || { echo "promote-linux: latest-linux.json does not read back as the verified snapshot; check it by hand before any deploy" >&2; return 1; }
  echo "   latest-linux.json -> $(cat "$site/dist/latest-linux.json")"
}

promote_linux_cleanup() { [ -z "$PROMOTE_LINUX_SNAP" ] || rm -f "$PROMOTE_LINUX_SNAP"; }
