# Leftovers from an earlier, aborted cut of the same version (kosmos#8562).
#
# A cut writes the versioned files (dist/kosmos-<v>-arm64.* and dist/kosmos-<v>-linux-x64.*) into the site checkout.
# They are gitignored, so a site reset keeps them, and the EXIT trap's release_site_restore (release-freeze.sh)
# removes them only when this cut wrote them and had not finished step 8. Since kosmos#8494, step 8 finishes only once
# it has SEEN this cut's build served, and at that moment release.sh records it (release_leftovers_mark_served). So a
# leftover is one of:
#   - a cut whose build WAS served (it finished step 8, then failed later): the marker is there. Refused: the
#     versioned name is cache-immutable, bump the version.
#   - older than that marker (the 0.8.05 attempt of 11-13), or a cut killed so hard its trap never ran: no marker.
#     Then the served host decides, strictly. Never served needs ALL of:
#       the version's own <v>-<family>.tar.gz.sha256 answers HTTP 404;
#       CONTROL: a version that cannot exist answers 404 too (the host's real "not here");
#       CONTROL: the version the family's prod pointer names answers 200 with a checksum (this probe can see "served").
#     Anything else (a checksum: served; a timeout, a 5xx, a control that does not hold: unknown) is refused.
# Never served: every family is decided first, then the leftovers are moved into ONE dated folder beside the site
# checkout (outside it, so no git status sees them; nothing is deleted). And if the site still carries a COMMITTED
# Linux manifest for <v> (an aborted cut commits it at step 7b), the cut is refused here with the commit to revert,
# because release_linux_publish would otherwise refuse it at step 4b, about two hours in.
#
#   release_leftovers_clear <site> <version> <host> <family>...     (families: arm64, linux-x64)
# Prints what it found and did. 0: nothing in the way. 1: refused (the caller stops).
#   release_leftovers_mark_served <site> <version>                  (step 8, once this cut's build is seen served)
#   release_leftovers_guard_deploy <host> <version> <family> <sha>  (step 8, just before vercel: refuses if ANOTHER build
#     of <version> is served now. Step 1g reads the host hours earlier; a deploy still in flight then, or one that
#     landed after its cut cleaned up and left no file, can be live by now. 404 or this cut's own sha: go on. Another
#     checksum: refuse. Anything else: read again, KOSMOS_LEFTOVERS_TRIES times (12) KOSMOS_LEFTOVERS_RETRY_S apart
#     (10 s), so a short host blip does not end a cut two hours in; then refuse. Release.sh runs it at 7b, before the
#     site commit, and at step 8, before vercel and each retry. It narrows the window; a deploy landing after the
#     last read is not seen.)
# Uses `curl` by name, so a test can define a curl function.

# The marker lives in the site clone's common git dir (git rev-parse, so every worktree of one clone shares it): no
# git status sees it, and it lasts as long as that clone. Empty when the site is not a git checkout.
release_leftovers_marker() {
  local gd; gd="$(git -C "$1" rev-parse --git-common-dir 2>/dev/null)" || return 0
  case "$gd" in ''|/*) ;; *) gd="$(cd "$1" 2>/dev/null && cd "$gd" 2>/dev/null && pwd -P)" || return 0 ;; esac   # relative to the checkout
  [ -z "$gd" ] || printf '%s/kosmos-cut-served-%s' "$gd" "$2"
  return 0
}

release_leftovers_mark_served() {
  local m; m="$(release_leftovers_marker "$1" "$2")"
  if [ -z "$m" ] || ! { date -u +%Y-%m-%dT%H:%M:%SZ > "$m"; } 2>/dev/null; then
    echo "   NOTE (kosmos#8562): could not record in the site's git dir that $2 was served; a later cut of $2 from this checkout falls back to asking the host" >&2
  fi
  return 0
}


# The version a served pointer (dist/latest.json, dist/latest-linux.json) names, or nothing.
release_leftovers_pointer_version() {
  curl -fsSL -m 30 -H 'Cache-Control: no-cache' "${1%/}/dist/$2?leftover=$(date +%s)" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s).version;if(typeof v==="string"&&/^\d+\.\d+\.\d+$/.test(v))process.stdout.write(v)}catch{}})' 2>/dev/null
  return 0
}

release_leftovers_is_sum() { printf '%s' "$1" | head -1 | grep -Eq '^[0-9a-f]{64}([[:space:]]|$)'; }

# <url> -> "<http status> <first line of the body>"; status 000 when the request itself failed.
release_leftovers_get() {
  local out code
  out="$(curl -sS -L -m 30 -H 'Cache-Control: no-cache' -w '\n%{http_code}' "$1?leftover=$(date +%s)" 2>/dev/null)" || out="${out:-}"$'\n'"000"
  code="${out##*$'\n'}"; case "$code" in [0-9][0-9][0-9]) ;; *) code=000 ;; esac
  printf '%s %s' "$code" "$(printf '%s\n' "${out%$'\n'*}" | head -1)"
}

release_leftovers_clear() {
  local site="${1%/}" v="$2" host="${3%/}"; shift 3
  local fam f rel rc ptr pv mine ctl pos refused=0
  local -a move=()
  [ -n "$site" ] && [ -n "$v" ] && [ -n "$host" ] && [ "$#" -gt 0 ] || {
    echo "release-leftovers: site, version, host and at least one family are required (site $site, version $v, host $host)" >&2; return 1; }
  [ -d "$site/dist" ] || { echo "release-leftovers: $site has no dist/ folder, so it is not a site checkout; nothing was looked at" >&2; return 1; }
  local mk; mk="$(release_leftovers_marker "$site" "$v")"
  if [ -n "$mk" ] && [ -f "$mk" ]; then
    echo "release-leftovers: a cut of $v was seen served from this site checkout on $(cat "$mk") (step 8 recorded it), so the versioned name is cache-immutable. Bump the version."
    return 1
  fi
  for fam in "$@"; do
    local -a found=()
    for f in "$site"/dist/kosmos-"$v"-"$fam".*; do
      [ -f "$f" ] || continue
      rel="dist/$(basename "$f")"
      rc=0; git -C "$site" ls-files --error-unmatch -- "$rel" >/dev/null 2>&1 || rc=$?   # safe under a caller's set -e
      [ "$rc" = 0 ] && continue                      # committed: a served release's, never ours to move
      [ "$rc" = 1 ] || { echo "release-leftovers: git could not say whether $rel is committed (exit $rc); nothing was moved."; return 1; }
      found+=("$rel")
    done
    local manifest=""
    if [ "$fam" = linux-x64 ] && git -C "$site" ls-files --error-unmatch -- "dist/kosmos-$v-linux-x64.manifest.json" >/dev/null 2>&1; then
      manifest="dist/kosmos-$v-linux-x64.manifest.json"
    fi
    # Nothing left here: nothing to move, and no read of the host (a cut start must not depend on it, nor must the
    # suite's nested cuts). A deploy that landed after its cut cleaned up is still refused before it deploys, by
    # release_leftovers_guard_deploy at step 8, though only after the build.
    [ "${#found[@]}" -gt 0 ] || [ -n "$manifest" ] || continue
    if [ "${#found[@]}" -gt 0 ]; then echo "   found files for $v ($fam) left in the site checkout by an earlier cut: ${found[*]}"; fi
    ptr="latest.json"; [ "$fam" = linux-x64 ] && ptr="latest-linux.json"
    pv="$(release_leftovers_pointer_version "$host" "$ptr")"
    local posfam="$fam"
    # A channel's first Linux cut has no Linux pointer yet. The positive control only has to show this host can answer
    # "served", so the Mac family's served version stands in.
    if [ -z "$pv" ] && [ "$fam" = linux-x64 ]; then pv="$(release_leftovers_pointer_version "$host" latest.json)"; posfam=arm64; fi
    mine="$(release_leftovers_get "$host/dist/kosmos-$v-$fam.tar.gz.sha256")"
    if release_leftovers_is_sum "${mine#* }"; then
      echo "release-leftovers: $host serves kosmos-$v-$fam.tar.gz.sha256 (a checksum), so $v was served for $fam and its versioned name is cache-immutable. Bump the version; do not move these files."
      refused=1; continue
    fi
    ctl="$(release_leftovers_get "$host/dist/kosmos-0.0.0-leftover-control-$fam.tar.gz.sha256")"
    pos=""; [ -n "$pv" ] && pos="$(release_leftovers_get "$host/dist/kosmos-$pv-$posfam.tar.gz.sha256")"
    if [ "${mine%% *}" != 404 ] || [ "${ctl%% *}" != 404 ] || [ "${pos%% *}" != 200 ] || ! release_leftovers_is_sum "${pos#* }"; then
      echo "release-leftovers: cannot tell whether $v was ever served for $fam (its .sha256 answered ${mine%% *}; a version that cannot exist answered ${ctl%% *}; $(if [ -n "$pv" ]; then echo "the served $pv answered ${pos%% *}"; else echo "no prod pointer could be read"; fi)), so nothing was moved."
      echo "   Read $host/dist/kosmos-$v-$fam.tar.gz.sha256 by hand: a checksum means it was served (bump the version); a 404 like a made-up version's means it never was (move the files listed above out of $site/dist, and cut again)."
      refused=1; continue
    fi
    if [ -n "$manifest" ]; then
      echo "release-leftovers: $v was never served for $fam, but the site still carries its COMMITTED $manifest (an aborted cut commits it at step 7b: $(git -C "$site" log -1 --format='%h %s' -- "$manifest" 2>/dev/null | cut -c1-80)). Step 4b would refuse to republish it with different bytes. Revert that site commit (or remove the manifest and its .sig in a site commit), then cut again."
      refused=1; continue
    fi
    move+=("${found[@]}")
  done
  [ "$refused" = 0 ] || return 1
  [ "${#move[@]}" -gt 0 ] || return 0
  local dest; dest="$site.aborted-$v-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$dest" || { echo "release-leftovers: could not make $dest; nothing was moved" >&2; return 1; }
  for rel in "${move[@]}"; do
    mv -- "$site/$rel" "$dest/" || { echo "release-leftovers: could not move $rel into $dest; stopped (what moved is in $dest)" >&2; return 1; }
  done
  echo "   never served (each answered 404 like a version that cannot exist, while the served prod version answered its checksum): moved ${#move[@]} file(s) to $dest (nothing deleted; each family is about 100 MB, remove the folder by hand when done)."
  return 0
}

release_leftovers_guard_deploy() {
  local host="${1%/}" v="$2" fam="$3" mine="$4" got try tries="${KOSMOS_LEFTOVERS_TRIES:-12}"
  case "$tries" in ''|0|*[!0-9]*) tries=12 ;; esac
  for try in $(seq 1 "$tries"); do
    got="$(release_leftovers_get "$host/dist/kosmos-$v-$fam.tar.gz.sha256")"
    case "${got%% *}" in
      404) return 0 ;;
      200) if release_leftovers_is_sum "${got#* }"; then
             local served="${got#* }"; served="${served%% *}"
             [ "$served" = "$mine" ] && return 0
             echo "another build of $v is served for $fam now (its .sha256 is $served, this cut's is ${mine:-unreadable}): the versioned name is cache-immutable, so this cut does not deploy; nothing was deployed (its site commit from step 7b stays pushed). Bump the version (kosmos#8562)."
             return 1
           fi ;;
    esac
    [ "$try" = "$tries" ] || sleep "${KOSMOS_LEFTOVERS_RETRY_S:-10}"
  done
  echo "could not read $host/dist/kosmos-$v-$fam.tar.gz.sha256 cleanly before deploying (last answer ${got%% *}), so whether another build of $v is served is unknown; nothing was deployed (its site commit from step 7b stays pushed; kosmos#8562). Try again once the host answers."
  return 1
}
