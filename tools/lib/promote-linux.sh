#!/bin/bash
# The Linux family in a Mac promote (kosmos#7281 slice C2). tools/promote-channel.sh sources this. A channel's Mac and
# Linux pointers always name one version (LOCKSTEP, tools/lib/release-linux.sh says why), so a Mac promote of V moves
# latest-linux-staging.json onto latest-linux.json in the same run, or refuses before writing anything.
#
#   promote_linux_prepare <site> <version> [named]   before any write: decides PROMOTE_LINUX (yes|no), snapshots the
#                                                    Linux staging pointer and checks it, or refuses
#   promote_linux_unchanged <site>                   right before the writes: the staging pointer is still the snapshot
#   promote_linux_stage <site>                       BEFORE latest.json moves: the temp copy, checked (review 1 W1)
#   promote_linux_commit <site>                      right AFTER latest.json: one rename; a failure sets
#                                                    PROMOTE_LINUX_FAILED and returns 0, so the caller finishes the
#                                                    promote's other steps and refuses at the end (promote_linux_refuse_if_failed)
#   promote_linux_cleanup                            removes the snapshot and any temp copy (the caller's EXIT trap)

PROMOTE_LINUX=no
PROMOTE_LINUX_SNAP=""
PROMOTE_LINUX_TMP=""
PROMOTE_LINUX_FAILED=0

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
  # Review 1 (W2): the same two checks the Mac manifest gets. Under the keys prod's CURRENT Linux release pins (what its
  # installs check with), and, with a recovery key pinned, under the served release key list (#6609).
  local cur rc kl
  cur="$(sed -n 's/.*"manifest"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$prod" 2>/dev/null | head -1)" || cur=""
  if [ -n "$cur" ]; then
    case "$cur" in *"/"*|*".."*) echo "promote-linux: latest-linux.json's manifest ('$cur') is not a bare filename. Nothing was written." >&2; return 1 ;; esac
    rc=0; [ -f "$site/dist/$cur" ] && { node "$tools/manifest-sign.js" verify-under "$site/dist/$lman" "$site/dist/$lman.sig" "$site/dist/$cur" >/dev/null 2>&1 || rc=$?; } || rc=2
    case "$rc" in
      0) : ;;
      1) echo "promote-linux: $lman is not signed by a key prod's current Linux release ($cur) accepts; its installs would refuse it. Nothing was written." >&2; return 1 ;;
      *) echo "promote-linux: prod's current Linux manifest ($cur) cannot be read to tell which keys its installs accept. Nothing was written." >&2; return 1 ;;
    esac
  fi
  rc=0; node "$tools/manifest-sign.js" needs-list >/dev/null 2>&1 || rc=$?
  case "$rc" in
    3) : ;;
    0)
      git -C "$site" fetch -q origin main 2>/dev/null || { echo "promote-linux: could not fetch the site to read the served release key list. Nothing was written." >&2; return 1; }
      kl="$(mktemp -d)" || { echo "promote-linux: could not make a temp folder" >&2; return 1; }
      git -C "$site" show "origin/main:dist/release-keys.json" > "$kl/release-keys.json" 2>/dev/null || rm -f "$kl/release-keys.json"
      git -C "$site" show "origin/main:dist/release-keys.json.sig" > "$kl/release-keys.json.sig" 2>/dev/null || rm -f "$kl/release-keys.json.sig"
      rc=0; node "$tools/manifest-sign.js" verify-under-list "$site/dist/$lman" "$site/dist/$lman.sig" "$kl/release-keys.json" "$kl/release-keys.json.sig" >/dev/null 2>&1 || rc=$?
      rm -rf "$kl"
      [ "$rc" = 0 ] || { echo "promote-linux: $lman is not signed by a key the served release key list names (#6609). Nothing was written." >&2; return 1; } ;;
    *) echo "promote-linux: could not tell whether this checkout checks the release key list (needs-list exited $rc). Nothing was written." >&2; return 1 ;;
  esac
  PROMOTE_LINUX=yes
  echo "   the Linux family moves with it: latest-linux-staging.json names $v ($lver, sha256 $lsha)"
}

promote_linux_unchanged() {
  [ "$PROMOTE_LINUX" = yes ] || return 0
  cmp -s "$1/dist/latest-linux-staging.json" "$PROMOTE_LINUX_SNAP" \
    || { echo "promote-linux: latest-linux-staging.json changed while the promote ran; nothing was written. Re-run the promote." >&2; return 1; }
}

promote_linux_stage() {
  local site="$1"
  [ "$PROMOTE_LINUX" = yes ] || return 0
  PROMOTE_LINUX_TMP="$(mktemp "$site/dist/.latest-linux.json.XXXXXX")" || { PROMOTE_LINUX_TMP=""; echo "promote-linux: could not make a temp file for latest-linux.json; nothing was written." >&2; return 1; }
  cp "$PROMOTE_LINUX_SNAP" "$PROMOTE_LINUX_TMP" && cmp -s "$PROMOTE_LINUX_SNAP" "$PROMOTE_LINUX_TMP" \
    || { echo "promote-linux: the temp copy of latest-linux-staging.json does not read back as it; nothing was written." >&2; return 1; }
}

promote_linux_commit() {
  local site="$1"
  [ "$PROMOTE_LINUX" = yes ] || return 0
  if mv "$PROMOTE_LINUX_TMP" "$site/dist/latest-linux.json" && cmp -s "$PROMOTE_LINUX_SNAP" "$site/dist/latest-linux.json"; then
    PROMOTE_LINUX_TMP=""
    echo "   latest-linux.json -> $(cat "$site/dist/latest-linux.json")"
  else
    PROMOTE_LINUX_FAILED=1
    echo "promote-linux: latest.json IS promoted but latest-linux.json is NOT (the rename failed). The promote carries on through /setup and the alias, then refuses." >&2
  fi
  return 0
}

promote_linux_refuse_if_failed() {
  [ "$PROMOTE_LINUX_FAILED" = 1 ] || return 0
  echo "promote-linux: REFUSED AT THE END: latest.json, /setup and the alias were promoted, latest-linux.json was NOT. Before any deploy, copy dist/latest-linux-staging.json onto dist/latest-linux.json and commit it with latest.json (kosmos#7281 lockstep)." >&2
  return 1
}

promote_linux_cleanup() { [ -z "$PROMOTE_LINUX_SNAP" ] || rm -f "$PROMOTE_LINUX_SNAP"; [ -z "$PROMOTE_LINUX_TMP" ] || rm -f "$PROMOTE_LINUX_TMP"; }
