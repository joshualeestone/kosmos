#!/usr/bin/env bash
# publish-staging-pointer.sh - kosmos#2036, the staging-channel WRITE side.
#
# Write `dist/latest-staging.json`, a SECOND pointer to an already-published versioned
# artifact, WITHOUT touching `dist/latest.json` (the prod pointer). It is deliberately a
# second POINTER, not a second build: staging and prod name the SAME bytes, so a build
# tested on staging can be promoted to prod unchanged (`promote-channel.sh`). The channel
# lives in which pointer you fetch, never in the artifact - so promotion never rebuilds.
#
# 🛑 IT DOES NOT DEPLOY. It stages `latest-staging.json` into the SITE CHECKOUT's dist/;
# the next site deploy carries it. Same boundary as tools/publish-kosmos-windows.sh (#2008).
#
# Usage:
#   tools/publish-staging-pointer.sh <site-checkout> [<version>]
#     <site-checkout>  the site whose dist/ holds the versioned artifact (default KOSMOS_SITE)
#     <version>        the build version; default: derived from the single
#                      kosmos-<V>-<arch>.tar.gz in dist/ (refuses if there is not exactly one)
set -uo pipefail

SITE="${1:-${KOSMOS_SITE:-$HOME/work/chaoskosmos-site}}"
ARCH="${KOSMOS_ARCH:-arm64}"
[ -d "$SITE/dist" ] || { echo "publish-staging: no $SITE/dist (is the site checkout present?)" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "publish-staging: node is required to write latest-staging.json" >&2; exit 1; }

# The version: explicit arg, or derived from the one versioned artifact in dist. Deriving
# refuses on zero or many, so this never guesses which build to point at.
V="${2:-}"
if [ -z "$V" ]; then
  set -- "$SITE"/dist/kosmos-*-"$ARCH".tar.gz
  if [ ! -e "$1" ]; then
    echo "publish-staging: no kosmos-*-$ARCH.tar.gz in $SITE/dist to derive a version from (pass <version>)" >&2; exit 1
  fi
  if [ "$#" -ne 1 ]; then
    echo "publish-staging: more than one kosmos-*-$ARCH.tar.gz in $SITE/dist; pass <version> to say which" >&2; exit 1
  fi
  base="${1##*/}"                       # kosmos-<V>-arm64.tar.gz
  V="${base#kosmos-}"; V="${V%-$ARCH.tar.gz}"
fi
[ -n "$V" ] || { echo "publish-staging: could not determine the version" >&2; exit 1; }

ARTIFACT="kosmos-$V-$ARCH.tar.gz"
MANIFEST="kosmos-$V-$ARCH.manifest.json"
[ -f "$SITE/dist/$ARTIFACT" ] || { echo "publish-staging: $SITE/dist/$ARTIFACT does not exist - nothing to point at" >&2; exit 1; }
# The pointer also advertises the manifest (a consumer fetches it to verify what it is
# running). Do not advertise a manifest that is not there - refuse if it is absent. release.sh
# emits it beside the artifact in the same cut, so a real staging publish always has it.
[ -f "$SITE/dist/$MANIFEST" ] || { echo "publish-staging: $SITE/dist/$MANIFEST (the manifest this pointer advertises) does not exist - refusing to advertise a missing manifest" >&2; exit 1; }

# The sha comes from the verified sidecar, exactly as release.sh's latest.json does, so a
# staging pointer cannot advertise a digest the served pair does not agree with. Verify the
# pair IN PLACE first (a pair that cannot verify itself is a refusal, not a publish).
[ -f "$SITE/dist/$ARTIFACT.sha256" ] || { echo "publish-staging: $ARTIFACT.sha256 sidecar is missing" >&2; exit 1; }
( cd "$SITE/dist" && shasum -a 256 --status -c "$ARTIFACT.sha256" ) \
  || { echo "publish-staging: the sha256 pair for $ARTIFACT does not verify in place - refusing to point at unverified bytes" >&2; exit 1; }
SHA="$(awk '{print $1}' "$SITE/dist/$ARTIFACT.sha256")"
[ -n "$SHA" ] || { echo "publish-staging: could not read the artifact sha256" >&2; exit 1; }

# Same shape as latest.json (release.sh ~730), so a consumer reads either pointer identically.
# Written ATOMICALLY (temp in the same dir + rename) so an interrupted write never leaves a
# truncated pointer that a deploy would carry. rename(2) within one directory is atomic.
PTMP="$(mktemp "$SITE/dist/.latest-staging.json.XXXXXX")" || { echo "publish-staging: could not make a temp file in $SITE/dist" >&2; exit 1; }
trap 'rm -f "$PTMP"' EXIT   # a signal between mktemp and the rename must not leak the temp
KM_LJ_VERSION="$V" KM_LJ_SHA="$SHA" KM_LJ_ARTIFACT="$ARTIFACT" KM_LJ_MANIFEST="$MANIFEST" \
  node -e '
    const e = process.env;
    require("node:fs").writeFileSync(process.argv[1], JSON.stringify({
      version: e.KM_LJ_VERSION,
      sha256: e.KM_LJ_SHA,
      artifact: e.KM_LJ_ARTIFACT,
      manifest: e.KM_LJ_MANIFEST,
    }) + "\n");
  ' "$PTMP" \
  && mv "$PTMP" "$SITE/dist/latest-staging.json" \
  || { echo "publish-staging: could not write latest-staging.json" >&2; rm -f "$PTMP"; exit 1; }

echo "publish-staging: wrote $SITE/dist/latest-staging.json (prod latest.json untouched):"
echo "   -> $(cat "$SITE/dist/latest-staging.json")"
echo "publish-staging: the next site deploy carries it; verify on a FRESH-state machine, then promote-channel.sh."
