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
# ✅ --publish REVIEWED AND BLESSED (Baron, 2026-09-03, #2014). Baron owns the release/deploy
# pipeline and reviewed the --publish path: the pre-deploy fetch + per-artifact sha-verify +
# export + .vercelignore guard are exercised by the dry run (green), and the post-deploy served
# verification is sound -- served_matches sha-checks each installer artifact AND its .sha256
# sidecar against the LOCAL verified copy (which equals what was deployed, absent a concurrent
# cut -- the reason for the caveat below), the served latest.json is name-checked for the current
# artifact, and the Windows zip + /setup are 200-checked. It deliberately does NOT use
# verify-served.sh (that keys every expectation to agent-workforce's package.json, which in this
# standalone between-release window is routinely ahead of the site's released version -- the
# #2014 version-skew BLOCKER); it references the SITE's OWN version instead. --publish is safe.
# 🛑 STILL COORDINATE A PRODUCTION DEPLOY. --publish is a live `vercel deploy --prod`: do not run
# it concurrently with a release cut populating the same dist/ (see the concurrency note below),
# and coordinate with the release owner so two deploys cannot race. The dry run (default, no
# flag) remains safe -- it fetches, builds the export, runs every guard, and STOPS before deploy.
# =============================================================================
#
# Usage:
#   tools/deploy-site.sh              # DRY RUN: fetch + verify + export + guards, then stop
#   tools/deploy-site.sh --publish    # the same, then vercel deploy --prod, then verify SERVED bytes
#   tools/deploy-site.sh --promote    # PUBLISH a pointer-MOVE deploy (#2195): serve the COMMITTED
#                                     # latest.json even though it differs from live (a staging->prod
#                                     # promote, or a rollback to a prior pointer). Skips the
#                                     # committed-vs-live guard (the pointer moved on purpose),
#                                     # derives the artifact from the committed pointer, and derives
#                                     # the unversioned alias from the promoted bytes instead of
#                                     # fetching the stale live one. Run promote-channel.sh (#2036,
#                                     # which runs the experience + agent-spawn gates and refreshes
#                                     # the alias LOCALLY) and COMMIT latest.json first; this is the
#                                     # deploy that publishes it.
#
# NOTE ON THE SHELL: this is #!/bin/sh but sources two #!/bin/bash libraries (site-deploy.sh,
# pkg-inputs.sh) that use `local` and ${var:0:2} substrings, so it needs a bash-compatible /bin/sh.
# That holds on this macOS-only fleet (it already hardcodes $HOME/work/... and `shasum`); it would
# need a #!/bin/bash and rework to run under dash.
set -eu

SITE="${KOSMOS_SITE:-$HOME/work/chaoskosmos-site}"
REPO="${KOSMOS_REPO:-$HOME/work/agent-workforce}"
HOST="${KOSMOS_SITE_URL:-https://installkosmos.com}"
# 🛑 THIS COMMENT SAID "The Windows zip has no latest-win.json yet" AND THAT IS NO LONGER TRUE:
# dist/latest-win.json is tracked in the site checkout and served (200 application/json, measured
# 2026-09-09), and tools/publish-kosmos-windows.sh writes it precisely to remove this hardcode. The
# default below is still a hardcode and it is STALE (0.6.24, while latest-win.json says 0.6.37), so
# every check keyed to $WINZIP guards an artifact thirteen versions old. Learning the name from
# latest-win.json is the real fix and is carded; what this branch does instead is also check the
# UNVERSIONED alias below, which is the name users actually download and does not go stale.
WINZIP="${KOSMOS_WIN_ZIP:-kosmos-0.6.24-win-x64.zip}"

PUBLISH=0
PROMOTE=0
# --promote (#2195) is a POINTER-MOVE deploy: it publishes a latest.json that intentionally
# differs from the live one (a staging->prod promote, or a rollback to a prior pointer). It
# implies --publish (a promote deploys). promote-channel.sh (#2036) does the guarded LOCAL
# pointer move + alias refresh; this is the deploy that publishes it. Default PROMOTE=0 so the
# site-copy guard below stays armed for every ordinary deploy. Unknown args fall through to a
# dry run, exactly as before (no behaviour change for existing callers).
case "${1:-}" in
  --publish) PUBLISH=1 ;;
  --promote) PUBLISH=1; PROMOTE=1 ;;
esac

# --- preconditions -----------------------------------------------------------
git -C "$SITE" rev-parse --verify HEAD >/dev/null 2>&1 || { echo "deploy-site: $SITE is not a git checkout with a HEAD"; exit 1; }
[ -f "$SITE/.vercel/project.json" ] || { echo "deploy-site: no $SITE/.vercel/project.json; the CLI would not know the project"; exit 1; }
[ -f "$REPO/tools/lib/site-deploy.sh" ] || { echo "deploy-site: cannot find $REPO/tools/lib/site-deploy.sh"; exit 1; }
[ -f "$REPO/tools/lib/pkg-inputs.sh" ] || { echo "deploy-site: cannot find $REPO/tools/lib/pkg-inputs.sh (defines pkg_upload_filter_excludes)"; exit 1; }
[ -f "$REPO/tools/verify-served.sh" ]  || { echo "deploy-site: cannot find $REPO/tools/verify-served.sh"; exit 1; }
# #1667: served-verify helpers (negative control + content-type tell). Sourced HERE, in the
# preconditions, and not just before the post-deploy checks, because the negative control now runs
# BEFORE the first 200 from $HOST is trusted. See the call site above the latest.json read.
[ -f "$REPO/tools/lib/served-verify.sh" ] || { echo "deploy-site: cannot find $REPO/tools/lib/served-verify.sh (the #1667 negative control and content-type tell)"; exit 1; }
# shellcheck source=/dev/null
. "$REPO/tools/lib/served-verify.sh"
# sha256-name.sh is sourced ONLY on the --promote path (it derives the alias sidecar). Check it here,
# guarded on PROMOTE, so the failure is a clear up-front precondition rather than a cryptic set-e
# abort mid-run when the source fails -- matching the checks above for the other sourced libs.
[ "$PROMOTE" != 1 ] || [ -f "$REPO/tools/lib/sha256-name.sh" ] || { echo "deploy-site: --promote needs $REPO/tools/lib/sha256-name.sh (to derive the alias checksum), which is missing"; exit 1; }
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
# 🛑 #1667: PROVE THE HOST DISCRIMINATES BEFORE THE FIRST 200 IS TRUSTED, NOT ONLY AFTER THE DEPLOY.
# This control used to run ONLY at the end of the script, which made it unreachable in the exact
# shape the card measured. On a host-wide-blind $HOST (302 to an SSO page answering 200 text/html
# for EVERY path) the read below returns that page with a 200, `curl -f` does not fire, ptr_artifact
# finds no "artifact" field, and the script refuses with "latest.json names no artifact" -- a
# symptom, and precisely the wrong diagnosis this card exists to eliminate. Running it here costs
# one request, names the mechanism, and refuses BEFORE `vercel deploy --prod` rather than after, so
# it PREVENTS rather than reports.
# 📌 The post-deploy call stays and is not redundant: it asks a different question (is the host
# still sound now that we have published), and a host can go blind between the two.
served_verify_host_discriminates "$HOST" || { echo "deploy-site: refusing BEFORE any deploy -- the served-verify negative control failed against $HOST (see the reason above). Nothing has been deployed."; exit 1; }
LJ=$(curl -fsSL -H 'Cache-Control: no-cache' "$HOST/dist/latest.json") || { echo "deploy-site: cannot read $HOST/dist/latest.json -- refusing"; exit 1; }
# The COMMITTED pointer (git archive of $H) is what a deploy actually SERVES, because dist/latest.json
# is TRACKED. Read it once here for both the site-copy guard and the promote path. A git-show failure
# must not set-e abort before the friendly refuses below.
CJ=$(git -C "$SITE" show "$H:dist/latest.json" 2>/dev/null) || CJ=""
# Pull artifact/sha out of a pointer JSON. Tolerant of an optional space after the colon in case
# latest.json is ever pretty-printed; an empty result still refuses at the guards below (fail-safe).
ptr_artifact() { printf '%s' "$1" | sed -n 's/.*"artifact":[[:space:]]*"\([^"]*\)".*/\1/p'; }
ptr_sha()      { printf '%s' "$1" | sed -n 's/.*"sha256":[[:space:]]*"\([^"]*\)".*/\1/p'; }
ptr_version()  { printf '%s' "$1" | sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p'; }

if [ "$PROMOTE" = 1 ]; then
  # 🛑 A PROMOTE MOVES THE POINTER ON PURPOSE (#2195), so the committed-vs-live guard must NOT fire,
  # and the artifact comes from the COMMITTED pointer -- the version we are promoting TO -- not from
  # live, which is still the PRIOR prod version until this deploy publishes. The versioned artifact
  # is already SERVED from the staging cut; that is exactly what makes a promote a pointer-only move,
  # and it is why the fetch + sha-verify below still holds (the bytes exist on the live host). The
  # LOCAL pointer move + alias refresh are promote-channel.sh's job (#2036); this is the deploy that
  # publishes them.
  [ -n "$CJ" ] || { echo "deploy-site: --promote but the checkout has no committed dist/latest.json at $H -- refusing"; exit 1; }
  if [ "$CJ" = "$LJ" ]; then
    echo "deploy-site: --promote but the committed latest.json already equals LIVE -- nothing to promote. Run promote-channel.sh and COMMIT latest.json first (a deploy serves the committed pointer, not the working tree)."; exit 1
  fi
  ART=$(ptr_artifact "$CJ")
  [ -n "$ART" ] || { echo "deploy-site: --promote: the committed latest.json names no artifact -- refusing"; exit 1; }
  CSHA=$(ptr_sha "$CJ")
  [ -n "$CSHA" ] || { echo "deploy-site: --promote: the committed latest.json names no sha256 -- refusing"; exit 1; }
else
  ART=$(ptr_artifact "$LJ")
  [ -n "$ART" ] || { echo "deploy-site: latest.json names no artifact -- refusing"; exit 1; }
  # 🛑 COMMITTED-vs-LIVE POINTER GUARD (#2014 review). The served latest.json is the COMMITTED one
  # (git archive of $H). Compare the WHOLE committed pointer against live, not just the artifact name:
  # a rebuilt same-version tarball or a hand-edited pointer can drift in sha256/manifest under an
  # unchanged artifact name and ship a latest.json whose advertised sha256 does not match the served
  # tarball. If committed != live the checkout is stale or ahead of the current release, and a
  # site-copy deploy must never move the installer pointer -- refuse and sync the checkout first. A
  # copy/marketing change never touches dist/latest.json, so committed == live exactly in the intended
  # workflow and this never false-refuses. (Both sides are command-substitution captures, so a
  # trailing-newline difference cannot cause a false refusal.) A promote takes the branch above.
  [ "$CJ" = "$LJ" ] || { echo "deploy-site: the checkout's COMMITTED latest.json differs from LIVE -- refusing. The checkout is stale or ahead of the current release; a site-copy deploy must not move the installer pointer. Sync $SITE to the current release, then retry."; exit 1; }
fi
fetch "$HOST/dist/$ART"          "$SITE/dist/$ART"
fetch "$HOST/dist/$ART.sha256"   "$SITE/dist/$ART.sha256"
verify_sha "$SITE/dist/$ART" "$HOST/dist/$ART.sha256"
# For a promote, pin the committed pointer's advertised sha to the bytes we just fetched + verified:
# proves the committed latest.json describes REAL, SERVED bytes (guards a hand-edited or stale
# pointer that names a version whose bytes are not actually served). NOT keyed to latest-staging.json
# on purpose -- a rollback promotes a PRIOR pointer, not the current staging one, and must still work.
if [ "$PROMOTE" = 1 ]; then
  gotsha=$(shasum -a 256 "$SITE/dist/$ART" | awk '{print $1}')
  [ "$gotsha" = "$CSHA" ] || { echo "deploy-site: --promote: the committed latest.json advertises sha256 '$CSHA' but the served $ART hashes to '$gotsha' -- refusing (the pointer does not describe the served bytes)"; exit 1; }
fi

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
# tmux is version-INDEPENDENT (the installer fetches it on every install, of any version), so it is
# fetched live + verified in BOTH modes.
fetch "$HOST/dist/tmux-arm64.tar.gz"        "$SITE/dist/tmux-arm64.tar.gz"
fetch "$HOST/dist/tmux-arm64.tar.gz.sha256" "$SITE/dist/tmux-arm64.tar.gz.sha256"
verify_sha "$SITE/dist/tmux-arm64.tar.gz"   "$HOST/dist/tmux-arm64.tar.gz.sha256"

# The unversioned alias kosmos-arm64.tar.gz is the prod download fallback (old installers, and a
# modern install whose versioned fetch fails) and must track the CURRENT prod version.
if [ "$PROMOTE" = 1 ]; then
  # 🛑 On a promote the LIVE alias is still the PRIOR prod version (a staging cut deliberately leaves
  # it there -- release.sh gates the alias publish on a prod cut, so the promote is where it moves).
  # Fetching it would overwrite the promoted bytes with STALE ones and ship a stale fallback -- the
  # #1669 shape, one artifact over. DERIVE the alias from the just-fetched + verified versioned
  # artifact instead, so the served alias is byte-identical to the version we are promoting. This
  # mirrors promote-channel.sh's own alias refresh (#2036) and is self-contained: correct even if the
  # working-tree alias was never refreshed.
  cp "$SITE/dist/$ART" "$SITE/dist/kosmos-arm64.tar.gz" || { echo "deploy-site: --promote: could not derive the alias kosmos-arm64.tar.gz from $ART -- refusing"; exit 1; }
  # shellcheck source=/dev/null
  . "$REPO/tools/lib/sha256-name.sh"
  sha256_publish_as "$SITE/dist/$ART.sha256" "$SITE/dist/kosmos-arm64.tar.gz.sha256" "kosmos-arm64.tar.gz" \
    || { echo "deploy-site: --promote: could not write a verified kosmos-arm64.tar.gz.sha256 -- refusing"; exit 1; }
else
  # site-copy: the live alias IS the current prod version -- fetch + verify it, as before.
  fetch "$HOST/dist/kosmos-arm64.tar.gz"        "$SITE/dist/kosmos-arm64.tar.gz"
  fetch "$HOST/dist/kosmos-arm64.tar.gz.sha256" "$SITE/dist/kosmos-arm64.tar.gz.sha256"
  verify_sha "$SITE/dist/kosmos-arm64.tar.gz"   "$HOST/dist/kosmos-arm64.tar.gz.sha256"
fi
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
# (served-verify.sh is sourced up in the preconditions, because the negative control runs before
# the first read of $HOST as well as after the deploy.)
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
# ...and its sidecar, which had no PRE-deploy check while all four gitignored pairs above did. The
# post-deploy served-verify catches a missing one, but only AFTER `vercel deploy --prod` has run,
# which is the same "reports rather than prevents" shape #1667 is about. MEASURED before adding
# this, so it cannot refuse on a file the export never carries: dist/$WINZIP.sha256 is TRACKED in
# the site checkout (`git ls-files 'dist/*win*'`), so git archive carries it exactly like the zip.
# 🛑 THE UNVERSIONED WINDOWS ALIAS, which is what latest-win.json names as the download and what
# does NOT go stale on a version bump, unlike $WINZIP above. It was checked by nothing: this branch
# was about to ship a "check the pair" guard for a zip thirteen versions old while the artifact
# users actually fetch had no check at all. MEASURED before adding it, so it cannot refuse on
# something absent: dist/kosmos-win-x64.zip and its .sha256 are both TRACKED in the site checkout
# and both serve 200 (application/zip and application/octet-stream) from production.
[ -f "$EXPORT/dist/kosmos-win-x64.zip" ] || { echo "deploy-site: the export has no kosmos-win-x64.zip -- refusing (the unversioned Windows alias is the download latest-win.json names)"; rm -rf "$EXPORT"; exit 1; }
[ -f "$EXPORT/dist/kosmos-win-x64.zip.sha256" ] || { echo "deploy-site: the export has no kosmos-win-x64.zip.sha256 -- refusing (the installer verifies the alias against it)"; rm -rf "$EXPORT"; exit 1; }
[ -f "$EXPORT/dist/$WINZIP.sha256" ] || { echo "deploy-site: the export has no $WINZIP.sha256 -- refusing (the installer verifies the zip against it). Same cause as the line above if the Windows build was bumped: set KOSMOS_WIN_ZIP to the current name."; rm -rf "$EXPORT"; exit 1; }
[ -f "$EXPORT/.kosmos-release-export" ] || { echo "deploy-site: the export has no .kosmos-release-export marker -- refusing"; rm -rf "$EXPORT"; exit 1; }

# --- 4) the .vercelignore guard, exactly as the release runs it ---------------
DROP=$(pkg_upload_filter_excludes "$EXPORT/.vercelignore") || { echo "deploy-site: the export .vercelignore is missing or could not be evaluated -- refusing (a missing .vercelignore makes Vercel fall back to the site .gitignore, which drops dist/*.pkg)"; rm -rf "$EXPORT"; exit 1; }
[ -z "$DROP" ] || { echo "deploy-site: the export .vercelignore would drop $DROP -- refusing"; rm -rf "$EXPORT"; exit 1; }

if [ "$PUBLISH" != 1 ]; then
  echo "DRY RUN complete. The export carried Kosmos.pkg, the current tarball ($ART), tmux-arm64, the unversioned alias, the Windows zip, and an honest marker, and the .vercelignore guard passed. Re-run with --publish to deploy (or --promote to publish a moved pointer)."
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
# 🛑 #1667, POST-DEPLOY, AND THE SAME ORDERING MISTAKE AS BEFORE: this control used to sit at the
# BOTTOM of this block, after served_matches and the pointer check. If the host goes blind BETWEEN
# the pre-flight control and here (which is the only reason the second call exists), `curl -fsSL`
# succeeds with a 200 on the SSO page and the first refusal is "SERVED dist/$ART does not match what
# was deployed -- wrong bytes on the live site". A symptom, and the wrong diagnosis, exactly as the
# pre-deploy case was. A guard placed after the checks it would explain is not a guard.
served_verify_host_discriminates "$HOST" || { echo "deploy-site: refusing to certify the deploy -- the served-verify negative control failed (see above); the deploy already ran, investigate."; exit 1; }
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
# tracked / git-archive-shipped surfaces: git archive ships committed bytes deterministically, and a
# bytes-vs-agent-workforce compare is exactly the version-skew trap the verify-served.sh removal
# avoids. So each is checked with served_verify_asset_ok (a 200 AND a content-type that is NOT an
# html page). The win zip is under /dist; /setup is at the site root.
#
# #1667: a 200 only means a request SUCCEEDED, not that the asset you named exists -- on this infra a
# preview/deployment URL 302s to an SSO page that 200s (text/html) for EVERY path. $HOST is the
# production alias, which discriminates (a nonexistent path 404s), but PROVE that at runtime before
# trusting any 200 here rather than assuming the alias is still sound. served_verify_host_discriminates
# refuses if a path that cannot exist returns 200; served_verify_asset_ok also rejects a 200 carrying
# text/html. (tools/lib/served-verify.sh, sourced above.)
served_verify_asset_ok "$HOST/dist/$WINZIP" "the Windows zip $WINZIP" || { echo "deploy-site: the Windows zip $WINZIP failed served-verify (see the reason above); the deploy already ran -- investigate."; exit 1; }
# 🛑 THE SIDECAR, BECAUSE THE LOOP ABOVE SAYS "CHECK THE PAIR" AND THIS ONE PAIR WAS UNCHECKED. The
# rationale twenty lines up is that a sidecar-only serve drop breaks new-install verification while
# the artifact still serves; the win zip was the only served pair with no sidecar check.
# MEASURED against production before adding this, so it cannot be a refusal on an asset that was
# never served: installkosmos.com/dist/$WINZIP -> 200 application/zip, and its .sha256 -> 200
# application/octet-stream (not text/html, so the content-type tell passes it).
served_verify_asset_ok "$HOST/dist/kosmos-win-x64.zip" "the unversioned Windows alias" || { echo "deploy-site: the unversioned Windows alias kosmos-win-x64.zip failed served-verify (see the reason above); the deploy already ran -- investigate. This is the download latest-win.json names, and it does not go stale on a version bump the way \$WINZIP does."; exit 1; }
served_verify_asset_ok "$HOST/dist/kosmos-win-x64.zip.sha256" "the unversioned Windows alias checksum" || { echo "deploy-site: kosmos-win-x64.zip.sha256 failed served-verify (see the reason above); the deploy already ran -- investigate."; exit 1; }
served_verify_asset_ok "$HOST/dist/$WINZIP.sha256" "the Windows zip checksum $WINZIP.sha256" || { echo "deploy-site: the Windows zip checksum $WINZIP.sha256 failed served-verify (see the reason above); the deploy already ran -- investigate. A sidecar-only drop breaks new-install verification while the zip still serves."; exit 1; }
served_verify_asset_ok "$HOST/setup"        "/setup"                   || { echo "deploy-site: /setup failed served-verify (see the reason above); the deploy already ran -- investigate."; exit 1; }

echo "deploy-site: published and verified -- the site is live and the installers are still served."

# #2159: a --promote that moves the prod pointer FORWARD is a new release going live to users, so
# generate the release-notes social posts, exactly as a prod CUT does (release.sh's #2159 hook). A
# plain --publish is a same-version site-copy re-deploy (no new release), so it does NOT post -- only
# the PROMOTE path does. Like the cut hook, post-release-notes.sh is DRY-RUN by default and CANNOT
# auto-publish without the deliberate multi-gate (--publish AND KOSMOS_SOCIAL_AUTOPOST=1 AND live
# @installkosmos creds in the secrets map), so a promote PREVIEWS the notes and a bad note can never
# auto-publish. This closes the gap where a staging->prod promote (the launch flow) shipped a release
# to users but never announced it, while a direct prod cut did. Best-effort: the release has already
# shipped and been verified above, so a hook non-zero must never fail the promote.
#
# 🛑 A --promote can also be a ROLLBACK to a PRIOR pointer (see the --promote docs at the top). A
# rollback must NEVER announce "Kosmos <older> is out". So the hook fires only when the just-served
# version ($sj) is strictly NEWER than the version that was live BEFORE this deploy ($LJ, fetched at
# the top). A same-version re-point and a rollback both skip. `sort -V` is the version compare already
# used in tools/dist-retention.sh. If $LJ's version is unreadable (an anomaly the top-of-script fetch
# would normally have refused on), we SKIP rather than announce: without the prior version a rollback
# cannot be told from a forward move, and the whole point of this gate is that a rollback must not
# announce -- a missed announcement is safer than a wrong public one.
if [ "$PROMOTE" = 1 ]; then
  _pv="$(ptr_version "$sj")"   # the version this promote just made live
  _lv="$(ptr_version "$LJ")"   # the version that was live BEFORE this deploy
  if [ -z "$_pv" ]; then
    echo "post-release-notes: could not read the promoted version from the served latest.json -- skipping the notes hook (the promote still shipped and was verified)."
  elif [ -z "$_lv" ]; then
    echo "post-release-notes: could not read the previously-live version, so this cannot be confirmed a FORWARD promote rather than a rollback -- skipping the notes hook (a rollback must not announce; a missed announcement is safer than a wrong public one)."
  elif [ "$_pv" = "$_lv" ]; then
    echo "post-release-notes: promoted version $_pv matches the previously-live version -- not a new release, skipping the notes hook."
  elif [ "$(printf '%s\n%s\n' "$_lv" "$_pv" | sort -V | tail -1)" != "$_pv" ]; then
    echo "post-release-notes: promoted version $_pv is not newer than the previously-live $_lv (a rollback) -- skipping the notes hook (a rollback must not announce)."
  else
    echo ""
    KOSMOS_RELEASE_IS_PROD=1 KOSMOS_SITE="$SITE" bash "$REPO/tools/post-release-notes.sh" "$_pv" --publish \
      || echo "post-release-notes: hook returned non-zero (the promote still shipped; this is best-effort)"
  fi
fi
