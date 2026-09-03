#!/bin/sh
#
# deploy-site.sh -- deploy the marketing site (installkosmos.com) on its OWN clock,
# WITHOUT a Kosmos software release (#2014).
#
# WHY THIS EXISTS. Marketing and copy changes (terms and conditions, copy touch-ups)
# should ship on their own track, in minutes, not wait for a full software release cut.
# The release still owns building and publishing artifacts; this script owns publishing
# the SITE. tools/release.sh already deploys the site as a step (site_deploy_export +
# vercel deploy --prod); this is that step, standalone, without the release around it.
#
# =============================================================================
# 🛑 THE HAZARD, and the whole reason this is not a bare `vercel deploy --prod`.
# =============================================================================
# site_deploy_export (tools/lib/site-deploy.sh) carries the installer artifacts from the
# site's WORKING-TREE dist/. Those artifacts are gitignored, so a raw checkout has NONE.
# And the export does NOT refuse on their absence: it prints
#     "carried: no pkg (dist/Kosmos.pkg is not in the site dist)"
# and PROCEEDS. That single line is the #1669 outage: a deploy from an unpopulated checkout
# replaced the live site with the tracked-only copy and every download 404'd for ~13 hours
# (2026-08-31). The file's own comment: "NOTHING REFUSED IT AND NOTHING COULD HAVE, because
# 'is this directory a release export?' was not an answerable question."
#
# 🔑 KEEP THE MARKER HONEST. .kosmos-release-export is the ONLY positive evidence that the
# carry step actually ran, and the deploy gate requires it. So this script must NEVER
# fabricate or bypass it. It FETCHES the current live artifacts into dist/ and VERIFIES
# them by sha, THEN lets site_deploy_export carry them and write the marker legitimately.
# The tempting shortcut -- set the marker and skip the fetch -- is exactly what re-opens
# the outage. The fetch is not caution; it is what makes the marker truthful.
#
# =============================================================================
# 🛑 REVIEW GATE. Baron owns the release/deploy pipeline. Do NOT run --publish against
# prod until he has reviewed this script. The dry run (default, no flag) is safe: it
# fetches, builds the export, runs every guard, and STOPS before any deploy.
# =============================================================================
#
# Usage:
#   tools/deploy-site.sh              # DRY RUN: fetch + verify + export + guards, then stop
#   tools/deploy-site.sh --publish    # the same, then vercel deploy --prod, then verify SERVED bytes
#
# NOTE ON THE SHELL: this is #!/bin/sh but sources two #!/bin/bash libraries (site-deploy.sh,
# pkg-inputs.sh) that use `local` and ${var:0:2} substrings, so it needs a bash-compatible /bin/sh.
# That holds on this macOS-only fleet (it already hardcodes $HOME/work/... and `shasum`); it would
# need a #!/bin/bash and rework to run under dash.
set -eu

SITE="${KOSMOS_SITE:-$HOME/work/chaoskosmos-site}"
REPO="${KOSMOS_REPO:-$HOME/work/agent-workforce}"
HOST="${KOSMOS_SITE_URL:-https://installkosmos.com}"
# The Windows zip has no latest-win.json yet, so its name is a parameter with the current
# default. Baron: a latest-win.json manifest (like latest.json) would remove this hardcode
# and let the script learn the current Windows artifact the same way it learns the tarball.
WINZIP="${KOSMOS_WIN_ZIP:-kosmos-0.6.24-win-x64.zip}"

PUBLISH=0
[ "${1:-}" = "--publish" ] && PUBLISH=1

# --- preconditions -----------------------------------------------------------
git -C "$SITE" rev-parse --verify HEAD >/dev/null 2>&1 || { echo "deploy-site: $SITE is not a git checkout with a HEAD"; exit 1; }
[ -f "$SITE/.vercel/project.json" ] || { echo "deploy-site: no $SITE/.vercel/project.json; the CLI would not know the project"; exit 1; }
[ -f "$REPO/tools/lib/site-deploy.sh" ] || { echo "deploy-site: cannot find $REPO/tools/lib/site-deploy.sh"; exit 1; }
[ -f "$REPO/tools/lib/pkg-inputs.sh" ] || { echo "deploy-site: cannot find $REPO/tools/lib/pkg-inputs.sh (defines pkg_upload_filter_excludes)"; exit 1; }
[ -f "$REPO/tools/verify-served.sh" ]  || { echo "deploy-site: cannot find $REPO/tools/verify-served.sh"; exit 1; }
command -v vercel >/dev/null 2>&1 || { echo "deploy-site: vercel CLI not found"; exit 1; }

# --- 1) fetch and verify the CURRENT live artifacts into the site dist/ -------
# The export carries whatever is in dist/. We make the critical current artifacts present
# and correct so the deploy cannot drop them; a stale or empty checkout is then safe.
fetch() {  # <url> <dest>  -- refuse on any failure, because a missing artifact drops from live
  # -fsSL follows redirects (#2014 review): HOST defaults to installkosmos.com (no redirect), but
  # if KOSMOS_SITE_URL is ever pointed at chaoskosmos.com it 308-redirects /dist, and without -L
  # this would fetch a 15-byte "Redirecting..." stub and refuse (or verify) against the wrong bytes.
  # -H no-cache: a stale CDN copy would drive a false refuse or verify a stale artifact; the rest of
  # the pipeline (verify-served.sh, pkg-inputs) sends it too, so match them.
  curl -fsSL -H 'Cache-Control: no-cache' "$1" -o "$2" || { echo "deploy-site: could not fetch $1 -- refusing (a missing artifact would drop from the live site)"; exit 1; }
}
verify_sha() {  # <file> <sha256-url>
  want=$(curl -fsSL -H 'Cache-Control: no-cache' "$2" 2>/dev/null | awk '{print $1}')
  got=$(shasum -a 256 "$1" | awk '{print $1}')
  [ -n "$want" ] && [ "$got" = "$want" ] || { echo "deploy-site: sha mismatch for $1 (want '$want' got '$got') -- refusing"; exit 1; }
}

mkdir -p "$SITE/dist"

# PIN THE COMMIT ONCE (#2014 review). site_deploy_export takes an explicit commit arg precisely
# because the site checkout is shared and a commit can land between a read and the archive
# (site-deploy.sh:38-45). Read HEAD once and use $H for BOTH the pointer guard below and the export
# call, so the guard validates exactly the commit that ships.
H=$(git -C "$SITE" rev-parse HEAD 2>/dev/null) || { echo "deploy-site: cannot resolve HEAD in $SITE -- refusing"; exit 1; }
[ -n "$H" ] || { echo "deploy-site: empty HEAD in $SITE -- refusing"; exit 1; }

# The current release tarball is GITIGNORED, so it is carried from the working tree and MUST be
# fetched + verified. dist/latest.json (the served download pointer) is TRACKED, so
# site_deploy_export ships the COMMITTED copy via git archive, NOT the working-tree copy -- which is
# the trap the guard below closes. Tracked artifacts are NEVER fetched into the shared checkout
# (that would leave dirty tracked files a later `git commit -a` could sweep up); only the gitignored
# set is fetched, and every fetched byte is sha-verified.
LJ=$(curl -fsSL -H 'Cache-Control: no-cache' "$HOST/dist/latest.json") || { echo "deploy-site: cannot read $HOST/dist/latest.json -- refusing"; exit 1; }
# tolerant of an optional space after the colon in case latest.json is ever pretty-printed; an empty
# result still refuses at the [ -n "$ART" ] guard (fail-safe).
ART=$(printf '%s' "$LJ" | sed -n 's/.*"artifact":[[:space:]]*"\([^"]*\)".*/\1/p')
[ -n "$ART" ] || { echo "deploy-site: latest.json names no artifact -- refusing"; exit 1; }
# 🛑 COMMITTED-vs-LIVE POINTER GUARD (#2014 review). The served latest.json is the COMMITTED one
# (git archive of $H). Compare the WHOLE committed pointer against live, not just the artifact name:
# a rebuilt same-version tarball or a hand-edited pointer can drift in sha256/manifest under an
# unchanged artifact name and ship a latest.json whose advertised sha256 does not match the served
# tarball. If committed != live the checkout is stale or ahead of the current release, and a
# site-copy deploy must never move the installer pointer -- refuse and sync the checkout first. A
# copy/marketing change never touches dist/latest.json, so committed == live exactly in the intended
# workflow and this never false-refuses. (Both sides are command-substitution captures, so a
# trailing-newline difference cannot cause a false refusal.)
CJ=$(git -C "$SITE" show "$H:dist/latest.json" 2>/dev/null) || CJ=""   # a git-show failure must not set-e abort before the friendly refuse below
[ "$CJ" = "$LJ" ] || { echo "deploy-site: the checkout's COMMITTED latest.json differs from LIVE -- refusing. The checkout is stale or ahead of the current release; a site-copy deploy must not move the installer pointer. Sync $SITE to the current release, then retry."; exit 1; }
fetch "$HOST/dist/$ART"          "$SITE/dist/$ART"
fetch "$HOST/dist/$ART.sha256"   "$SITE/dist/$ART.sha256"
verify_sha "$SITE/dist/$ART" "$HOST/dist/$ART.sha256"

# the macOS pkg triple (fixed names)
for f in Kosmos.pkg Kosmos.pkg.sha256 Kosmos.pkg.inputs; do
  fetch "$HOST/dist/$f" "$SITE/dist/$f"
done
verify_sha "$SITE/dist/Kosmos.pkg" "$HOST/dist/Kosmos.pkg.sha256"

# The Windows zip (and its .sha256) are TRACKED, so git archive ships the COMMITTED copies and the
# honest-marker check below confirms the zip was carried. It is deliberately NOT fetched: fetching a
# tracked path would overwrite a tracked file in the shared checkout with unverified bytes. #2008
# (an unversioned win alias) is the durable fix for the hardcoded $WINZIP name; until then a
# committed win zip whose name differs from $WINZIP is caught by the honest-marker check (refuse).

# the tmux runtime + the unversioned alias tarball (#2014 review, BLOCKER). site_deploy_export
# carries dist/*.tar.gz by a GLOB (tools/lib/site-deploy.sh:78), so ANY tarball absent from the
# checkout DROPS from the deploy. Both of these are new-install-critical: the installer fetches
# tmux-arm64 on every install (install/setup.sh:821) and falls back to the unversioned
# kosmos-arm64 alias (setup.sh:898). Dropping either is the #1669 shape, one artifact over.
# (arm64 only: tmux-x64 is not served -- measured 404 -- because the installer target is macOS.)
for f in tmux-arm64.tar.gz tmux-arm64.tar.gz.sha256 kosmos-arm64.tar.gz kosmos-arm64.tar.gz.sha256; do
  fetch "$HOST/dist/$f" "$SITE/dist/$f"
done
verify_sha "$SITE/dist/tmux-arm64.tar.gz"   "$HOST/dist/tmux-arm64.tar.gz.sha256"
verify_sha "$SITE/dist/kosmos-arm64.tar.gz" "$HOST/dist/kosmos-arm64.tar.gz.sha256"
# Historical version tarballs (kosmos-0.6.08-arm64.tar.gz ..) are gitignored rollback URLs and are
# DELIBERATELY OUT OF SCOPE here: rollback-only, not new-install-critical. A clean checkout drops
# them (breaking a rollback link, not a new install). There is no manifest of the full set, so they
# are not enumerable here; if rollback coverage is ever needed, fetch them the same way.

echo "deploy-site: fetched and verified the current live GITIGNORED artifacts into $SITE/dist/"
# ⚠️ This wrote into the SHARED site checkout's dist/ (also the live board, also shared with
# tools/release.sh), but ONLY gitignored artifacts (the tarball, pkg triple, tmux, alias) -- each
# sha-verified against live, and none of them tracked, so `git status` stays clean and no later
# `git commit -a` can sweep them up. It is still not side-effect-free on the filesystem, so do not
# run a --publish concurrently with a release cut populating the same dist/.

# --- 2) build the export (carries pages + artifacts, writes the marker) -------
# shellcheck source=/dev/null
. "$REPO/tools/lib/site-deploy.sh"
# pkg_upload_filter_excludes (the .vercelignore guard, step 4) lives in pkg-inputs.sh, NOT
# site-deploy.sh -- release.sh sources both. Sourcing only site-deploy.sh left the guard call as a
# "command not found" that the release path never hits because it sources pkg-inputs.sh first.
# shellcheck source=/dev/null
. "$REPO/tools/lib/pkg-inputs.sh"
EXPORT=$(mktemp -d "${TMPDIR:-/tmp}/deploy-site.XXXXXX")
site_deploy_export "$SITE" "$EXPORT" "$H" || { echo "deploy-site: site_deploy_export failed -- nothing deployed"; rm -rf "$EXPORT"; exit 1; }

# --- 3) HONEST-MARKER check: the export MUST have carried the critical artifacts ----
# If it did not, the .kosmos-release-export marker would be a rubber stamp and the deploy
# would drop the download. Refuse rather than ship a marker that lies.
[ -f "$EXPORT/dist/Kosmos.pkg" ] || { echo "deploy-site: the export did not carry Kosmos.pkg -- refusing (the marker would be dishonest and the macOS download would drop)"; rm -rf "$EXPORT"; exit 1; }
[ -f "$EXPORT/dist/$ART" ]       || { echo "deploy-site: the export did not carry the current tarball $ART -- refusing"; rm -rf "$EXPORT"; exit 1; }
[ -f "$EXPORT/dist/tmux-arm64.tar.gz" ]   || { echo "deploy-site: the export did not carry tmux-arm64.tar.gz -- refusing (the installer fetches it on every install; #2014 review)"; rm -rf "$EXPORT"; exit 1; }
[ -f "$EXPORT/dist/kosmos-arm64.tar.gz" ] || { echo "deploy-site: the export did not carry the unversioned alias kosmos-arm64.tar.gz -- refusing (setup.sh's cache-busted fallback; #2014 review)"; rm -rf "$EXPORT"; exit 1; }
# the .sha256 sidecars the installer verifies each gitignored tarball against: gitignored and
# glob-carried like the tarballs, so a missing one drops the same way. Check them too.
for s in "$ART.sha256" Kosmos.pkg.sha256 tmux-arm64.tar.gz.sha256 kosmos-arm64.tar.gz.sha256; do
  [ -f "$EXPORT/dist/$s" ] || { echo "deploy-site: the export did not carry the checksum $s -- refusing (the installer verifies against it)"; rm -rf "$EXPORT"; exit 1; }
done
# The Windows zip is TRACKED (git archive carries the committed copy). A refusal here almost always
# means the committed win-zip name no longer matches the hardcoded $WINZIP after a version bump
# (#2008), NOT a genuine carry failure.
[ -f "$EXPORT/dist/$WINZIP" ]    || { echo "deploy-site: the export has no $WINZIP -- refusing. If the Windows build was bumped, the committed zip name changed and the hardcoded default is stale (#2008); set KOSMOS_WIN_ZIP to the current name or land the unversioned alias."; rm -rf "$EXPORT"; exit 1; }
[ -f "$EXPORT/.kosmos-release-export" ] || { echo "deploy-site: the export has no .kosmos-release-export marker -- refusing"; rm -rf "$EXPORT"; exit 1; }

# --- 4) the .vercelignore guard, exactly as the release runs it ---------------
DROP=$(pkg_upload_filter_excludes "$EXPORT/.vercelignore") || { echo "deploy-site: the export .vercelignore is missing or could not be evaluated -- refusing (a missing .vercelignore makes Vercel fall back to the site .gitignore, which drops dist/*.pkg)"; rm -rf "$EXPORT"; exit 1; }
[ -z "$DROP" ] || { echo "deploy-site: the export .vercelignore would drop $DROP -- refusing"; rm -rf "$EXPORT"; exit 1; }

if [ "$PUBLISH" != 1 ]; then
  echo "DRY RUN complete. The export carried Kosmos.pkg, the current tarball ($ART), tmux-arm64, the unversioned alias, the Windows zip, and an honest marker, and the .vercelignore guard passed. Re-run with --publish to deploy."
  rm -rf "$EXPORT"   # a dry run leaves no temp dir behind; the summary above is the artifact
  exit 0
fi

# --- 5) deploy ---------------------------------------------------------------
( cd "$EXPORT" && vercel deploy --prod --yes ) || { echo "deploy-site: vercel deploy --prod failed"; rm -rf "$EXPORT"; exit 1; }
rm -rf "$EXPORT"

# --- 6) verify the SERVED bytes against WHAT WE DEPLOYED, by FETCHING them --------------------
# The failure mode is a perfectly rendered page with dead download buttons; only fetching the
# artifacts and checking the bytes catches it.
# 🛑 NOT tools/verify-served.sh here (#2014 review, BLOCKER). That verifier keys EVERY version
# expectation to agent-workforce's package.json, which in this standalone between-release window is
# routinely AHEAD of the site's released version (measured: package.json 0.6.26 vs live 0.6.25). It
# would 404 on kosmos-<newer>-arm64.tar.gz and fail the latest.json version grep on a PERFECTLY GOOD
# site-copy deploy -- crying the #1669 wolf on essentially every intended use. The correct reference
# is the site's OWN version ($ART, from the live latest.json this script already validated). We
# fetched + sha-verified each gitignored artifact pre-deploy, so confirm the SERVED copy of each
# matches the LOCAL verified copy by sha (a drop 404s the fetch; wrong bytes fail the sha).
served_matches() {  # <path-under-dist> <local-verified-file>
  t=$(mktemp "${TMPDIR:-/tmp}/deploy-site-served.XXXXXX")
  curl -fsSL -H 'Cache-Control: no-cache' "$HOST/dist/$1" -o "$t" || { echo "deploy-site: SERVED dist/$1 could not be fetched after deploy (dropped? this is the #1669 shape) -- investigate."; rm -f "$t"; exit 1; }
  ss=$(shasum -a 256 < "$t" | awk '{print $1}'); rm -f "$t"
  ll=$(shasum -a 256 < "$2" | awk '{print $1}')
  [ "$ss" = "$ll" ] || { echo "deploy-site: SERVED dist/$1 does not match what was deployed (served '$ss' local '$ll') -- wrong bytes on the live site. Investigate."; exit 1; }
}
# each gitignored installer artifact AND its .sha256 sidecar: the installer fetches both and verifies
# one against the other, so a sidecar-only serve drop would break new-install verification while the
# tarball still serves. Check the pair.
for f in "$ART" Kosmos.pkg tmux-arm64.tar.gz kosmos-arm64.tar.gz; do
  served_matches "$f"        "$SITE/dist/$f"
  served_matches "$f.sha256" "$SITE/dist/$f.sha256"
done
# the served latest.json (tracked, committed) must still name $ART after the deploy.
sj=$(curl -fsSL -H 'Cache-Control: no-cache' "$HOST/dist/latest.json") || { echo "deploy-site: could not re-read the served latest.json after deploy -- investigate."; exit 1; }
printf '%s' "$sj" | grep -q "\"$ART\"" || { echo "deploy-site: the served latest.json no longer names $ART after deploy -- investigate."; exit 1; }
# tracked / git-archive-shipped surfaces: a 200 is enough -- git archive ships committed bytes
# deterministically, and a bytes-vs-agent-workforce compare is exactly the version-skew trap the
# verify-served.sh removal avoids. The win zip is under /dist; /setup is at the site root.
served_200() {  # <full-url> <label>
  c=$(curl -sSL -H 'Cache-Control: no-cache' -o /dev/null -w '%{http_code}' "$1") || { echo "deploy-site: could not reach $1 to confirm it is served (transport error) -- investigate; the deploy already ran."; exit 1; }
  [ "$c" = "200" ] || { echo "deploy-site: $2 is NOT served ($c) after deploy -- investigate."; exit 1; }
}
served_200 "$HOST/dist/$WINZIP" "the Windows zip $WINZIP"
served_200 "$HOST/setup"        "/setup"

echo "deploy-site: published and verified -- the site is live and the installers are still served."
