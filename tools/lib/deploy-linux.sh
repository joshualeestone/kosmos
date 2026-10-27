#!/bin/bash
# The Linux x86_64 family in a site deploy (kosmos#7281 slice C3). tools/deploy-site.sh sources this.
#
# THE GAP. A Linux pointer (dist/latest-linux.json, dist/latest-linux-staging.json) is committed, but the tarball it
# names is gitignored and reaches a deploy only through the export's dist/*.tar.gz glob, from the working tree. So a
# deploy from a checkout without it (a fresh clone, the autodeploy box) would serve a pointer whose tarball 404s:
# every Linux install and update fails. The Mac's staged build had exactly this incident (#4819, 2026-09-30).
#
# THE CARRY, per committed Linux pointer: the local copy when it hashes to the pointer's sha256 (how a redeploy from
# the cut box restores a dropped one), else the copy live serves now, fetched and held to BOTH the served .sha256 and
# the committed pointer's sha256. Neither: refused, naming the tarball. A local copy with other bytes is refused too
# (the glob would ship it unchecked).
#
#   deploy_linux_carry <site> <commit> <host>   sets DEPLOY_LINUX_ARTS (the tarball names carried), or refuses
#   deploy_linux_export_ok <export>             the export carries each, with a .sha256 that verifies in place
#   deploy_linux_pointers <site> <commit>       prints the Linux pointers committed at <commit> (for the setup floor)

DEPLOY_LINUX_ARTS=""

deploy_linux_pointers() {
  local p
  for p in latest-linux.json latest-linux-staging.json; do
    git -C "$1" cat-file -e "$2:dist/$p" 2>/dev/null && printf '%s\n' "$p"
  done
  return 0
}

# A fetch into a file, nothing else (a test points <host> at a file:// folder).
_deploy_linux_get() { curl -fsSL --connect-timeout 10 --max-time 600 -H 'Cache-Control: no-cache' "$1" -o "$2" 2>/dev/null; }
_deploy_linux_sha() { shasum -a 256 "$1" | awk '{print $1}'; }

deploy_linux_carry() {
  local site="$1" commit="$2" host="$3" p body name sha ver t ts served
  DEPLOY_LINUX_ARTS=""
  for p in $(deploy_linux_pointers "$site" "$commit"); do
    body="$(git -C "$site" show "$commit:dist/$p" 2>/dev/null)" || { echo "deploy-site: the committed dist/$p could not be read -- refusing (kosmos#7281)" >&2; return 1; }
    ver="$(printf '%s' "$body" | sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p')"
    name="$(printf '%s' "$body" | sed -n 's/.*"versioned":[[:space:]]*"\([^"]*\)".*/\1/p')"
    sha="$(printf '%s' "$body" | sed -n 's/.*"sha256":[[:space:]]*"\([^"]*\)".*/\1/p')"
    [ "$name" = "kosmos-$ver-linux-x64.tar.gz" ] && printf '%s' "$ver" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' \
      || { echo "deploy-site: the committed dist/$p does not name a kosmos-<version>-linux-x64.tar.gz ('$name') -- refusing (kosmos#7281)" >&2; return 1; }
    printf '%s' "$sha" | grep -qE '^[0-9a-f]{64}$' || { echo "deploy-site: the committed dist/$p names no sha256 -- refusing (kosmos#7281)" >&2; return 1; }
    case " $DEPLOY_LINUX_ARTS " in *" $name "*) continue ;; esac   # both pointers on one build
    if [ -f "$site/dist/$name" ]; then
      [ "$(_deploy_linux_sha "$site/dist/$name")" = "$sha" ] \
        || { echo "deploy-site: dist/$name is not the bytes the committed dist/$p names (sha256 $sha) -- refusing; the glob would ship it unchecked (kosmos#7281)" >&2; return 1; }
      printf '%s  %s\n' "$sha" "$name" > "$site/dist/$name.sha256" || return 1
      echo "deploy-site: carrying the Linux build $name (local copy, matches the committed $p)"
    else
      t="$(mktemp "$site/dist/.$name.XXXXXX")" && ts="$(mktemp "$site/dist/.$name.sha256.XXXXXX")" || { echo "deploy-site: could not make a temp file (kosmos#7281)" >&2; return 1; }
      if ! _deploy_linux_get "$host/dist/$name.sha256" "$ts" || ! _deploy_linux_get "$host/dist/$name" "$t"; then
        rm -f "$t" "$ts"
        echo "deploy-site: the committed dist/$p names $name, which is neither in this checkout nor served by $host -- refusing; every Linux install would 404 (kosmos#7281)" >&2
        return 1
      fi
      served="$(awk 'NR==1{print $1}' "$ts")"
      if [ "$served" != "$sha" ] || [ "$(_deploy_linux_sha "$t")" != "$sha" ]; then
        rm -f "$t" "$ts"
        echo "deploy-site: the served $name or its .sha256 is not the build the committed dist/$p names (sha256 $sha) -- refusing (kosmos#7281)" >&2
        return 1
      fi
      mv -f "$t" "$site/dist/$name" && printf '%s  %s\n' "$sha" "$name" > "$site/dist/$name.sha256" && rm -f "$ts" || { rm -f "$t" "$ts"; return 1; }
      echo "deploy-site: carrying the Linux build $name (fetched from $host, checked against the committed $p)"
    fi
    DEPLOY_LINUX_ARTS="${DEPLOY_LINUX_ARTS:+$DEPLOY_LINUX_ARTS }$name"
  done
  return 0
}

deploy_linux_export_ok() {
  local export="$1" name
  for name in $DEPLOY_LINUX_ARTS; do
    ( cd "$export/dist" && shasum -a 256 --status -c "$name.sha256" ) 2>/dev/null \
      || { echo "deploy-site: the export did not carry the Linux build $name with a .sha256 that verifies -- refusing (kosmos#7281)" >&2; return 1; }
  done
  return 0
}
