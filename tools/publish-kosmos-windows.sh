#!/bin/sh
#
# publish-kosmos-windows.sh -- stage a built Windows zip into the site's dist/ under BOTH a
# stable unversioned ALIAS (kosmos-win-<arch>.zip, what the download button points at, like
# /dist/Kosmos.pkg for Mac) AND a VERSIONED copy (kosmos-<version>-win-<arch>.zip, for exact-
# build bug reports), with sha256 sidecars and a latest-win.json manifest. #2008.
#
# WHY an unversioned alias. build-kosmos-windows.sh already emits kosmos-win-<arch>.zip, but
# the release path never publishes a Windows zip (tools/lib/site-deploy.sh carries only
# dist/*.tar.gz and the Kosmos.pkg triple), so the Windows artifact reached the site by a
# hand-copy under a VERSIONED name. A download button pointing at a versioned name silently
# serves a STALE build after the next Windows release -- a working link to the wrong thing,
# which returns 200 and looks correct, so new users download an old build and file bugs
# against something nobody is looking at (#2008). The Mac side already avoids this with the
# unversioned /dist/Kosmos.pkg; this gives Windows the same stable target.
#
# 🛑 IT DOES NOT DEPLOY. It stages into the SITE CHECKOUT's dist/; the next site deploy (the
# release cut, or tools/deploy-site.sh) carries what is there. Serving the alias is
# deliberately gated on the download button going live -- which also needs the #2007 launcher
# token fix -- so there is no rush to push it, and a publish script that also deployed would
# couple a Windows artifact staging step to a production deploy it has no reason to own.
#
# Usage:
#   tools/publish-kosmos-windows.sh <built-zip> [<version>]
#     <built-zip>  the kosmos-win-<arch>.zip produced by build-kosmos-windows.sh
#     <version>    optional; default is read from the zip's OWN app/package.json (the version
#                  the build baked in), so the versioned name and latest-win.json name the
#                  artifact that was actually built -- never the repo's current package.json,
#                  which may have moved since the build.
set -eu

ZIP="${1:-}"
[ -n "$ZIP" ] || { echo "usage: publish-kosmos-windows.sh <built-zip> [<version>]" >&2; exit 1; }
[ -f "$ZIP" ] || { echo "publish-win: no such zip: $ZIP" >&2; exit 1; }

SITE="${KOSMOS_SITE:-$HOME/work/chaoskosmos-site}"
ARCH="${KOSMOS_WIN_ARCH:-x64}"
[ -d "$SITE/dist" ] || { echo "publish-win: no $SITE/dist (is the site checkout present?)" >&2; exit 1; }
# node is always needed (latest-win.json); guarded up front so a missing node fails BEFORE
# anything is staged rather than after.
command -v node >/dev/null 2>&1 || { echo "publish-win: node is required to read the version and write latest-win.json" >&2; exit 1; }

# The version the build BAKED IN, read from the zip itself. Reading the repo's current
# package.json instead would name the artifact after whatever the tree is now, not what was
# built -- exactly the versioned/stale mismatch this card is about.
VERSION="${2:-}"
if [ -z "$VERSION" ]; then
  # unzip is needed ONLY to read the baked version out of the zip; an explicit <version> arg
  # skips it, so the check lives here rather than up top.
  command -v unzip >/dev/null 2>&1 || { echo "publish-win: unzip is required to read the built version (or pass <version> explicitly)" >&2; exit 1; }
  # node, not a sed heuristic: a minified single-line package.json carrying another "version"
  # substring (a dependency key) could mis-parse under sed; node parses the JSON exactly.
  VERSION="$(unzip -p "$ZIP" app/package.json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).version||""))}catch{process.stdout.write("")}})')"
fi
[ -n "$VERSION" ] || { echo "publish-win: could not read the version from $ZIP (app/package.json)" >&2; exit 1; }
# VERSION is interpolated into the staged filename (kosmos-<version>-win-<arch>.zip). A crafted or
# corrupt zip whose version carries a "/" (e.g. "../evil") would make cp write OUTSIDE dist/. Refuse
# anything but a filename-safe token -- letters, digits and . + _ - (semver's alphabet). All
# expansions here are quoted, so this is defence in depth against the path-escape, not word-splitting.
case "$VERSION" in
  *[!0-9A-Za-z.+_-]*) echo "publish-win: refusing an implausible version '$VERSION' (only letters, digits and . + _ - allowed)" >&2; exit 1 ;;
esac

ALIAS="kosmos-win-$ARCH.zip"
VERSIONED="kosmos-$VERSION-win-$ARCH.zip"

# The VERSIONED name is a promise of IMMUTABILITY: a client that pinned kosmos-<v>-win-<arch>.zip
# must always get the same bytes, so republishing DIFFERENT bytes under it seeds a stale-cache
# incident (release.sh refuses the same way for the versioned tarball). Check FIRST, before ANY
# cp: a refusal must leave dist ENTIRELY untouched. If the mutable alias were cp'd before this
# guard, a refused republish would leave the alias clobbered to the refused bytes while its
# sidecar and latest-win.json still describe the old bytes -- an inconsistent dist that fails
# shasum -c and serves un-manifested bytes, the very "serve the wrong thing" class this fights.
# Re-running with the SAME bytes is fine (cmp matches), so a retry after a partial run is safe.
if [ -f "$SITE/dist/$VERSIONED" ] && ! cmp -s "$ZIP" "$SITE/dist/$VERSIONED"; then
  echo "publish-win: $VERSIONED already exists with DIFFERENT bytes -- refusing to republish a versioned name (it is immutable). Bump the version, or remove the old artifact deliberately." >&2
  exit 1
fi
# Stage both names from the one built zip. COPY, not link: the site deploy carries files, and a
# hard link would break once the shared dist is overwritten in place by a later publish. The
# ALIAS is intentionally MUTABLE -- it always points at the newest build.
cp "$ZIP" "$SITE/dist/$ALIAS"
cp "$ZIP" "$SITE/dist/$VERSIONED"

# sha256 sidecar for each, NAMING its own file, and verified IN PLACE -- a pair that cannot
# verify itself is a refusal, not a publish (the lesson release.sh's sha256_publish_as records:
# a served .sha256 that names a different path fails `shasum -c` on good bytes).
for name in "$ALIAS" "$VERSIONED"; do
  ( cd "$SITE/dist" && shasum -a 256 "$name" > "$name.sha256" )
  ( cd "$SITE/dist" && shasum -a 256 --status -c "$name.sha256" ) \
    || { echo "publish-win: the sha256 pair for $name does not verify in place" >&2; exit 1; }
done

# The whole-artifact sha256 (alias and versioned copy are the same bytes, so one sha).
SHA="$(awk '{print $1}' "$SITE/dist/$ALIAS.sha256")"
[ -n "$SHA" ] || { echo "publish-win: could not read the artifact sha256" >&2; exit 1; }

# latest-win.json: mirrors latest.json so a consumer discovers the current Windows build
# without hardcoding a name (removing deploy-site.sh's KOSMOS_WIN_ZIP hardcode, #2014). The
# `artifact` is the STABLE ALIAS the button fetches; `version` + `sha256` let a client verify
# what it downloaded and name the exact build in a report; `versioned` points at the pinned copy.
KM_V="$VERSION" KM_SHA="$SHA" KM_ARTIFACT="$ALIAS" KM_VERSIONED="$VERSIONED" KM_ARCH="$ARCH" \
  node -e '
    const e = process.env;
    require("node:fs").writeFileSync(process.argv[1], JSON.stringify({
      version: e.KM_V,
      sha256: e.KM_SHA,
      artifact: e.KM_ARTIFACT,
      versioned: e.KM_VERSIONED,
      arch: e.KM_ARCH,
    }) + "\n");
  ' "$SITE/dist/latest-win.json"

echo "publish-win: staged into $SITE/dist (NOT deployed):"
echo "   alias:     $ALIAS ($SHA)"
echo "   versioned: $VERSIONED"
echo "   manifest:  latest-win.json -> $(cat "$SITE/dist/latest-win.json")"
echo "publish-win: the next site deploy (release cut or tools/deploy-site.sh) carries these."
echo "publish-win: serving is gated on the download button going live (#2007 launcher + #2008 alias)."
