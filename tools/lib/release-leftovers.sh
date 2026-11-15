# Leftovers from an aborted cut of the same version (kosmos#8562).
#
# A cut writes the versioned files (dist/kosmos-<v>-arm64.* and dist/kosmos-<v>-linux-x64.*) into the site checkout.
# They are gitignored, so a site reset keeps them, and release_site_restore (release-freeze.sh) removes them only when
# the cut that wrote them is the one aborting. A cut that died at or after its deploy (0.8.05 on 11-13: vercel exited
# with no deployment) leaves them behind, and the next cut of that version refuses at step 4b, about two hours in,
# because "the versioned name is cache-immutable".
#
# That rule guards against an edge cache holding the first attempt's bytes. Bytes that were never served cannot be
# cached, so the served host decides, read for each family:
#   - the family's versioned .sha256 for <v>;
#   - CONTROL (positive): the version the family's served prod pointer names; its .sha256 must answer a checksum, or
#     this probe could not have seen "served" at all;
#   - CONTROL (negative): a version that cannot exist; it must NOT answer a checksum, or the host answers every
#     name the same way and nothing can be told from it.
# Served, or any read or control inconclusive: refuse, with the exact way forward. Never served: move the leftovers
# into a dated folder beside the site checkout (outside it, so no git status sees them; nothing is deleted).
#
#   release_leftovers_clear <site> <version> <host>
# Prints what it found and did. 0: nothing in the way (none found, or moved aside). 1: refused (the caller stops).
# Uses `curl` by name, so a test can define a curl function.

release_leftovers_is_sum() { printf '%s' "$1" | head -1 | grep -Eq '^[0-9a-f]{64}([[:space:]]|$)'; }

release_leftovers_read() {   # <url> -> the body's first line on a 200, empty otherwise
  local body
  body="$(curl -fsSL -m 30 -H 'Cache-Control: no-cache' "$1?leftover=$(date +%s)" 2>/dev/null)" || return 0
  printf '%s' "$body" | head -1
}

release_leftovers_clear() {
  local site="$1" v="$2" host="${3%/}" fam f rel found ptr pv mine ctl ok_pos dest moved=0
  # One folder per run, so both families of one aborted cut land together.
  local stamp; stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  [ -n "$site" ] && [ -n "$v" ] && [ -n "$host" ] && [ -d "$site/dist" ] || {
    echo "release-leftovers: site, version and host are required (site $site, version $v, host $host)" >&2; return 1; }
  for fam in arm64 linux-x64; do
    found=""
    for f in "$site"/dist/kosmos-"$v"-"$fam".*; do
      [ -f "$f" ] || continue
      rel="dist/$(basename "$f")"
      git -C "$site" ls-files --error-unmatch "$rel" >/dev/null 2>&1 && continue   # committed: a served release's, never ours to move
      found="$found $rel"
    done
    [ -n "$found" ] || continue
    echo "   found files for $v ($fam) left in the site checkout by an earlier cut:$found"
    ptr="latest.json"; [ "$fam" = linux-x64 ] && ptr="latest-linux.json"
    pv="$(curl -fsSL -m 30 -H 'Cache-Control: no-cache' "$host/dist/$ptr?leftover=$(date +%s)" 2>/dev/null \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s).version;if(typeof v==="string"&&/^\d+\.\d+\.\d+$/.test(v))process.stdout.write(v)}catch{}})' 2>/dev/null)"
    mine="$(release_leftovers_read "$host/dist/kosmos-$v-$fam.tar.gz.sha256")"
    ctl="$(release_leftovers_read "$host/dist/kosmos-0.0.0-leftover-control-$fam.tar.gz.sha256")"
    ok_pos=""
    [ -n "$pv" ] && release_leftovers_is_sum "$(release_leftovers_read "$host/dist/kosmos-$pv-$fam.tar.gz.sha256")" && ok_pos=1
    if release_leftovers_is_sum "$mine"; then
      echo "release-leftovers: $host serves kosmos-$v-$fam.tar.gz.sha256 (a checksum), so $v was served for $fam and its versioned name is cache-immutable. Bump the version; do not move these files."
      return 1
    fi
    if [ -z "$ok_pos" ] || release_leftovers_is_sum "$ctl"; then
      echo "release-leftovers: cannot tell whether $v was ever served for $fam (the served prod pointer's own .sha256 did not answer a checksum, or a version that cannot exist did), so nothing was moved."
      echo "   Read $host/dist/kosmos-$v-$fam.tar.gz.sha256 and a known-served version's by hand. If $v was never served, move the files listed above out of $site/dist and cut again; if it was, bump the version."
      return 1
    fi
    dest="${site%/}.aborted-$v-$stamp"
    mkdir -p "$dest" || { echo "release-leftovers: could not make $dest; nothing was moved" >&2; return 1; }
    for rel in $found; do
      mv "$site/$rel" "$dest/" || { echo "release-leftovers: could not move $rel into $dest; stopped" >&2; return 1; }
      moved=$((moved + 1))
    done
    echo "   never served (the host answered kosmos-$v-$fam like a version that cannot exist, and answered $pv's checksum): moved them to $dest (nothing deleted)."
  done
  return 0
}
