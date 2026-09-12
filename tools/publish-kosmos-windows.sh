#!/bin/sh
#
# publish-kosmos-windows.sh -- stage a built Windows zip into the site's dist/ on a CHANNEL.
#
#   staging (the DEFAULT): a VERSIONED copy (kosmos-<version>-win-<arch>.zip) with its sha256
#       sidecar, and latest-win-staging.json. The alias, its sidecar and latest-win.json are NOT
#       touched, so the download button and every prod reader stay on the current build until
#       `promote-channel.sh --family win` moves them on Josh's go.
#   prod: the BREAK-GLASS, gated. The #2008 outputs -- BOTH a stable unversioned ALIAS
#       (kosmos-win-<arch>.zip, what the download button points at, like /dist/Kosmos.pkg for Mac)
#       AND the versioned copy, with sha256 sidecars and a latest-win.json manifest -- written only
#       with Josh's go for this exact zip (KOSMOS_WIN_PROD_APPROVED_SHA + KOSMOS_WIN_PROD_APPROVAL_REF,
#       logged before anything is copied; see THE BREAK-GLASS below).
#
# WHY staging is the default. The fleetwide rule (Josh, 2026-09-12): every release cut goes to
# STAGING first, is verified, and only goes to PROD after his approval. Writing prod directly was
# the only thing this script could do, so Windows could not follow the rule. The channel variable
# is KOSMOS_WIN_CUT_CHANNEL -- not the Mac cut's KOSMOS_CUT_CHANNEL, which release.sh defaults to
# prod and which this script ignores.
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
#   tools/publish-kosmos-windows.sh <built-zip> [<version>]                      (staging)
#   KOSMOS_WIN_CUT_CHANNEL=prod KOSMOS_WIN_PROD_APPROVED_SHA=<sha256 Josh approved> \
#     KOSMOS_WIN_PROD_APPROVAL_REF=<Slack ts or permalink of his message> \
#     tools/publish-kosmos-windows.sh <built-zip> [<version>]                    (the break-glass)
#     <built-zip>  the kosmos-win-<arch>.zip produced by build-kosmos-windows.sh
#     <version>    optional; default is read from the zip's OWN app/package.json (the version
#                  the build baked in), so the versioned name and the pointer name the
#                  artifact that was actually built -- never the repo's current package.json,
#                  which may have moved since the build.
set -eu

ZIP="${1:-}"
[ -n "$ZIP" ] || { echo "usage: publish-kosmos-windows.sh <built-zip> [<version>]" >&2; exit 1; }
[ -f "$ZIP" ] || { echo "publish-win: no such zip: $ZIP" >&2; exit 1; }

SITE="${KOSMOS_SITE:-$HOME/work/chaoskosmos-site}"
ARCH="${KOSMOS_WIN_ARCH:-x64}"
# Which channel this publish writes: KOSMOS_WIN_CUT_CHANNEL, deliberately NOT the Mac cut's
# KOSMOS_CUT_CHANNEL. That one defaults to prod in release.sh, so sharing it meant an operator who
# exported it for a Mac cut silently published Windows straight to prod. The same two values and
# the same refusal as release.sh, so an operator reads one vocabulary (tools.publish-windows-2008
# .test.js pins the two equal); the default is staging. Validated here, before anything is staged.
CUT_CHANNEL="${KOSMOS_WIN_CUT_CHANNEL:-staging}"
case "$CUT_CHANNEL" in
  staging) POINTER_FILE="latest-win-staging.json" ;;
  prod)    POINTER_FILE="latest-win.json" ;;
  *) echo "publish-win: KOSMOS_WIN_CUT_CHANNEL must be 'staging' or 'prod' (got '$CUT_CHANNEL')" >&2; exit 1 ;;
esac
if [ -n "${KOSMOS_CUT_CHANNEL:-}" ] && [ -z "${KOSMOS_WIN_CUT_CHANNEL:-}" ]; then
  echo "publish-win: NOTE KOSMOS_CUT_CHANNEL=$KOSMOS_CUT_CHANNEL is the Mac cut's channel and is ignored here; this Windows publish goes to $CUT_CHANNEL (KOSMOS_WIN_CUT_CHANNEL chooses it)." >&2
fi
[ -d "$SITE/dist" ] || { echo "publish-win: no $SITE/dist (is the site checkout present?)" >&2; exit 1; }
# node is always needed (the pointer); guarded up front so a missing node fails BEFORE
# anything is staged rather than after.
command -v node >/dev/null 2>&1 || { echo "publish-win: node is required to read the version and write $POINTER_FILE" >&2; exit 1; }

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
# ARCH is interpolated into the SAME staged filenames as VERSION, so it needs the SAME
# path-escape guard -- otherwise KOSMOS_WIN_ARCH=../x would make cp write outside dist/ while
# the identical string in a version is refused. ARCH is operator-supplied (not from the zip),
# a weaker threat than a crafted version, but the asymmetry is the bug: guard both the same.
case "$ARCH" in
  *[!0-9A-Za-z.+_-]*) echo "publish-win: refusing an implausible arch '$ARCH' (only letters, digits and . + _ - allowed)" >&2; exit 1 ;;
esac

ALIAS="kosmos-win-$ARCH.zip"
VERSIONED="kosmos-$VERSION-win-$ARCH.zip"

# Was this exact versioned name already in dist BEFORE this run? Captured once, before any cp,
# and reused twice below: by the immutability guard, and by the backward-repoint NOTICE. A
# re-publish of an ALREADY-PUBLISHED version is the signal both care about.
VERSIONED_PREEXISTED=no
[ -f "$SITE/dist/$VERSIONED" ] && VERSIONED_PREEXISTED=yes

# The VERSIONED name is a promise of IMMUTABILITY: a client that pinned kosmos-<v>-win-<arch>.zip
# must always get the same bytes, so republishing DIFFERENT bytes under it seeds a stale-cache
# incident (release.sh refuses the same way for the versioned tarball). Check FIRST, before ANY
# cp: a refusal must leave dist ENTIRELY untouched. If the mutable alias were cp'd before this
# guard, a refused republish would leave the alias clobbered to the refused bytes while its
# sidecar and latest-win.json still describe the old bytes -- an inconsistent dist that fails
# shasum -c and serves un-manifested bytes, the very "serve the wrong thing" class this fights.
# Re-running with the SAME bytes is fine (cmp matches), so a retry after a partial run is safe.
# This holds on BOTH channels: a staged versioned name is the one a promote later points prod at.
if [ "$VERSIONED_PREEXISTED" = yes ] && ! cmp -s "$ZIP" "$SITE/dist/$VERSIONED"; then
  echo "publish-win: $VERSIONED already exists with DIFFERENT bytes -- refusing to republish a versioned name (it is immutable). Bump the version, or remove the old artifact deliberately." >&2
  exit 1
fi
# The ALIAS is intentionally MUTABLE -- it points at the MOST-RECENTLY-PUBLISHED build, not
# necessarily the highest version. That distinction is a footgun in ONE specific case: re-publishing
# an ALREADY-PUBLISHED build (e.g. to regenerate a missing sidecar) passes the immutability guard
# above (its bytes match its own existing versioned copy) and then repoints the button off whatever
# it currently serves -- typically an OLDER build, since re-staging is usually a rollback/sidecar
# fix, not a release. A normal forward release (a version NOT yet in dist) is the expected case and
# needs no notice; warning on every release would just train the operator to ignore this line, so it
# would not be there when it matters. Fire ONLY when re-publishing a version that already existed AND
# the alias currently names a different one -- the one time a repoint is likely unintended. We do not
# claim a direction (semver ordering in POSIX sh is costly and error-prone); we state both versions
# and let the operator judge. It informs, it does not block. Prod only: a staging publish never
# moves the alias, so there is nothing to repoint.
if [ "$CUT_CHANNEL" = prod ] && [ "$VERSIONED_PREEXISTED" = yes ] && [ -f "$SITE/dist/latest-win.json" ]; then
  PREV_V="$(KM_MF="$SITE/dist/latest-win.json" node -e 'try{process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.env.KM_MF,"utf8")).version||""))}catch{}')"
  if [ -n "$PREV_V" ] && [ "$PREV_V" != "$VERSION" ]; then
    echo "publish-win: NOTICE re-publishing already-present version $VERSION repoints the alias $ALIAS off the current $PREV_V (the button will serve $VERSION after the next deploy). Re-staging an existing build is usually a sidecar fix, not a release -- if you meant to release, bump the version." >&2
  fi
fi

# THE BREAK-GLASS. A direct prod publish (KOSMOS_WIN_CUT_CHANNEL=prod) skips staging, the Windows
# verification record and the promote, so it needs Josh's go for these exact bytes:
# KOSMOS_WIN_PROD_APPROVED_SHA must equal this zip's sha256, and KOSMOS_WIN_PROD_APPROVAL_REF names
# his message (a Slack ts or permalink). It exists for what the staging loop cannot do, such as a
# rollback to a build from before this scheme (which has no verification record). The approval is
# logged like a promote's (path=direct) BEFORE anything is copied; a log that cannot be written
# refuses. 🛑 An agent never sets these without Josh's recorded go for this exact sha.
if [ "$CUT_CHANNEL" = prod ]; then
  . "$(cd "$(dirname "$0")" && pwd)/lib/win-approval.sh"
  # From stdin: no file name in the output, so no platform's name-escaping (GNU prefixes a line
  # with "\" for a name containing a backslash) can leak into the digest.
  ZIP_SHA="$(shasum -a 256 < "$ZIP" | awk '{print $1}')"
  if [ -z "${KOSMOS_WIN_PROD_APPROVED_SHA:-}" ] || [ -z "${KOSMOS_WIN_PROD_APPROVAL_REF:-}" ]; then
    echo "publish-win: REFUSING - Josh's go is required for a direct prod publish (KOSMOS_WIN_CUT_CHANNEL=prod skips staging and the verification). Set KOSMOS_WIN_PROD_APPROVED_SHA to the sha256 he approved and KOSMOS_WIN_PROD_APPROVAL_REF to his message's Slack ts or permalink, only once he has given it. Nothing was staged." >&2
    exit 1
  fi
  [ "$KOSMOS_WIN_PROD_APPROVED_SHA" = "$ZIP_SHA" ] || { echo "publish-win: REFUSING - KOSMOS_WIN_PROD_APPROVED_SHA ($KOSMOS_WIN_PROD_APPROVED_SHA) is not this zip's sha256. Josh's go covers one exact build; nothing was staged." >&2; exit 1; }
  win_approval_ref_ok "$KOSMOS_WIN_PROD_APPROVAL_REF" || { echo "publish-win: REFUSING - KOSMOS_WIN_PROD_APPROVAL_REF '$KOSMOS_WIN_PROD_APPROVAL_REF' is not a Slack message ts or permalink (letters, digits and . _ : / ? = & % # + - only). Nothing was staged." >&2; exit 1; }
  win_append_approval_line "$(date -u +%FT%TZ) family=win path=direct version=$VERSION sha256=$ZIP_SHA approval_ref=$KOSMOS_WIN_PROD_APPROVAL_REF approval=given" \
    || { echo "publish-win: REFUSING - could not record Josh's go in $WIN_APPROVAL_LOG (an approval that is not logged is not given). Nothing was staged." >&2; exit 1; }
  echo "publish-win: ==========================================================================" >&2
  echo "publish-win: BREAK-GLASS: a DIRECT PROD publish of $VERSION ($ZIP_SHA)." >&2
  echo "publish-win: It skips staging, the Windows verification record and the promote." >&2
  echo "publish-win: Josh's go ($KOSMOS_WIN_PROD_APPROVAL_REF) is logged in $WIN_APPROVAL_LOG." >&2
  echo "publish-win: ==========================================================================" >&2
fi

# Stage the names this channel owns from the one built zip. COPY, not link: the site deploy carries
# files, and a hard link would break once the shared dist is overwritten in place by a later publish.
# prod stages the alias (first, as it always has) and the versioned copy; staging stages ONLY the
# versioned copy. Both names are validated filename-safe tokens above, so the unquoted list splits
# exactly on the one space.
if [ "$CUT_CHANNEL" = prod ]; then
  cp "$ZIP" "$SITE/dist/$ALIAS"
  PUBLISHED_NAMES="$ALIAS $VERSIONED"
else
  PUBLISHED_NAMES="$VERSIONED"
fi
cp "$ZIP" "$SITE/dist/$VERSIONED"

# sha256 sidecar for each, NAMING its own file, and verified IN PLACE -- a pair that cannot
# verify itself is a refusal, not a publish (the lesson release.sh's sha256_publish_as records:
# a served .sha256 that names a different path fails `shasum -c` on good bytes).
for name in $PUBLISHED_NAMES; do
  ( cd "$SITE/dist" && shasum -a 256 "$name" > "$name.sha256" )
  ( cd "$SITE/dist" && shasum -a 256 --status -c "$name.sha256" ) \
    || { echo "publish-win: the sha256 pair for $name does not verify in place" >&2; exit 1; }
done

# The whole-artifact sha256, read from the versioned sidecar that both channels write (on prod the
# alias is the same bytes, so the same sha).
SHA="$(awk '{print $1}' "$SITE/dist/$VERSIONED.sha256")"
[ -n "$SHA" ] || { echo "publish-win: could not read the artifact sha256" >&2; exit 1; }

# The pointer (latest-win.json or latest-win-staging.json): mirrors latest.json so a consumer
# discovers the current Windows build without hardcoding a name (removing deploy-site.sh's
# KOSMOS_WIN_ZIP hardcode, #2014). `version` + `sha256` let a client verify what it downloaded and
# name the exact build in a report; `versioned` points at the pinned copy; `artifact` is the STABLE
# ALIAS the button fetches. ONE writer for both channels (tools/lib/write-latest-win-pointer.js), so
# a promote copies a staging pointer onto prod byte for byte.
KM_LWP_VERSION="$VERSION" KM_LWP_SHA="$SHA" KM_LWP_ARTIFACT="$ALIAS" KM_LWP_VERSIONED="$VERSIONED" KM_LWP_ARCH="$ARCH" \
  node "$(cd "$(dirname "$0")" && pwd)/lib/write-latest-win-pointer.js" "$SITE/dist/$POINTER_FILE" \
  || { echo "publish-win: could not write $POINTER_FILE" >&2; exit 1; }

if [ "$CUT_CHANNEL" = prod ]; then
  echo "publish-win: staged into $SITE/dist (NOT deployed):"
  echo "   alias:     $ALIAS ($SHA)"
  echo "   versioned: $VERSIONED"
  echo "   manifest:  latest-win.json -> $(cat "$SITE/dist/latest-win.json")"
  echo "publish-win: the next site deploy (release cut or tools/deploy-site.sh) carries these."
  echo "publish-win: serving is gated on the download button going live (#2007 launcher + #2008 alias)."
else
  echo "publish-win: staged into $SITE/dist on the STAGING channel (NOT deployed, NOT prod):"
  echo "   versioned: $VERSIONED ($SHA)"
  echo "   manifest:  $POINTER_FILE -> $(cat "$SITE/dist/$POINTER_FILE")"
  echo "   untouched: $ALIAS, its sidecar and latest-win.json (prod stays on its current build)."
  echo "publish-win: next: commit these and deploy (tools/deploy-site.sh) so the staged build is served, verify it on the Windows box (which writes its verification record), then, ONLY on Josh's go for this exact build:"
  echo "   tools/promote-channel.sh <site> --family win --approved-version <V> --approved-sha <the sha256 he approved> --approval-ref <his message's Slack ts or permalink>"
fi
