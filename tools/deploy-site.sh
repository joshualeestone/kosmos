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
# The Windows zip name. #2571: dist/latest-win.json NOW EXISTS (tracked + served), written by
# tools/publish-kosmos-windows.sh, so the current versioned name is DERIVED from it below (after
# $H and the ptr_* helpers), the same way the tarball name is learned from latest.json. This line
# is now the FALLBACK: an explicit KOSMOS_WIN_ZIP overrides the derivation, and this hardcoded
# default is used only when latest-win.json cannot be read (an older checkout). It is left at the
# old 0.6.24 name on purpose, so an ancient checkout REFUSES loudly at the carry check rather than
# guessing a name that happens to match. (#2580 also honest-marker-checks the UNVERSIONED alias
# kosmos-win-x64.zip separately, which never goes stale; that stays, alongside this derivation.)
WINZIP="${KOSMOS_WIN_ZIP:-kosmos-0.6.24-win-x64.zip}"

PUBLISH=0
PROMOTE=0
FORCE=0
# --promote (#2195) is a POINTER-MOVE deploy: it publishes a latest.json that intentionally
# differs from the live one (a staging->prod promote, or a rollback to a prior pointer). It
# implies --publish (a promote deploys). promote-channel.sh (#2036) does the guarded LOCAL
# pointer move + alias refresh; this is the deploy that publishes it. Default PROMOTE=0 so the
# site-copy guard below stays armed for every ordinary deploy. Unknown args fall through to a
# dry run, exactly as before (no behaviour change for existing callers).
# #3073: --force overrides the non-main-branch publish guard below (a deliberate one-off exception).
# Parsed with a LOOP rather than a bare `case $1` so --force can sit in any position
# (`--publish --force`); the previous single-arg callers (`--publish` / `--promote` as $1) are
# unaffected, and an unknown arg still falls through to a dry run exactly as before.
for _arg in "$@"; do
  case "$_arg" in
    --publish) PUBLISH=1 ;;
    --promote) PUBLISH=1; PROMOTE=1 ;;
    --force)   FORCE=1 ;;
  esac
done

# --- preconditions -----------------------------------------------------------
git -C "$SITE" rev-parse --verify HEAD >/dev/null 2>&1 || { echo "deploy-site: $SITE is not a git checkout with a HEAD"; exit 1; }
# #3073: deploy ONLY from the site's default branch. chaoskosmos-site is deployed from separate
# feature branches, each carrying a FULL index.html, and `--publish` ships the whole site dir -- so
# a feature-branch deploy silently clobbers whatever the previous branch published. That is the
# 2026-09-14 investor-facing regression this card was filed for: a later deploy of the
# created-count-3038 branch (whose index.html predated the Windows-button fix) re-published an
# index.html WITHOUT that fix, reverting it live while Josh had investors on the page. Refuse a
# publishing run (--publish or --promote) from a non-default SITE branch; --force is the deliberate
# one-off escape hatch. A DRY RUN (no --publish) deploys nothing and is unaffected -- it may run
# from any branch. Placed here, right after the SITE-is-a-checkout precondition and before the
# fetch/verify/export work, so it refuses up front rather than after minutes of work.
if [ "$PUBLISH" = 1 ] && [ "$FORCE" != 1 ]; then
  # symbolic-ref --quiet exits non-zero on a detached HEAD; `|| true` keeps set -e from aborting and
  # leaves _site_branch empty, which is treated as "not the default branch" -> refuse (safe: a
  # detached-HEAD publish is exactly as clobber-prone as a feature-branch one).
  _site_branch=$(git -C "$SITE" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
  # The default branch is read from the site checkout's own origin/HEAD, not hardcoded, so a repo
  # whose default is not "main" still works; fall back to main only when origin/HEAD is unset.
  _default_branch=$(git -C "$SITE" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')
  [ -n "$_default_branch" ] || _default_branch=main
  if [ "$_site_branch" != "$_default_branch" ]; then
    echo "deploy-site: refusing to publish from '${_site_branch:-a detached HEAD}' -- the site checkout $SITE is not on '$_default_branch' (#3073)."
    echo "  Deploying a feature branch ships its full index.html and silently clobbers the live site's state (the 2026-09-14 investor-facing regression)."
    echo "  Merge to '$_default_branch' and deploy from there, or pass --force for a deliberate one-off exception."
    exit 1
  fi
fi
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
# The two non-zero codes mean different things and the refusal should not conflate them: 1 is a
# BLIND host (the #1667 shape, a real finding), 2 is "the probe could not run" (a network blip, and
# the caller cannot conclude either way). Both refuse, because refusing before a deploy on an
# unprovable host is the safe direction, but they are named apart.
# 📌 AND ONLY HERE, DELIBERATELY, WHICH IS WORTH SAYING BECAUSE THE ASYMMETRY LOOKS LIKE AN
# OVERSIGHT. This is the one call where the distinction changes what the operator DOES: nothing has
# been deployed, so a blip means retry and a blind host means stop. The two post-deploy calls both
# mean "the deploy already ran, investigate" whichever code came back, and the library's own stderr
# line already says "failed at the transport layer" when it was a blip.
served_verify_host_discriminates "$HOST" || { _svrc=$?; if [ "$_svrc" -eq 2 ]; then echo "deploy-site: refusing BEFORE any deploy -- the served-verify negative control could not RUN against $HOST (transport error, see above), so nothing about this host is proven either way. Nothing has been deployed."; else echo "deploy-site: refusing BEFORE any deploy -- the served-verify negative control FAILED against $HOST (see the reason above): the host answered 200 for a path that cannot exist. Nothing has been deployed."; fi; exit 1; }
LJ=$(curl -fsSL -H 'Cache-Control: no-cache' "$HOST/dist/latest.json") || { echo "deploy-site: cannot read $HOST/dist/latest.json -- refusing"; exit 1; }
# The COMMITTED pointer (git archive of $H) is what a deploy actually SERVES, because dist/latest.json
# is TRACKED. Read it once here for both the site-copy guard and the promote path. A git-show failure
# must not set-e abort before the friendly refuses below.
CJ=$(git -C "$SITE" show "$H:dist/latest.json" 2>/dev/null) || CJ=""
# Pull artifact/sha out of a pointer JSON. Tolerant of an optional space after the colon in case
# latest.json is ever pretty-printed; an empty result still refuses at the guards below (fail-safe).
ptr_artifact()  { printf '%s' "$1" | sed -n 's/.*"artifact":[[:space:]]*"\([^"]*\)".*/\1/p'; }
ptr_sha()       { printf '%s' "$1" | sed -n 's/.*"sha256":[[:space:]]*"\([^"]*\)".*/\1/p'; }
ptr_version()   { printf '%s' "$1" | sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p'; }
ptr_versioned() { printf '%s' "$1" | sed -n 's/.*"versioned":[[:space:]]*"\([^"]*\)".*/\1/p'; }
# The version inside a Windows zip NAME (kosmos-<version>-win-x64.zip), empty if it is not that shape.
win_zip_version() { printf '%s' "$1" | sed -n 's/^kosmos-\(.*\)-win-x64\.zip$/\1/p'; }

# #2571: DERIVE the current Windows versioned zip name from latest-win.json, the same way ART is
# learned from latest.json above -- replacing the stale hardcoded $WINZIP (kosmos-0.6.24, while
# latest-win.json names the current version). latest-win.json is TRACKED, so git archive ships the
# COMMITTED copy; read that one ($H), matching what the deploy actually serves.
#
# 🔑 AND IT IS AN INSTRUMENT, not just a name lookup. The derived name is trusted ONLY when the
# committed latest-win.json's sha256 EQUALS the hash of the ACTUAL committed versioned-zip BYTES
# (git show | shasum, below) -- a pointer-vs-committed-BYTES AGREEMENT check. A drifted pointer (a
# partial publish-kosmos-windows.sh run, or a hand-edited manifest/blob) REFUSES here rather than
# silently deriving a name whose bytes do not match.
#
# ⚠️ SCOPE, stated precisely so the guarantee is not over-read: this closes INTERNAL
# pointer-vs-bytes drift WITHIN the committed checkout. It does NOT compare the committed
# latest-win.json against LIVE the way the tarball's CJ-vs-LJ guard does, and that is deliberate:
# there is no --promote-style intentional-move flag for the Windows pointer, so a committed-vs-live
# win check would FALSE-REFUSE a legitimate win-publish deploy (publish-kosmos-windows.sh commits a
# new win pointer that differs from live BEFORE it is deployed). Checkout FRESHNESS (is $SITE at
# origin/main?) is the deploy's own site-freshness precondition, not this block's job. The residual
# is therefore: a checkout current for the mac pointer but stale specifically for the win side
# derives an internally-consistent but stale win name -- bounded by keeping $SITE fresh before a
# deploy, not by this check. An explicit KOSMOS_WIN_ZIP overrides everything (operator escape hatch).
#
# ONE derivation for BOTH Windows pointers: latest-win.json (prod) and latest-win-staging.json (the
# staged build publish-kosmos-windows.sh writes by default). derive_committed_win_versioned
# <pointer-name> returns 1 when the checkout has no such committed pointer; otherwise it REFUSES
# (exit) on any disagreement, or sets DERIVED_WIN_VERSIONED to the sha-verified versioned zip name.
derive_committed_win_versioned() {
  _dw_pointer=$1; DERIVED_WIN_VERSIONED=""
  _dw_json=$(git -C "$SITE" show "$H:dist/$_dw_pointer" 2>/dev/null) || _dw_json=""
  [ -n "$_dw_json" ] || return 1
  _dw_versioned=$(ptr_versioned "$_dw_json"); _dw_sha=$(ptr_sha "$_dw_json")
  [ -n "$_dw_versioned" ] && [ -n "$_dw_sha" ] || { echo "deploy-site: committed dist/$_dw_pointer names no versioned/sha256 -- refusing (#2571). Re-run tools/publish-kosmos-windows.sh so the manifest is complete."; exit 1; }
  # The committed versioned zip must EXIST as a tracked blob at $H (git archive ships it).
  git -C "$SITE" cat-file -e "$H:dist/$_dw_versioned" 2>/dev/null || { echo "deploy-site: $_dw_pointer names $_dw_versioned, which is not committed in the site checkout at $H -- refusing (#2571). Re-run tools/publish-kosmos-windows.sh so the manifest and the zip agree."; exit 1; }
  # Hash the ACTUAL committed zip BYTES (git show streams the blob), not just the string recorded
  # in the .sha256 sidecar -- so a zip whose bytes were altered without touching the manifest OR
  # the sidecar (a bad rebase / hand-edit of the tracked blob) is still caught. This is the TRUE
  # pointer-vs-committed-bytes agreement; comparing to the sidecar alone would only prove
  # pointer-vs-sidecar and miss a bytes-only divergence. The pipe's exit is awk's (the last stage,
  # always 0), so a git-show failure does not abort under set -e -- but cat-file -e above has
  # already proven the blob exists.
  _dw_bytes_sha=$(git -C "$SITE" show "$H:dist/$_dw_versioned" 2>/dev/null | shasum -a 256 | awk '{print $1}')
  [ "$_dw_sha" = "$_dw_bytes_sha" ] || { echo "deploy-site: $_dw_pointer (sha $_dw_sha) DISAGREES with the committed bytes of $_dw_versioned (got ${_dw_bytes_sha:-none}) -- refusing (#2571). The Windows pointer and its versioned zip are out of sync; re-run tools/publish-kosmos-windows.sh so $_dw_pointer and the zip agree."; exit 1; }
  DERIVED_WIN_VERSIONED=$_dw_versioned
}
if [ -z "${KOSMOS_WIN_ZIP:-}" ]; then
  if derive_committed_win_versioned latest-win.json; then
    WINZIP="$DERIVED_WIN_VERSIONED"
    echo "deploy-site: derived the Windows zip $WINZIP from dist/latest-win.json (sha-verified against the committed zip's bytes)." >&2
  else
    echo "deploy-site: no committed dist/latest-win.json -- using the fallback \$WINZIP=$WINZIP, which may be stale (#2008/#2571). Land latest-win.json (tools/publish-kosmos-windows.sh) so the current name is derived." >&2
  fi
else
  echo "deploy-site: KOSMOS_WIN_ZIP=$WINZIP overrides the derivation from latest-win.json (the operator escape hatch). It also turns off the #3600 served-pointer check after deploy, so the post-deploy verify checks exactly this name." >&2
fi
# The STAGED Windows build. Every Windows cut goes to staging first (Josh, 2026-09-12), so a
# committed latest-win-staging.json names a versioned zip that must SHIP with its sidecar and the
# pointer itself: the Windows box verifies the build from the served copies before any promote.
# Same agreement check as prod. Independent of KOSMOS_WIN_ZIP (that override names the PROD zip).
# No committed staging pointer (an older checkout, or nothing staged) means nothing to carry.
WIN_STAGED=""
if derive_committed_win_versioned latest-win-staging.json; then
  WIN_STAGED="$DERIVED_WIN_VERSIONED"
  echo "deploy-site: derived the staged Windows zip $WIN_STAGED from dist/latest-win-staging.json (sha-verified against the committed zip's bytes)." >&2
fi

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
# The STAGED Windows build ships whole: the zip, its checksum and the staging pointer that names
# them (all tracked, so git archive carries them). The Windows box verifies the served copies before
# any promote, so a dropped piece would make staging unverifiable -- refuse before the deploy.
if [ -n "$WIN_STAGED" ]; then
  # Three literal checks rather than a loop: tools/test-served-verify.sh inventories the pre-deploy
  # [ -f "$EXPORT/dist/<name>" ] lines by name to prove every artifact is checked with its sidecar,
  # and a loop variable would read to it as an artifact called "$f".
  [ -f "$EXPORT/dist/$WIN_STAGED" ] || { echo "deploy-site: the export has no $WIN_STAGED -- refusing (the staged Windows build latest-win-staging.json names must ship whole: the zip, its checksum and the pointer)."; rm -rf "$EXPORT"; exit 1; }
  [ -f "$EXPORT/dist/$WIN_STAGED.sha256" ] || { echo "deploy-site: the export has no $WIN_STAGED.sha256 -- refusing (the staged Windows build latest-win-staging.json names must ship whole: the zip, its checksum and the pointer)."; rm -rf "$EXPORT"; exit 1; }
  [ -f "$EXPORT/dist/latest-win-staging.json" ] || { echo "deploy-site: the export has no latest-win-staging.json -- refusing (the staged Windows build it names must ship whole: the zip, its checksum and the pointer)."; rm -rf "$EXPORT"; exit 1; }
fi
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
# The sha256 of the SERVED bytes at $HOST/dist/<path>, fetched to a file (never `curl | shasum`, so a
# failed fetch is not hidden by the pipe's status). Returns 1, printing nothing, if the fetch fails.
# The optional max-time bounds only callers that ask: served_matches passes none, so the large Mac
# artifacts it hashes keep their unbounded fetch.
served_sha256() {  # <path-under-dist> [max-time-seconds]
  _sst=$(mktemp "${TMPDIR:-/tmp}/deploy-site-served.XXXXXX")
  if [ -n "${2:-}" ]; then
    curl -fsSL --connect-timeout 10 --max-time "$2" -H 'Cache-Control: no-cache' "$HOST/dist/$1" -o "$_sst" || { rm -f "$_sst"; return 1; }
  else
    curl -fsSL -H 'Cache-Control: no-cache' "$HOST/dist/$1" -o "$_sst" || { rm -f "$_sst"; return 1; }
  fi
  shasum -a 256 < "$_sst" | awk '{print $1}'; rm -f "$_sst"
}
served_matches() {  # <path-under-dist> <local-verified-file>
  ss=$(served_sha256 "$1") || { echo "deploy-site: SERVED dist/$1 could not be fetched after deploy (dropped? this is the #1669 shape) -- investigate."; exit 1; }
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
# --- #3618: shared helpers for a Windows pointer served by redirect ------------------------------
# #3618: read a Windows pointer that prod serves by REDIRECT (to R2). Sets SWP_NAME and SWP_SHA, and
# refuses a name that is not a bare kosmos-<version>-win-x64.zip (it becomes a URL path below) or a
# pointer with no sha. Call it as a plain statement, never in $(...): it sets globals and may exit.
# Each call overwrites SWP_NAME/SWP_SHA, so copy them out before the next call.
read_served_win_pointer() {  # <pointer file under dist> <redacted redirect target> <card tag, e.g. #3600>
  set -- "$1" "$(printf '%s' "$2" | tr -cd '[:print:]')" "$3"   # the Location target is outside content too
  _rswj=$(curl -fsSL --connect-timeout 10 --max-time 30 -H 'Cache-Control: no-cache' "$HOST/dist/$1") || { echo "deploy-site: the served $1 redirects ($2) but could not be read through the redirect -- the deploy already ran, investigate ($3)."; exit 1; }
  SWP_NAME=$(ptr_versioned "$_rswj"); SWP_SHA=$(ptr_sha "$_rswj"); SWP_ARTIFACT=$(ptr_artifact "$_rswj")
  # Printable-only copies for messages: the values come from outside this repo (R2).
  _swpn=$(printf '%s' "$SWP_NAME" | tr -cd '[:print:]'); _swps=$(printf '%s' "$SWP_SHA" | tr -cd '[:print:]')
  case "$SWP_NAME" in
    kosmos-[0-9]*-win-x64.zip) : ;;
    *) echo "deploy-site: the served (redirected) $1 names '${_swpn:-nothing}', not a kosmos-<version>-win-x64.zip -- the deploy already ran, investigate ($3)."; exit 1 ;;
  esac
  # Second check, not redundant: the glob's * above also matches '/' and '..'.
  case "$SWP_NAME" in *[!A-Za-z0-9._-]*|*..*) echo "deploy-site: the served (redirected) $1 names '$_swpn', which is not a bare file name -- the deploy already ran, investigate ($3)."; exit 1 ;; esac
  # The alias checks below assume the pointer's download IS the unversioned alias; enforce it.
  [ -z "$SWP_ARTIFACT" ] || [ "$SWP_ARTIFACT" = kosmos-win-x64.zip ] || { echo "deploy-site: the served (redirected) $1 names its download as '$(printf '%s' "$SWP_ARTIFACT" | tr -cd '[:print:]')', not kosmos-win-x64.zip -- the deploy already ran, investigate ($3)."; exit 1; }
  [ -n "$SWP_SHA" ] || { echo "deploy-site: the served (redirected) $1 names $SWP_NAME but no sha256 -- the deploy already ran, investigate ($3)."; exit 1; }
  case "$SWP_SHA" in *[!0-9a-fA-F]*) echo "deploy-site: the served (redirected) $1 advertises sha '$_swps', which is not hex -- the deploy already ran, investigate ($3)."; exit 1 ;; esac
  [ ${#SWP_SHA} -eq 64 ] || { echo "deploy-site: the served (redirected) $1 advertises sha '$_swps', which is not 64 characters -- the deploy already ran, investigate ($3)."; exit 1; }
}
# #3600/#3618: for a zip named by a REDIRECTED pointer, the served .sha256 must describe what the
# pointer advertises (the Windows updater fetches it FIRST and refuses a mismatch), and the served zip
# BYTES must hash to it: an R2 zip is hashed nowhere else (derive_committed_win_versioned hashes only
# the committed one). About 40 MB, about a second.
check_win_sidecar_and_bytes() {  # <zip name> <sha the pointer advertises> <pointer file> <card tag> <who is refused>
  _cwsc=$(curl -fsSL --connect-timeout 10 --max-time 30 -H 'Cache-Control: no-cache' "$HOST/dist/$1.sha256") || { echo "deploy-site: could not re-read the served $1.sha256 -- the deploy already ran, investigate ($4)."; exit 1; }
  _cwsc=$(printf '%s' "$_cwsc" | awk '{print $1; exit}' | tr '[:upper:]' '[:lower:]' | tr -cd '[:print:]')   # R2 content: printable only
  _cwwant=$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')
  [ "$_cwsc" = "$_cwwant" ] || { echo "deploy-site: the served $3 advertises sha $2 for $1 but its served .sha256 says '${_cwsc:-nothing}' -- $5 would refuse it. The deploy already ran; investigate the R2 publish ($4)."; exit 1; }
  _cwgot=$(served_sha256 "$1" 300) || { echo "deploy-site: could not fetch the served $1 to hash it -- the deploy already ran, investigate ($4)."; exit 1; }
  [ "$_cwgot" = "$_cwwant" ] || { echo "deploy-site: the served $1 hashes to '${_cwgot:-nothing}' but its pointer and .sha256 say $_cwwant -- a corrupt or partial R2 upload; $5 would refuse it. The deploy already ran; investigate the R2 publish ($4)."; exit 1; }
}

# #3600: WHICH Windows zip do users actually get? $WINZIP was derived from the COMMITTED
# latest-win.json, but production does not serve that file: the site's vercel.json redirects
# /dist/latest-win.json (307) to R2, and the Windows publish to R2 happens outside this repo, WITHOUT a
# site commit.
# So the committed pointer goes stale on every Windows promote (0.6.91 Mac promote, 2026-09-24: it
# still said 0.6.72, R2 said 0.6.89, 0.6.72 was not in R2) and this verify 404'd on a zip nobody is
# pointed at -- every Mac promote exited red while prod was correct. When the served pointer is a
# REDIRECT, the served pointer is the truth: verify the zip IT names, and prove its served .sha256
# describes what the pointer advertises. When it is NOT a redirect, git archive ships the committed
# pointer, so $WINZIP already is what users get and nothing changes. The redirect is MEASURED (no
# -L), not read from vercel.json, so a probe that cannot tell falls through to the old check, which
# still fails loudly on a genuinely unserved zip. An explicit KOSMOS_WIN_ZIP still overrides.
WIN_VERIFY=$WINZIP
WIN_SERVED_SHA=""
WIN_CLOSING_NOTES=""   # #3618/#3610 warnings repeated after the final success line
WIN_UNPUBLISHED=""   # set when the site's Windows build is newer than what R2 serves; repeated at the end
# The prod Windows version users get, for the staged block below, always read from the NAME of the
# zip being verified ($WINZIP here: the sha-verified committed name, or an explicit KOSMOS_WIN_ZIP),
# never from a pointer's separate `version` field, which nothing checks against the name. The
# redirect branch re-reads it from the served name. The R2 reads below (probe, pointer, sidecar, zip)
# are separate requests, so a Windows publish landing between them can refuse a good deploy: re-run
# once before investigating R2.
WIN_PROD_VERSION=$(win_zip_version "$WINZIP")
WIN_SITE_VERSION=$WIN_PROD_VERSION   # the site's name (committed, or KOSMOS_WIN_ZIP); staged compares vs both
if [ -z "${KOSMOS_WIN_ZIP:-}" ]; then
  _wr=$(curl -sS --connect-timeout 5 --max-time 10 -H 'Cache-Control: no-cache' -o /dev/null -w '%{http_code} %{redirect_url}' "$HOST/dist/latest-win.json" 2>/dev/null) || _wr=''
  case "${_wr%% *}" in
    301|302|303|307|308)
      _wrt=$(_served_verify_redact_userinfo "${_wr#* }")   # the redirect target, credentials redacted
      read_served_win_pointer latest-win.json "$_wrt" "#3600"
      WIN_VERIFY=$SWP_NAME; WIN_SERVED_SHA=$SWP_SHA
      _wcv=$WIN_PROD_VERSION   # the committed name's version, before it is replaced by the served one
      WIN_PROD_VERSION=$(win_zip_version "$WIN_VERIFY")
      if [ "$WIN_VERIFY" != "$WINZIP" ]; then
        _wnewer=""
        [ -z "$_wcv" ] || _wnewer=$(printf '%s\n%s\n' "$_wcv" "$WIN_PROD_VERSION" | sort -V | tail -1)
        if [ -z "$_wcv" ] || [ -z "$_wnewer" ]; then
          echo "deploy-site: NOTE (#3600): prod serves latest-win.json by redirect ($_wrt) and it names $WIN_VERIFY; the site's Windows name $WINZIP has no readable version (or the compare failed), so which is newer cannot be told. Verifying what users get ($WIN_VERIFY)." >&2
        elif [ "$_wnewer" = "$_wcv" ]; then
          # The site's Windows name is NEWER than what prod serves: a Windows promote was committed
          # but R2 was not updated, so users did NOT get it. Not a Mac deploy failure, but loud.
          echo "deploy-site: WARNING (#3600): the site's Windows name $WINZIP is NEWER than what prod serves by redirect ($WIN_VERIFY). R2 was not updated, so users do NOT have that Windows build. Verifying what they do get ($WIN_VERIFY); publish the build to R2 to finish the Windows promote." >&2
          WIN_UNPUBLISHED="$WINZIP"
        else
          echo "deploy-site: NOTE (#3600): prod serves latest-win.json by redirect ($_wrt) and it names $WIN_VERIFY; the site's committed Windows name $WINZIP is older, so the committed pointer is stale. Verifying what users get ($WIN_VERIFY). This is expected after a Windows publish to R2 and is not a deploy failure." >&2
        fi
      fi
      ;;
    200) : ;;   # served statically: git archive shipped the committed pointer, so $WINZIP is it
    '')
      echo "deploy-site: NOTE (#3600): could not probe whether latest-win.json is served by redirect (transport error or timeout), so verifying the committed $WINZIP. If that 404s while prod redirects to R2, it is this probe, not the deploy; re-run the check." >&2
      ;;
    *)
      echo "deploy-site: NOTE (#3600): latest-win.json answered ${_wr%% *} (neither a redirect nor 200), so verifying the committed $WINZIP. The Windows pointer route itself may be broken; check it." >&2
      ;;
  esac
fi
served_verify_asset_ok "$HOST/dist/$WIN_VERIFY" "the Windows zip $WIN_VERIFY" || { echo "deploy-site: the Windows zip $WIN_VERIFY failed served-verify (see the reason above); the deploy already ran -- investigate."; exit 1; }
# 🛑 THE SIDECAR, BECAUSE THE LOOP ABOVE SAYS "CHECK THE PAIR" AND THIS ONE PAIR WAS UNCHECKED. The
# rationale twenty lines up is that a sidecar-only serve drop breaks new-install verification while
# the artifact still serves; the win zip was the only served pair with no sidecar check.
# MEASURED against production before adding this, so it cannot be a refusal on an asset that was
# never served: installkosmos.com/dist/$WINZIP -> 200 application/zip, and its .sha256 -> 200
# application/octet-stream (not text/html, so the content-type tell passes it).
served_verify_asset_ok "$HOST/dist/kosmos-win-x64.zip" "the unversioned Windows alias" || { echo "deploy-site: the unversioned Windows alias kosmos-win-x64.zip failed served-verify (see the reason above); the deploy already ran -- investigate. This is the download latest-win.json names, and it does not go stale on a version bump the way \$WINZIP does."; exit 1; }
served_verify_asset_ok "$HOST/dist/kosmos-win-x64.zip.sha256" "the unversioned Windows alias checksum" || { echo "deploy-site: kosmos-win-x64.zip.sha256 failed served-verify (see the reason above); the deploy already ran -- investigate."; exit 1; }
served_verify_asset_ok "$HOST/dist/$WIN_VERIFY.sha256" "the Windows zip checksum $WIN_VERIFY.sha256" || { echo "deploy-site: the Windows zip checksum $WIN_VERIFY.sha256 failed served-verify (see the reason above); the deploy already ran -- investigate. A sidecar-only drop breaks new-install verification while the zip still serves."; exit 1; }
if [ -n "$WIN_SERVED_SHA" ]; then
  check_win_sidecar_and_bytes "$WIN_VERIFY" "$WIN_SERVED_SHA" latest-win.json "#3600" "every Windows update"
  # #3610: the unversioned alias is the download the pointer's `artifact` names, and the same build,
  # so its served .sha256 must carry the pointer's sha. Served by redirect (from R2), a mismatch is a
  # real broken checksum: refuse. Served statically from the site commit it goes stale on every
  # Windows publish; warn, naming the fix (redirect it to R2), rather than red every Mac deploy.
  _wwant=$(printf '%s' "$WIN_SERVED_SHA" | tr '[:upper:]' '[:lower:]')
  # Probe, then read: separate requests, so a publish landing between them can refuse a good deploy
  # (re-run once before investigating R2, as for the pointers above).
  _war=$(curl -sS --connect-timeout 5 --max-time 10 -H 'Cache-Control: no-cache' -o /dev/null -w '%{http_code}' "$HOST/dist/kosmos-win-x64.zip.sha256" 2>/dev/null) || _war=''
  _was=$(curl -fsSL --connect-timeout 10 --max-time 30 -H 'Cache-Control: no-cache' "$HOST/dist/kosmos-win-x64.zip.sha256") || { echo "deploy-site: could not re-read the served kosmos-win-x64.zip.sha256 -- the deploy already ran, investigate (#3610)."; exit 1; }
  _was=$(printf '%s' "$_was" | awk '{print $1; exit}' | tr '[:upper:]' '[:lower:]' | tr -cd '[:print:]')   # R2/site content: printable only
  case "${_war%% *}" in
    301|302|303|307|308)
      [ "$_was" = "$_wwant" ] || { echo "deploy-site: the served kosmos-win-x64.zip.sha256 says '${_was:-nothing}' but latest-win.json advertises $WIN_SERVED_SHA for the same build -- a broken alias checksum on R2, or an R2 publish caught mid-write. The deploy already ran; re-run once, then investigate the R2 publish (#3610)."; exit 1; }
      ;;
    200)
      if [ "$_was" != "$_wwant" ]; then
        echo "deploy-site: WARNING (#3610): kosmos-win-x64.zip.sha256 is served from the site commit and says '${_was:-nothing}', which disagrees with the served build's $WIN_SERVED_SHA. Redirect it to R2 in the site's vercel.json so the two cannot drift." >&2
        WIN_CLOSING_NOTES="${WIN_CLOSING_NOTES}deploy-site: BUT (#3610) the Windows alias checksum is served from the site commit and disagrees with the served build.
"
      fi
      ;;
    '')
      [ "$_was" = "$_wwant" ] || echo "deploy-site: NOTE (#3610): kosmos-win-x64.zip.sha256 says '${_was:-nothing}', not the served build's $WIN_SERVED_SHA, and whether it is served from R2 or the site commit could not be probed (transport error or timeout). Re-run the check before acting on it." >&2
      [ "$_was" = "$_wwant" ] || WIN_CLOSING_NOTES="${WIN_CLOSING_NOTES}deploy-site: BUT (#3610) the Windows alias checksum disagrees with the served build and its source could not be probed.
"
      ;;
    *)
      [ "$_was" = "$_wwant" ] || echo "deploy-site: NOTE (#3610): kosmos-win-x64.zip.sha256 says '${_was:-nothing}', not the served build's $WIN_SERVED_SHA, and whether it is served from R2 or the site commit could not be probed (answer '${_war%% *}'). Re-run the check before acting on it." >&2
      [ "$_was" = "$_wwant" ] || WIN_CLOSING_NOTES="${WIN_CLOSING_NOTES}deploy-site: BUT (#3610) the Windows alias checksum disagrees with the served build and its source could not be probed.
"
      ;;
  esac
  # The alias ZIP is classified on its OWN redirect, not its sidecar's: on prod it has redirected to
  # R2 since 09-22 while its sidecar was still static. From R2, those bytes are the download button's
  # download, so they must be the build the pointer names. Served statically, git archive shipped the
  # committed alias, which is the site's business, not R2's.
  # A one-byte ranged GET: classifying the redirect must never download the ~40 MB zip when it is
  # served statically, and unlike HEAD it cannot be refused by a host that disallows HEAD. The
  # answer is used ONLY to tell redirect from not (a 206 says nothing about the file otherwise).
  _waz=$(curl -sS -r 0-0 --connect-timeout 5 --max-time 10 -H 'Cache-Control: no-cache' -o /dev/null -w '%{http_code}' "$HOST/dist/kosmos-win-x64.zip" 2>/dev/null) || _waz=''
  case "${_waz%% *}" in
    301|302|303|307|308)
      _wag=$(served_sha256 kosmos-win-x64.zip 300) || { echo "deploy-site: could not fetch the served kosmos-win-x64.zip to hash it -- the deploy already ran, investigate (#3610)."; exit 1; }
      [ "$_wag" = "$_wwant" ] || { echo "deploy-site: the served kosmos-win-x64.zip hashes to '${_wag:-nothing}' but latest-win.json advertises $WIN_SERVED_SHA -- the alias on R2 is a different build, or an R2 publish caught mid-write. The deploy already ran; re-run once, then investigate the R2 publish (#3610)."; exit 1; }
      ;;
    200|206) : ;;   # served statically: git archive shipped the committed alias
    '')
      echo "deploy-site: NOTE (#3610): whether kosmos-win-x64.zip is served from R2 could not be probed (transport error or timeout), so its bytes were NOT checked against the served build this run. Re-run the check." >&2
      WIN_CLOSING_NOTES="${WIN_CLOSING_NOTES}deploy-site: BUT (#3610) the Windows alias zip bytes were NOT checked this run (probe failed).
"
      ;;
    *)
      echo "deploy-site: NOTE (#3610): whether kosmos-win-x64.zip is served from R2 could not be probed (answer '${_waz%% *}'), so its bytes were NOT checked against the served build this run. Re-run the check." >&2
      WIN_CLOSING_NOTES="${WIN_CLOSING_NOTES}deploy-site: BUT (#3610) the Windows alias zip bytes were NOT checked this run (probe failed).
"
      ;;
  esac
fi
# The STAGED Windows build, served whole: the Windows box verifies it from these served copies
# before any promote. Served statically, the pointer is also compared BY CONTENT with the committed
# one, so a served staging pointer that names some other build fails here rather than misdirecting
# the verification (served by redirect, see #3618 below).
# #3600: a staging pointer whose version is NOT newer than the prod Windows build users get names a
# superseded build. The zip wildcard redirects it to R2, where an old staged build is often absent
# (2026-09-24: staging said 0.6.81, prod 0.6.89, 0.6.81 404'd), so verifying it would exit red on
# every Mac deploy for a build nobody will promote.
# "Not newer" is judged against BOTH the served prod build and the committed one: right after a Windows
# promote the staging pointer still names the just-promoted build, and if R2 missed it that build is
# newer than what R2 serves; verifying it would exit red before the unpublished warning ever printed.
# Equal counts as superseded (staging was promoted), so a same-version rebuild with different bytes is
# not served-verified. Warn and skip ITS ZIP AND SIDECAR; the staging pointer itself is still
# checked (against the committed one when served statically). A NEWER staged
# build is verified in full, because the Windows box verifies that one from these served copies.
# #3618: the staging pointer too may be served by REDIRECT (R2 keeps its own staging channel). Then
# the served pointer is the truth: verify the build IT names, and do not compare it with the site's
# committed copy, which goes stale on every Windows staging publish. Measured, as for prod; a probe
# that cannot tell keeps the committed staging pointer and its strict checks.
# Same race as prod: the staging reads (probe, pointer, sidecar, zip) are separate requests, so a
# Windows staging publish landing between them can refuse a good deploy; the OPERATOR should re-run
# once before investigating (nothing here retries). This probe runs even under KOSMOS_WIN_ZIP: that
# override names only the prod zip.
WIN_STAGED_SERVED_SHA=""
_wsp=$(curl -sS --connect-timeout 5 --max-time 10 -H 'Cache-Control: no-cache' -o /dev/null -w '%{http_code} %{redirect_url}' "$HOST/dist/latest-win-staging.json" 2>/dev/null) || _wsp=''
case "${_wsp%% *}" in
  301|302|303|307|308)
    read_served_win_pointer latest-win-staging.json "$(_served_verify_redact_userinfo "${_wsp#* }")" "#3618"
    if [ -z "$WIN_STAGED" ]; then
      echo "deploy-site: NOTE (#3618): the site commits no latest-win-staging.json, but prod serves one by redirect naming $SWP_NAME. Verifying that staged build." >&2
    elif [ "$WIN_STAGED" != "$SWP_NAME" ]; then
      _wscv=$(win_zip_version "$WIN_STAGED"); _wssv=$(win_zip_version "$SWP_NAME"); _wsn=""
      [ -z "$_wscv" ] || [ -z "$_wssv" ] || _wsn=$(printf '%s\n%s\n' "$_wscv" "$_wssv" | sort -V | tail -1)
      if [ -z "$_wsn" ]; then
        echo "deploy-site: NOTE (#3618): prod serves latest-win-staging.json by redirect and it names $SWP_NAME; the site's committed copy names $WIN_STAGED, and which is newer cannot be told. Verifying the served staging build." >&2
      elif [ "$_wsn" = "$_wscv" ]; then
        # The site's staged build is NEWER than R2's: a staging publish was committed but never
        # reached R2, so the Windows box cannot see it. Not a Mac deploy failure, but loud.
        echo "deploy-site: WARNING (#3618): the site's committed staging build $WIN_STAGED is NEWER than what prod serves by redirect ($SWP_NAME). R2 was not updated, so it is NOT staged for the Windows box. Verifying what is served ($SWP_NAME); publish the build to R2 to stage it." >&2
        WIN_CLOSING_NOTES="${WIN_CLOSING_NOTES}deploy-site: BUT (#3618) the committed staging build $WIN_STAGED is NOT staged: R2 still serves $SWP_NAME.
"
      else
        echo "deploy-site: NOTE (#3618): prod serves latest-win-staging.json by redirect and it names $SWP_NAME; the site's committed copy names $WIN_STAGED and is stale. Verifying the served staging build." >&2
      fi
    fi
    WIN_STAGED=$SWP_NAME; WIN_STAGED_SERVED_SHA=$SWP_SHA
    ;;
  200) : ;;   # served statically: git archive shipped the committed staging pointer
  404)
    # Nothing committed and nothing served is simply "nothing staged": no caveat. With a committed
    # pointer, the strict served-verify below refuses the 404 on its own.
    ;;
  '')
    [ -n "$WIN_STAGED" ] || WIN_CLOSING_NOTES="${WIN_CLOSING_NOTES}deploy-site: BUT (#3618) the staged Windows build was NOT verified this run (probe failed, none committed).
"
    echo "deploy-site: NOTE (#3618): could not probe whether latest-win-staging.json is served by redirect (transport error or timeout), so checking the committed ${WIN_STAGED:-staging pointer (none committed: the staged build is NOT verified this run)}. If that is refused while prod redirects it to R2, it is this probe, not the deploy; re-run the check." >&2
    ;;
  *)
    [ -n "$WIN_STAGED" ] || WIN_CLOSING_NOTES="${WIN_CLOSING_NOTES}deploy-site: BUT (#3618) the staged Windows build was NOT verified this run (probe answered ${_wsp%% *}, none committed).
"
    echo "deploy-site: NOTE (#3618): latest-win-staging.json answered ${_wsp%% *} (neither a redirect nor 200), so checking the committed ${WIN_STAGED:-staging pointer (none committed: the staged build is NOT verified this run)}. The staging pointer route itself may be broken; check it." >&2
    ;;
esac
WIN_STAGED_SUPERSEDED=0
WIN_STAGED_VERSION=""
# From the sha-verified NAME, like the prod side, not the staging pointer's `version` field.
[ -z "$WIN_STAGED" ] || WIN_STAGED_VERSION=$(win_zip_version "$WIN_STAGED")
_wsup=""
for _wref in "$WIN_PROD_VERSION" "$WIN_SITE_VERSION"; do
  [ -n "$WIN_STAGED" ] && [ -n "$WIN_STAGED_VERSION" ] && [ -n "$_wref" ] || continue
  [ "$(printf '%s\n%s\n' "$WIN_STAGED_VERSION" "$_wref" | sort -V | tail -1)" = "$_wref" ] && { _wsup=$_wref; break; }
done
# Only a staged zip that is itself served by REDIRECT can be missing for that reason. Served
# statically, git archive shipped the committed zip, so checking it is cheap and a 404 is a real drop.
if [ -n "$_wsup" ]; then
  _wsr=$(curl -sS -r 0-0 --connect-timeout 5 --max-time 10 -H 'Cache-Control: no-cache' -o /dev/null -w '%{http_code}' "$HOST/dist/$WIN_STAGED" 2>/dev/null) || _wsr=''   # one-byte ranged GET: classify without downloading, no HEAD dependence
  case "${_wsr%% *}" in 301|302|303|307|308) : ;; *) _wsup="" ;; esac
fi
if [ -n "$_wsup" ]; then
  echo "deploy-site: WARNING (#3600): latest-win-staging.json names $WIN_STAGED ($WIN_STAGED_VERSION), which is not newer than the prod Windows build $_wsup. It is superseded, so its zip and checksum are not served-verified (the staging pointer itself still is: served, and shape-checked when redirected, content-compared when static). The next Windows staging publish replaces it." >&2
  WIN_STAGED_SUPERSEDED=1
fi
if [ -n "$WIN_STAGED" ]; then
  if [ "$WIN_STAGED_SUPERSEDED" = 0 ]; then
    served_verify_asset_ok "$HOST/dist/$WIN_STAGED" "the staged Windows zip $WIN_STAGED" || { echo "deploy-site: the staged Windows zip $WIN_STAGED failed served-verify (see the reason above); the deploy already ran -- investigate."; exit 1; }
    served_verify_asset_ok "$HOST/dist/$WIN_STAGED.sha256" "the staged Windows zip checksum $WIN_STAGED.sha256" || { echo "deploy-site: the staged Windows zip checksum $WIN_STAGED.sha256 failed served-verify (see the reason above); the deploy already ran -- investigate."; exit 1; }
    [ -z "$WIN_STAGED_SERVED_SHA" ] || check_win_sidecar_and_bytes "$WIN_STAGED" "$WIN_STAGED_SERVED_SHA" latest-win-staging.json "#3618" "the Windows box's staging verification"
  fi
  served_verify_asset_ok "$HOST/dist/latest-win-staging.json" "the Windows staging pointer" || { echo "deploy-site: latest-win-staging.json failed served-verify (see the reason above); the deploy already ran -- investigate."; exit 1; }
  # Served statically, the pointer must be the committed one. Served by redirect it is R2's own
  # (read and shape-checked above), and the committed copy is expected to be stale.
  if [ -z "$WIN_STAGED_SERVED_SHA" ]; then
    _served_win_staging=$(curl -fsSL -H 'Cache-Control: no-cache' "$HOST/dist/latest-win-staging.json") || { echo "deploy-site: could not re-read the served latest-win-staging.json after deploy -- investigate."; exit 1; }
    [ "$_served_win_staging" = "$(git -C "$SITE" show "$H:dist/latest-win-staging.json" 2>/dev/null)" ] || { echo "deploy-site: the served latest-win-staging.json is not the committed one (which names $WIN_STAGED) -- investigate."; exit 1; }
  fi
fi
# #2565: /setup is at the site ROOT, not under /dist, so the /dist control above does NOT prove a
# 200 at $HOST/setup is meaningful -- a route-scoped blindness (a catch-all / rewrite / SPA fallback
# at the root) discriminates under /dist and is blind at the root. Prove the ROOT route discriminates
# before trusting the /setup 200, aiming the control at the route this line is about to trust.
# ⚠️ OPERATIONAL: this is a live, fail-closed GATE ADDITION -- the deploy now also requires the site
# ROOT to 404 a nonexistent path. INTENDED: if the root soft-404s (serves 200 for unknown paths, e.g.
# a custom 404 page or landing redirect), a 200 at /setup is genuinely unverifiable, so refusing is
# correct rather than a false-refuse. #1667 established the production alias discriminates host-wide
# and /setup is a real text/plain route, so the root should discriminate; a refusal here means the
# host's root routing changed and wants investigation, not that this gate is wrong.
served_verify_host_discriminates "$HOST" "/" || { echo "deploy-site: refusing to certify the deploy -- the served-verify negative control failed for the ROOT route that serves /setup (see above), so a 200 at /setup would be meaningless; the deploy already ran, investigate."; exit 1; }
served_verify_asset_ok "$HOST/setup"        "/setup"                   || { echo "deploy-site: /setup failed served-verify (see the reason above); the deploy already ran -- investigate."; exit 1; }
# #2511/#1666: prove the served (setup, setup.sha256) PAIR is self-consistent AT THE EDGE before
# declaring promoted. served_verify_asset_ok above only proves /setup is a served 200 non-html; this
# proves it is served WHOLE and its published checksum DESCRIBES the served bytes. This is the EXACT
# pair the .pkg postinstall verifies -- it fetches /setup + /setup.sha256 and REFUSES the install
# (the generic "installation failed") on a mismatch or an unreachable sidecar -- and the pair a
# mid-publish window (#1666: a checksum that did not match the served bytes survived a whole day) or
# a half-warmed CDN edge desynchronizes. Fetch-to-file (never `curl | awk`) so a failed fetch is not
# hidden by the pipe's exit status.
_svsetup=$(mktemp "${TMPDIR:-/tmp}/deploy-site-setup.XXXXXX")
curl -fsSL -H 'Cache-Control: no-cache' "$HOST/setup" -o "$_svsetup" || { echo "deploy-site: could not re-fetch the served /setup after deploy -- investigate."; rm -f "$_svsetup"; exit 1; }
_svsetup_got=$(shasum -a 256 < "$_svsetup" | awk '{print $1}'); rm -f "$_svsetup"
_svsetup_sum=$(mktemp "${TMPDIR:-/tmp}/deploy-site-setupsum.XXXXXX")
curl -fsSL -H 'Cache-Control: no-cache' "$HOST/setup.sha256" -o "$_svsetup_sum" || { echo "deploy-site: could not fetch the served /setup.sha256 after deploy -- refusing (the .pkg postinstall REFUSES the install when this sidecar is unreachable, so a client would hit the same failure)."; rm -f "$_svsetup_sum"; exit 1; }
_svsetup_want=$(awk '{print $1; exit}' "$_svsetup_sum"); rm -f "$_svsetup_sum"
[ -n "$_svsetup_want" ] && [ "$_svsetup_want" = "$_svsetup_got" ] || { echo "deploy-site: the served /setup (sha $_svsetup_got) does NOT match its served /setup.sha256 (${_svsetup_want:-<none>}) -- refusing to certify. This is exactly what makes the .pkg postinstall refuse with \"installation failed\" (#1666/#2511): a half-published or half-warmed-CDN state where a client can fetch a mismatched (setup, setup.sha256) pair. Re-run the deploy and/or purge+warm the edge for /setup and /setup.sha256."; exit 1; }

echo "deploy-site: published and verified -- the site is live and the installers are still served."
[ -z "$WIN_CLOSING_NOTES" ] || printf '%s' "$WIN_CLOSING_NOTES"
[ -z "$WIN_UNPUBLISHED" ] || echo "deploy-site: BUT (#3600) the Windows build $WIN_UNPUBLISHED is committed and NOT served: users still get $WIN_VERIFY. Publish it to R2 to finish that Windows promote."

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

# #2791: a successful --publish/--promote returns 0 EXPLICITLY. Every real failure exits 1 before
# here (the pre-deploy refusals and the post-deploy served-verify / served_matches guards), so
# reaching this line is verified success. Without an explicit exit the status is only whatever the
# trailing #2159 `if [ "$PROMOTE" = 1 ]` block happens to leave: on a --publish that condition is
# false, and a false `if...fi` with no else returns 0 today -- but the status is IMPLICIT, so a
# future trailing command (or a shell whose empty-if differs) would silently make a clean publish
# exit non-zero. Baron saw DEPLOY_EXIT=128 (a git-fatal code) trail a verified 0.6.55 publish; a
# deploy script that exits non-zero on success is a latent false-alarm trap for any runner or CI
# gate reading DEPLOY_EXIT. Make success unambiguous and immune to a trailing command.
exit 0
