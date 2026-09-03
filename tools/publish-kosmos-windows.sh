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
command -v unzip >/dev/null 2>&1 || { echo "publish-win: unzip is required to read the built version" >&2; exit 1; }

# The version the build BAKED IN, read from the zip itself. Reading the repo's current
# package.json instead would name the artifact after whatever the tree is now, not what was
# built -- exactly the versioned/stale mismatch this card is about.
VERSION="${2:-}"
if [ -z "$VERSION" ]; then
  VERSION="$(unzip -p "$ZIP" app/package.json 2>/dev/null | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
fi
[ -n "$VERSION" ] || { echo "publish-win: could not read the version from $ZIP (app/package.json)" >&2; exit 1; }

ALIAS="kosmos-win-$ARCH.zip"
VERSIONED="kosmos-$VERSION-win-$ARCH.zip"

# Stage both names from the one built zip. COPY, not link: the site deploy carries files, and
# a hard link would break once the shared dist is overwritten in place by a later publish.
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
