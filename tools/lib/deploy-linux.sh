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

# One fetch into a file, with deploy-site's retries and speed limit (a stalled transfer is abandoned after a minute
# under 1 KB/s). Prints the final HTTP status: 200 ok, 404 absent; anything else after the retries is "could not tell".
_deploy_linux_get() {  # <url> <out>
  local n=0 code
  while [ "$n" -lt "${FETCH_ATTEMPTS:-3}" ]; do
    n=$((n + 1))
    code="$(curl -sSL --connect-timeout 15 --speed-limit 1024 --speed-time 60 --max-time 1200 -H 'Cache-Control: no-cache' \
      -o "$2" -w '%{http_code}' "$1" 2>/dev/null)" || code=000   # review 2: a cut-off 200 is not a 200 (deploy-site.sh does the same)
    case "$code" in ''|*[!0-9]*) code=000 ;; esac
    case "$1" in file://*) [ -s "$2" ] && code=200 || code=404 ;; esac   # file:// (the tests) has no HTTP status
    case "$code" in 200|404) break ;; esac
    [ "$n" -lt "${FETCH_ATTEMPTS:-3}" ] && sleep "${FETCH_RETRY_DELAY:-3}"
  done
  printf '%s' "$code"
}
_deploy_linux_sha() { shasum -a 256 "$1" | awk '{print $1}'; }
# a.b.c newer than a.b.c? (0 yes)
_deploy_linux_newer() { awk -v a="$1" -v b="$2" 'BEGIN { split(a, x, "."); split(b, y, "."); for (i = 1; i <= 3; i++) { if (x[i] + 0 > y[i] + 0) exit 0; if (x[i] + 0 < y[i] + 0) exit 1 } exit 1 }'; }
# Write <content> to <dest> through a temp beside it, mode 644 (served files).
_deploy_linux_put() { local t; t="$(mktemp "$(dirname "$2")/.put.XXXXXX")" && printf '%s\n' "$1" > "$t" && chmod 644 "$t" && mv -f "$t" "$2" || { rm -f "${t:-}"; return 1; }; }

# Returns 0 carried, 1 refused, 75 the live host could not be read (deploy-site exits 75: try again later, #5589).
deploy_linux_carry() {
  local site="$1" commit="$2" host="$3" p body name sha ver t ts code live_ver
  DEPLOY_LINUX_ARTS=""
  for p in $(deploy_linux_pointers "$site" "$commit"); do
    body="$(git -C "$site" show "$commit:dist/$p" 2>/dev/null)" || { echo "deploy-site: the committed dist/$p could not be read -- refusing (kosmos#7281)" >&2; return 1; }
    ver="$(printf '%s' "$body" | sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p')"
    name="$(printf '%s' "$body" | sed -n 's/.*"versioned":[[:space:]]*"\([^"]*\)".*/\1/p')"
    sha="$(printf '%s' "$body" | sed -n 's/.*"sha256":[[:space:]]*"\([^"]*\)".*/\1/p')"
    [ "$name" = "kosmos-$ver-linux-x64.tar.gz" ] && printf '%s' "$ver" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' \
      || { echo "deploy-site: the committed dist/$p does not name a kosmos-<version>-linux-x64.tar.gz ('$name') -- refusing (kosmos#7281)" >&2; return 1; }
    printf '%s' "$sha" | grep -qE '^[0-9a-f]{64}$' || { echo "deploy-site: the committed dist/$p names no sha256 -- refusing (kosmos#7281)" >&2; return 1; }
    # LOCKSTEP backstop (kosmos#7281 C2 review 5): a channel's committed Mac pointer and Linux pointer name one version,
    # or a board offers one release while setup.sh installs another. A promote that stopped between its two renames,
    # or a commit of only latest.json, is refused here rather than deployed.
    local mp mver
    case "$p" in latest-linux.json) mp=latest.json ;; *) mp=latest-staging.json ;; esac
    if git -C "$site" cat-file -e "$commit:dist/$mp" 2>/dev/null; then
      mver="$(git -C "$site" show "$commit:dist/$mp" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).version||""))}catch{}})')"
      [ "$mver" = "$ver" ] || { echo "deploy-site: the committed dist/$mp names $mver but dist/$p names $ver; a channel's two pointers must name one version (kosmos#7281 lockstep) -- refusing" >&2; return 1; }
    fi
    # Review 1 (W4): never move a Linux pointer backwards from what live serves (a checkout behind main); a deliberate
    # rollback names the version it rolls to in KOSMOS_LINUX_ROLLBACK.
    t="$(mktemp "${TMPDIR:-/tmp}/deploy-linux-live.XXXXXX")" || return 1
    code="$(_deploy_linux_get "$host/dist/$p" "$t")"
    live_ver="$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$t" 2>/dev/null)"; rm -f "$t"
    case "$code" in
      200) if [ -n "$live_ver" ] && _deploy_linux_newer "$live_ver" "$ver" && [ "${KOSMOS_LINUX_ROLLBACK:-}" != "$ver" ]; then
             echo "deploy-site: the committed dist/$p names $ver but live serves $live_ver -- refusing to move it backwards (a checkout behind main?). A deliberate rollback: KOSMOS_LINUX_ROLLBACK=$ver (kosmos#7281)" >&2; return 1
           fi ;;
      404) : ;;
      *) echo "deploy-site: could not read the live dist/$p (HTTP $code) -- refusing for now (exit 75: try again later) (kosmos#7281)" >&2; return 75 ;;
    esac
    # Review 2: a 200 with no readable version (a rewrite page, a garbled file) cannot tell us the live version, so the
    # backwards check would pass by default: treat it as "could not read" instead.
    case "$code" in
      200) printf '%s' "$live_ver" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' \
             || { echo "deploy-site: the live dist/$p answered but names no version -- refusing for now (exit 75: try again later) (kosmos#7281)" >&2; return 75; } ;;
    esac
    case " $DEPLOY_LINUX_ARTS " in *" $name "*) continue ;; esac   # both pointers on one build
    if [ -f "$site/dist/$name" ]; then
      [ "$(_deploy_linux_sha "$site/dist/$name")" = "$sha" ] \
        || { echo "deploy-site: dist/$name is not the bytes the committed dist/$p names (sha256 $sha) -- refusing; the glob would ship it unchecked (kosmos#7281)" >&2; return 1; }
      _deploy_linux_put "$sha  $name" "$site/dist/$name.sha256" || return 1
      echo "deploy-site: carrying the Linux build $name (local copy, matches the committed $p)"
    else
      # The temps sit in deploy-site's own in-flight slots, so its INT/TERM/HUP traps remove them (review 1 W3).
      ts="$(mktemp "$site/dist/.$name.sha256.XXXXXX")" || return 1; _FETCH_TMP_S="$ts"
      code="$(_deploy_linux_get "$host/dist/$name.sha256" "$ts")"
      case "$code" in
        200) : ;;
        404) rm -f "$ts"; _FETCH_TMP_S=""; echo "deploy-site: the committed dist/$p names $name, which is neither in this checkout nor served by $host -- refusing; every Linux install would 404 (kosmos#7281)" >&2; return 1 ;;
        *) rm -f "$ts"; _FETCH_TMP_S=""; echo "deploy-site: could not read $host/dist/$name.sha256 (HTTP $code) -- refusing for now (exit 75: try again later) (kosmos#7281)" >&2; return 75 ;;
      esac
      # The served .sha256 is compared BEFORE the large download (review 1 nit).
      [ "$(awk 'NR==1{print $1}' "$ts")" = "$sha" ] \
        || { rm -f "$ts"; _FETCH_TMP_S=""; echo "deploy-site: the served $name.sha256 is not the build the committed dist/$p names (sha256 $sha) -- refusing (kosmos#7281)" >&2; return 1; }
      rm -f "$ts"; _FETCH_TMP_S=""
      t="$(mktemp "$site/dist/.$name.XXXXXX")" || return 1; _FETCH_TMP_A="$t"
      code="$(_deploy_linux_get "$host/dist/$name" "$t")"
      case "$code" in
        200) : ;;
        404) rm -f "$t"; _FETCH_TMP_A=""; echo "deploy-site: the served $name.sha256 exists but $name does not -- refusing (kosmos#7281)" >&2; return 1 ;;
        *) rm -f "$t"; _FETCH_TMP_A=""; echo "deploy-site: could not fetch $host/dist/$name (HTTP $code) -- refusing for now (exit 75: try again later) (kosmos#7281)" >&2; return 75 ;;
      esac
      [ "$(_deploy_linux_sha "$t")" = "$sha" ] \
        || { rm -f "$t"; _FETCH_TMP_A=""; echo "deploy-site: the served $name is not the build the committed dist/$p names (sha256 $sha) -- refusing (kosmos#7281)" >&2; return 1; }
      chmod 644 "$t" && mv -f "$t" "$site/dist/$name" || { rm -f "$t"; _FETCH_TMP_A=""; return 1; }
      _FETCH_TMP_A=""
      _deploy_linux_put "$sha  $name" "$site/dist/$name.sha256" || return 1
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
