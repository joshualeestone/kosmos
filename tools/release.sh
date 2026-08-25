#!/bin/bash
# Cut a release: bump, test, build, publish, and verify what is SERVED.
#
#   bash tools/release.sh 0.2.12
#
# ⚠️ THIS SCRIPT LIVED IN A SCRATCHPAD FOR THREE RELEASES. Every improvement it
# gained — including the step that copies `/setup`, added after the installer
# served on the site was found a whole change stale — would have died with the
# session that wrote it. A release procedure that is not in the repo is a
# procedure the next person reconstructs from memory, which is how the same step
# goes missing twice.
#
# ⚠️ IT DOES NOT VERIFY ANYTHING ITSELF. `tools/verify-served.sh` does that, and
# it derives the artifact list from the code that FETCHES each one. Two
# derivations of "what a user receives" is this codebase's worst habit, and the
# first one is what missed `/setup`.
set -euo pipefail
V="${1:-}"
[ -n "$V" ] || { echo "usage: bash tools/release.sh <version>   e.g. 0.2.12"; exit 1; }

# 🔑 AFTER 0.2.99 COMES 0.3.0, and this refuses anything else. Josh, 2026-08-22:
# *"since we are getting close, when we get to 0.2.99 then lets roll to 0.3.00"*.
#
# ⚠️ A RULE IN A CARD DEPENDS ON WHOEVER IS AWAKE AT 0.2.99 HAVING READ IT, and
# at the current rate that is three weeks and several people from now. The
# version is a bare argument to this script, so nothing otherwise stops
# `0.2.100` being typed at exactly the moment nobody is thinking about it — and
# by then it is published, polled by every install, and in the versions page.
# Mona Lisa's call, and it is the same argument as baking the version rather
# than fetching it: answer it once instead of asking every future author.
#
# ⚠️ IT REFUSES RATHER THAN CORRECTS. Silently shipping 0.3.0 when somebody
# asked for 0.2.100 would be a release nobody named, and the entry they wrote on
# the versions page is stamped with the version they typed.
_prev="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$(cd "$(dirname "$0")/.." && pwd)/package.json','utf8')).version)")"
if [ "$_prev" = "0.2.99" ] && [ "$V" != "0.3.0" ]; then
  echo "0.2.99 is the last of the 0.2 line: the next version is 0.3.0, not $V."
  echo "(Josh's ruling, 2026-08-22. If that has changed, this guard is in tools/release.sh.)"
  exit 1
fi
case "$V" in
  0.2.1[0-9][0-9]*)
    echo "$V is past the end of the 0.2 line. 0.2.99 is the last one; after it comes 0.3.0."
    exit 1 ;;
esac
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SITE="${KOSMOS_SITE:-$HOME/work/chaoskosmos-site}"
[ -d "$SITE/dist" ] || { echo "no site checkout at $SITE (set KOSMOS_SITE)"; exit 1; }

echo "== 1. main, clean, and carrying what you mean to ship =="
git -C "$REPO" fetch origin -q
[ "$(git -C "$REPO" rev-parse --abbrev-ref HEAD)" = main ] || { echo "not on main"; exit 1; }
[ -z "$(git -C "$REPO" status --porcelain)" ] || { echo "main is dirty"; exit 1; }
git -C "$REPO" log --oneline -8 | cat

echo "== 2. the version, in one place =="
node -e "
const fs=require('fs'),p='$REPO/package.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
if(j.version!=='$V'){ j.version='$V'; fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n'); console.log('   bumped to $V'); }
else console.log('   already $V');"

# 🛑 AND THE BUMP IS COMMITTED BEFORE ANYTHING IS BUILT, because otherwise THE
# GUARD IN STEP 1 IS DEFEATED BY STEP 2. It checks a clean tree, then this makes
# the tree dirty, and the bundle is stamped `<sha>-DIRTY` by
# `git describe --dirty` — which is honest and means the artifact people are
# running is not checkoutable. 0.2.11 and 0.2.12 both shipped that way, and both
# times somebody had to hash the bundle against a commit to establish that
# nothing unexpected was in it.
#
# ⚠️ THE POINT IS NOT TIDINESS. A version stamp that cannot be resolved to a
# commit means "what is this person running" is answerable only by comparison,
# which is exactly the question a release exists to make cheap.
if ! git -C "$REPO" diff --quiet -- package.json; then
  git -C "$REPO" add package.json
  git -C "$REPO" commit -q -m "v${V//./} -- version"
  echo "   committed the bump, so the build is stamped at a real commit"
  # 🛑 AND PUSHED, BECAUSE A COMMIT THAT NEVER LEAVES IS NOT A STAMP. This
  # script committed the bump and stopped, so every release left its version
  # commit on one machine. Nothing looked wrong: the bundle carried the right
  # version, the site served it, and `verify-served.sh` passed, because every
  # check here measures the ARTIFACT and none of them asks whether the commit
  # the artifact is stamped at exists anywhere else.
  #
  # ⚠️ The whole reason for the paragraph above is that a version resolves to a
  # commit. A commit only this machine has does not resolve for anybody, so the
  # unpushed state defeats the stated purpose rather than merely being untidy.
  #
  # 📌 A failure here is REPORTED AND NOT FATAL. The release is about what the
  # site serves; being unable to reach the remote is a real thing to say and a
  # bad reason to refuse to ship. Step 9 still proves what a user receives.
  if git -C "$REPO" push -q origin HEAD 2>/dev/null; then
    echo "   pushed it, so the stamp resolves somewhere other than this machine"
  else
    echo "   ⚠️  COULD NOT PUSH THE BUMP. The release continues, and the version"
    echo "      stamp resolves to a commit only this machine has until you do."
  fi
fi
[ -z "$(git -C "$REPO" status --porcelain)" ] || {
  echo "the tree is dirty after the bump; the bundle would ship as -DIRTY"; exit 1; }
# ⚠️ CAPTURED HERE, the instant the tree is known clean, so the frozen sha is
# HEAD-with-the-bump and everything downstream (tested == built == served ==
# named) keys off this one value. It is HEAD, not literally the bump commit:
# a fast-forward pull between the bump and this line would fold other agents'
# commits in, and that is fine -- the bump cannot be lost (a failed push
# leaves the pull non-ff, so HEAD never moves past the local bump), and the
# invariant holds whatever HEAD is. Reading it INSIDE 2b, later, was the only
# real hazard: a pull there could move the tree after some steps had run.
SHA="$(git -C "$REPO" rev-parse HEAD)"

echo "== 2b. the tree that ships, frozen at one sha (#597) =="
# 🛑 FROM HERE ON, $REPO IS A DETACHED WORKTREE AT THE BUMP SHA, NOT THE
# SHARED CHECKOUT. The checkout this script lives in is pulled by every agent
# on the Mac; on 2026-08-24 two cuts in a row were fast-forwarded mid-run, so
# the suite and the page gate ran on one sha and the bundle shipped another.
# Steps 3 through 6 (3c's pkg build and 4b's install gate included) run in the frozen tree, and so does step 9:
# verify-served.sh reads $REPO/install/setup.sh and $REPO/package.json, and
# its baked-in default REPO is the shared checkout, so the REPO="$REPO" pass
# below is load-bearing, not redundant. Step 9b compares what is SERVED
# against the frozen tree; only step 10 (the board on this Mac runs from the
# shared checkout) goes back to MAIN_REPO. The worktree is removed on every exit.
. "$REPO/tools/lib/release-freeze.sh"
MAIN_REPO="$REPO"
BUILD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-release.XXXXXX")" || { echo "no temp dir for the frozen tree"; exit 1; }
BUILD="$(release_freeze "$MAIN_REPO" "$SHA" "$BUILD_ROOT")" || { rm -rf "$BUILD_ROOT"; echo "could not freeze the tree at $SHA"; exit 1; }
# The versioned pair's presence BEFORE this cut, so a failure removes only what
# this cut created (a pair from an earlier, served cut is not ours to touch).
_pair_had=0; [ -f "$SITE/dist/kosmos-$V-arm64.tar.gz" ] && _pair_had=1
DEPLOYED=0
# On any exit before step 8 finished, the site checkout stops claiming $V
# (#609 review, Splinter 23:05: a failed cut left latest.json and setup.sha256
# uncommitted at the new version, and the pair that made cut 5 refuse).
trap '[ "$DEPLOYED" = 1 ] || release_site_restore "$SITE" "$V" "$_pair_had"; release_thaw "$MAIN_REPO" "$BUILD"; rm -rf "$BUILD_ROOT"' EXIT
REPO="$BUILD"
echo "   building ${SHA:0:12} in $BUILD; a pull into $MAIN_REPO from now on changes nothing below"

echo "== 3. the whole suite, on the tree that ships =="
# ⚠️ CORRECTED CLAIM: the old `yarn test | grep` gate DID refuse a red
# suite (pipefail makes the pipeline's status yarn's, and errexit
# stops the script), measured by the PM against my first reading of it,
# which said otherwise from the shape alone. What the old gate did
# wrong was refuse SILENTLY, with the reason invisible. This form
# captures the exit before errexit can eat it, prints the suite's own
# summary lines, and names the log a red run's detail lives in.
_suite_log="$(mktemp)"
_suite_exit=0
( cd "$REPO" && yarn test >"$_suite_log" 2>&1 ) || _suite_exit=$?
grep -E '^ℹ (tests|pass|fail)' "$_suite_log" || true
# ⚠️ 126/127 IS NOT A RED SUITE. It means the suite could not be run at all
# (yarn or node missing or not executable), and saying "red" about it sends
# the person to read assertions that never ran (#785, three flavours of this
# in one day). Refuse either way, with the true sentence.
if [ "$_suite_exit" -eq 126 ] || [ "$_suite_exit" -eq 127 ]; then echo "the suite COULD NOT RUN (exit $_suite_exit: yarn, node or a program a shell test calls is missing or not executable); this is not a failing test. Full output: $_suite_log"; exit 1; fi
[ "$_suite_exit" -eq 0 ] || { echo "the suite is red (exit $_suite_exit); full output: $_suite_log"; exit 1; }
rm -f "$_suite_log"

echo "== 3b. the page layer, headless (#39) =="
# ⚠️ THE PAGE IS PART OF WHAT SHIPS, and `node --test` cannot see it: round
# 16 of the project-chat review put 18 page mutations through the whole
# suite and 16 survived. The browser checks CAN see it and now gate the
# release the same way the suite does: exit code, printed reason, named
# log. The harness fails LOUD when no Playwright is on the machine
# (KOSMOS_SKIP_BROWSER_CHECKS=1 is the explicit, printed opt-out), so a
# release machine without a browser says so rather than shipping an
# unchecked page.
_page_log="$(mktemp)"
_page_exit=0
( cd "$REPO" && bash tools/browser-checks.sh >"$_page_log" 2>&1 ) || _page_exit=$?
grep -E '^PASS |^FAIL |^COULD NOT RUN|^‼️|retried:|all page' "$_page_log" || true
if [ "$_page_exit" -eq 126 ] || [ "$_page_exit" -eq 127 ]; then echo "the page gate COULD NOT RUN (exit $_page_exit: bash, node or a program it needs is missing or not executable); this is not a red check. Full output: $_page_log"; exit 1; fi
[ "$_page_exit" -eq 0 ] || { echo "the page checks are red (exit $_page_exit); full output: $_page_log"; exit 1; }
rm -f "$_page_log"

echo "== 3c. the installer .pkg, rebuilt and published only when its inputs changed (#555, #638 B) =="
# 🛑 THE DOWNLOAD BUTTON SERVES THIS FILE AND NO RELEASE STEP EVER TOUCHED IT.
# Baron built and hand-copied the first Kosmos.pkg (2026-08-24); every
# installer fix after that reached nobody until someone remembered, and the
# same afternoon a hand republish went live beside the previous build's
# .sha256. This step is the remembering. It is NOT a rebuild every cut: the pkg is payload-free
# (a postinstall that runs the served /setup), so it changes only when its
# INPUTS change (pkg-scripts, pkg-resources, the build script, which carries
# the identifier; tools/lib/pkg-inputs.sh is the one definition). A rebuild
# costs a sign + notarise round trip, minutes, and only when one of those
# moved. It sits BEFORE step 4 on purpose: step 4 copies the cache-immutable
# versioned tarball into the site dist, and a notarisation flake after that
# would make the re-run refuse at the versioned name and cost a version bump.
# Here a flake aborts a cut nothing has been copied for, and a successful
# build leaves the triple in the site's working tree, so a later abort (the
# versions page, say) costs nothing on the re-run: 3c finds it current.
# ⚠️ AND IF THERE IS NO RE-RUN: the triple sits in the site's working tree,
# built from the pushed bump sha (not stale), and the next site deploy by
# anyone publishes it with no 9c behind it. verify-served.sh is the check
# that then applies; run it after any site deploy that follows an abandoned
# cut.
# ⚠️ NOT COMMITTED, CARRIED BY NAME: the site gitignores dist/*.pkg,
# dist/*.pkg.sha256 and dist/*.pkg.inputs (build output), so the triple has
# no commit behind it; step 8's export carries it as a named artifact class
# (tools/lib/site-deploy.sh), which is how #649's working-tree accident became
# a decision. Step 9c and verify-served.sh check what is actually served, and
# this step says out loud whether it published, so a stale pkg is a red line,
# never a quiet skip.
. "$REPO/tools/lib/pkg-inputs.sh"
# The upload filter must carry the triple, or 9c reds after a ten-minute wait
# for a reason a read can give now, BEFORE any sign + notarise minutes are
# spent (it depends on nothing the build produces). Evaluated by git on the filter's own
# patterns (the same semantics Vercel applies), and a MISSING filter is a
# refusal: without one Vercel falls back to the site's .gitignore, which
# excludes dist/*.pkg, which is the exact hole the site's .gitignore warns of.
# The COMMITTED filter, because the deploy ships the export of HEAD (#649),
# not the working tree: an uncommitted edit to .vercelignore is not what the
# deploy applies, so it is not what this guard may vouch for.
_vi_tmp="$(mktemp "$BUILD_ROOT/vercelignore.XXXXXX")"
if git -C "$SITE" show HEAD:.vercelignore > "$_vi_tmp" 2>/dev/null; then :; else rm -f "$_vi_tmp"; _vi_tmp="$BUILD_ROOT/no-such-vercelignore"; fi
set +e; _pkg_dropped="$(pkg_upload_filter_excludes "$_vi_tmp")"; _pkg_frc=$?; set -e
if [ "$_pkg_frc" = 1 ]; then
  echo "no committed .vercelignore at the site's HEAD (the export ships the committed one); Vercel would fall back to .gitignore and drop dist/Kosmos.pkg from the upload"; exit 1
elif [ "$_pkg_frc" != 0 ]; then
  echo "could not evaluate the site's .vercelignore (rc=$_pkg_frc); refusing to assume the deploy carries the pkg"; exit 1
elif [ -n "$_pkg_dropped" ]; then
  echo "the site's .vercelignore excludes $_pkg_dropped; the deploy would not carry the pkg triple"; exit 1
fi
echo "   .vercelignore carries dist/Kosmos.pkg, .sha256 and .inputs (evaluated by git)"
_pkg_want="$(pkg_input_sha "$REPO")" || { echo "could not compute the pkg input sha from the frozen tree"; exit 1; }
# ⚠️ THE VERDICT IS THE EXIT CODE (0 needed, 2 current), read under set +e so
# an ERROR inside the decision (exit 1, or anything else) stops the cut instead
# of reading as "current" and skipping the publish: fail closed.
set +e; _pkg_why="$(pkg_publish_needed "$SITE/dist" "$_pkg_want")"; _pkg_rc=$?; set -e
if [ "$_pkg_rc" = 0 ]; then
  echo "   rebuilding Kosmos.pkg: $_pkg_why"
  # Built FROM THE FROZEN TREE (REPO is the detached worktree from 2b), signed,
  # notarised, stapled; the script refuses to build unsigned. It writes
  # Kosmos.pkg + .sha256 + .inputs into $REPO/dist.
  ( cd "$REPO" && OUT_DIR="$REPO/dist" bash tools/build-installer-pkg.sh "$V" )
  [ "$(pkg_sidecar_inputs "$REPO/dist/Kosmos.pkg.inputs")" = "$_pkg_want" ] || { echo "the built pkg's input sidecar is not the sha this step computed; the build script and the guard disagree"; exit 1; }
  cp "$REPO/dist/Kosmos.pkg" "$REPO/dist/Kosmos.pkg.sha256" "$REPO/dist/Kosmos.pkg.inputs" "$SITE/dist/"
  PKG_PUBLISHED=1
  echo "   published to the site dist: Kosmos.pkg $(awk '{print substr($1,1,12)}' < "$SITE/dist/Kosmos.pkg.sha256"), inputs ${_pkg_want:0:12}"
elif [ "$_pkg_rc" = 2 ] && case "$_pkg_why" in current:*) true;; *) false;; esac; then
  PKG_PUBLISHED=0
  echo "   Kosmos.pkg not rebuilt: $_pkg_why"
else
  echo "could not decide whether the pkg needs publishing (rc=$_pkg_rc: ${_pkg_why:-no reason printed}); refusing to guess"; exit 1
fi


echo "== 4. build =="
( cd "$REPO" && bash tools/build-kosmos-bundle.sh dist )

echo "== 4b. a real install from the bundle just built, sandboxed, before anything is served (#624) =="
# 🛑 EVERY EARLIER CHECK MEASURED THE BYTES. Step 3 ran the suite, 9b proves
# served == built file by file, and neither ever INSTALLED the thing: a
# change to the bundle's SHAPE (a file the installer's post-extract check
# expects, a changed extract) passed all of them and could still fail on a
# stranger's Mac. tools/test-install.sh is that install, sandboxed in every
# root, run by hand before #583's cut and by nothing since; this runs it in
# gate mode (the install, update, uninstall and download-path passes, then
# the "nothing leaked" checks) on THIS build, and a red stops the cut here.
# The kosmos bundle is the one step 4 just packed. The tmux bundle is the
# site working tree's copy of the served pair (step 4 does not build it; the
# wire is what 9 verifies), extracted into the frozen dist the way the harness expects.
# 🛑 BEFORE ANY COPY INTO THE SITE DIST. The first placement of this step was
# after step 4's copies, so a bundle that failed to install already sat under
# the plain name in the site tree (the export carries dist/*.tar.gz by name,
# so the next site deploy by anyone would have shipped it), and the re-run
# after the fix hit the versioned-name refusal and cost a version bump.
[ -f "$SITE/dist/tmux-arm64.tar.gz" ] && [ -f "$SITE/dist/tmux-arm64.tar.gz.sha256" ] || { echo "no tmux bundle pair in $SITE/dist (a fresh site checkout has none: fetch the served pair from ${HOST:-https://installkosmos.com}/dist/tmux-arm64.tar.gz and .sha256 into $SITE/dist, or build one with tools/build-tmux-bundle.sh); the install gate cannot run"; exit 1; }
cp "$SITE/dist/tmux-arm64.tar.gz" "$SITE/dist/tmux-arm64.tar.gz.sha256" "$REPO/dist/"
rm -rf "$REPO/dist/tmux-bundle"; mkdir -p "$REPO/dist/tmux-bundle"
tar -xzf "$REPO/dist/tmux-arm64.tar.gz" -C "$REPO/dist/tmux-bundle" || { echo "the served tmux bundle does not extract"; exit 1; }
# A bare mktemp, like step 3's suite log: the red branch exits, the 2b trap
# removes BUILD_ROOT, and a log under it would be gone before anyone read it.
# ⚠️ DISK, SAID BY NAME. A gate run uses ~300 MB transiently (measured
# 2026-08-24: 277 MB peak, returned on exit; gate mode never reaches the
# probe blocks whose fresh homes each pull a 345 MB Claude Code install),
# but this Mac reached 288 MB free tonight, and an install failing on a
# full disk reads as a broken bundle, not as a full disk. Refuse below 2 GB
# and name the disk, so the red says what it is.
. "$REPO/tools/lib/disk-guard.sh"
kosmos_require_free_mb 2048 "${TMPDIR:-/tmp}" "the install gate (~300 MB transient)" || exit 1
_gate_log="$(mktemp "${TMPDIR:-/tmp}/kosmos-install-gate.XXXXXX")"
if ( cd "$REPO" && KOSMOS_INSTALL_GATE=1 bash tools/test-install.sh ) > "$_gate_log" 2>&1; then
  echo "   $(grep -E ' passed, ' "$_gate_log" | tail -1 || true): the bundle installs, updates, uninstalls and downloads-and-installs in a sandbox"
  rm -f "$_gate_log"
else
  echo "THE BUNDLE JUST BUILT DOES NOT INSTALL. No bundle was copied to the site. The gate said:"
  # The fallback: under set -e a log with no FAIL, summary or SKIP line (the
  # harness died before its first check, or refused at its staged-trees line)
  # would abort here with the headline and no reason; print its tail instead.
  grep -E '^FAIL|^   |passed, |SKIP' "$_gate_log" | sed 's/^/   /' || tail -15 "$_gate_log" | sed 's/^/   /'
  [ "${PKG_PUBLISHED:-0}" = 1 ] && echo "   (3c already put a rebuilt Kosmos.pkg triple in $SITE/dist; a site deploy before the next cut would carry it; verify-served.sh is the check that applies)"
  echo "   (full log: $_gate_log)"; exit 1
fi

# The connector's checksum, from the tarball THIS build just produced, so step
# 9b can prove the SERVED tunnel is byte-for-byte the one tested here (#583).
# The connector is not a tree file (kosmos-relay builds it), so this is its
# source of truth, the analog of the app/ files' tree comparison.
# ⚠️ `tar | shasum` in a pipeline: under set -o pipefail a member-absent tar
# would abort the assignment before the guard below could name the cause, so
# extract to a file first (tar's own non-zero is captured, not fatal here) and
# let the guard speak.
_tunnel_tmp="$(mktemp)"
if tar -xzOf "$REPO/dist/kosmos-arm64.tar.gz" app/bin/kosmos-tunnel > "$_tunnel_tmp" 2>/dev/null && [ -s "$_tunnel_tmp" ]; then
  TUNNEL_SHA="$(shasum -a 256 "$_tunnel_tmp" | awk '{print $1}')"
else
  rm -f "$_tunnel_tmp"; echo "the built bundle carries no Plus connector (app/bin/kosmos-tunnel); build-kosmos-bundle.sh should have refused"; exit 1
fi
rm -f "$_tunnel_tmp"
echo "   connector: kosmos-tunnel $TUNNEL_SHA"
# 🛑 BEFORE THE FIRST COPY TOWARD THE SITE (#609): the bundle just built carries
# every file the tree and the app need, and each present file equals the
# tree's. The same comparator runs at 9b on the SERVED bytes; here it runs on
# the built ones, so a file the build forgot (#731: the codex bridge, absent
# from every served bundle for ten versions) stops the cut with nothing
# published, instead of being caught after step 8 has deployed it.
_cmp_rc=0; release_bundle_matches_tree "$REPO/dist/kosmos-arm64.tar.gz" "$BUILD" "$TUNNEL_SHA" || _cmp_rc=$?
if [ "$_cmp_rc" -eq 0 ]; then
  echo "   the built bundle carries everything the tree and the app need, and every file in it is the tree's"
else
  if [ "$_cmp_rc" -eq 2 ]; then echo "THE BUNDLE JUST BUILT COULD NOT BE CHECKED AGAINST THE TREE (the lines above say why). No bundle was copied to the site."
  else echo "THE BUNDLE JUST BUILT IS NOT THE TREE THAT WAS TESTED, OR LACKS A FILE THE APP NEEDS (the lines above name it). No bundle was copied to the site."; fi
  [ "${PKG_PUBLISHED:-0}" = 1 ] && echo "   (3c already put a rebuilt Kosmos.pkg triple in $SITE/dist; a site deploy before the next cut would carry it; verify-served.sh is the check that applies)"
  exit 1
fi
cp "$REPO/dist/kosmos-arm64.tar.gz" "$REPO/dist/kosmos-arm64.tar.gz.sha256" "$SITE/dist/"
# The release manifest (#776) rides beside the versioned tarball, TRACKED: a
# few KB per release that says what produced the served bytes. The tarballs
# themselves stay untracked (48 MB each, and they prove only that bytes existed).
cp "$REPO/dist/kosmos-arm64.manifest.json" "$SITE/dist/kosmos-$V-arm64.manifest.json"
# ⚠️ THE VERSIONED NAME IS THE ONE A CACHE CANNOT LIE ABOUT. The plain
# name is one URL across every release, and an edge cache satisfied an
# update from it with the PRIOR release's bytes and matching checksum
# (Josh's machine, 2026-08-24). The installer prefers this name; the
# plain pair stays for installers older than this change.
# 🛑 A VERSIONED NAME IS A PROMISE OF IMMUTABILITY. Republishing the
# same version with different bytes recreates the incident one level
# up: an edge cache holding the first attempt serves an internally
# consistent old pair that passes every new guard. Bump instead.
if [ -f "$SITE/dist/kosmos-$V-arm64.tar.gz" ] && ! cmp -s "$REPO/dist/kosmos-arm64.tar.gz" "$SITE/dist/kosmos-$V-arm64.tar.gz"; then
  echo "refusing to republish $V with different bytes (the versioned name is cache-immutable); bump the version"; exit 1
fi
cp "$REPO/dist/kosmos-arm64.tar.gz" "$SITE/dist/kosmos-$V-arm64.tar.gz"
cp "$REPO/dist/kosmos-arm64.tar.gz.sha256" "$SITE/dist/kosmos-$V-arm64.tar.gz.sha256"
node -e "require('node:fs').writeFileSync('$SITE/dist/latest.json', JSON.stringify({version:'$V'})+'\n')"
echo "   latest.json -> $(cat "$SITE/dist/latest.json")"

# 🛑 THE INSTALLER, SERVED FROM THE SITE ROOT AND NOT FROM dist/. Copying the
# bundle does not carry it, and BOTH paths run it: a new install (`curl … /setup
# | sh`) and an existing one updating itself (engine/update.js re-runs
# `setupUrl()`). It was stale on the site by a whole change before this step
# existed, while three correct checks of the bundle passed.
echo "== 5. the installer =="
cp "$REPO/dist/setup" "$SITE/setup"
cp "$REPO/dist/setup.sha256" "$SITE/setup.sha256"
diff -q "$SITE/setup" "$REPO/install/setup.sh" >/dev/null || { echo "the emitted installer is not install/setup.sh"; exit 1; }
sh -n "$SITE/setup" || { echo "the installer about to be published does not parse"; exit 1; }
echo "   /setup copied and parses"

echo "== 6. what we are about to publish says $V =="
tar -xzOf "$SITE/dist/kosmos-arm64.tar.gz" app/package.json | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const v=JSON.parse(s).version;
  console.log('   bundled version:', v);
  if(v!=='$V'){ console.error('   THE BUNDLE IS NOT $V'); process.exit(1); }
});"

echo "== 7. the versions page needs its entry BEFORE you deploy =="
grep -q "id=\"v$(echo "$V" | tr . -)\"" "$SITE/versions.html" \
  && echo "   $V is on the page" \
  || { echo "   $V has no entry in $SITE/versions.html. Write it (ruled copy, real timestamp) and re-run."; exit 1; }

# 🛑 AND THE TIMESTAMP HAS TO BE THE CLOCK, WHICH IT WAS NOT FOR TWENTY
# RELEASES. On the night of 2026-08-21 every entry from 0.2.38 to 0.2.57 was
# written by adding a plausible gap to the entry above it instead of reading a
# clock, so the error COMPOUNDED: 16 minutes wrong at 0.2.38, 137 minutes wrong
# at 0.2.57, and the four newest entries claimed release times that had not
# happened yet. Nothing could catch it, because each entry looked reasonable
# beside its neighbour and the page has no other clock in it.
#
# 🔑 A GUESS CANNOT SATISFY THIS. The check is against `date` at the moment of
# release, which is the one thing an estimate cannot agree with by accident,
# and it prints the exact string to paste rather than describing it.
NOW_STAMP="$(date '+%B %-d, %Y, %-I:%M %p %Z')"
ENTRY_STAMP="$(sed -n "/id=\"v$(echo "$V" | tr . -)\"/,/<\/article>/p" "$SITE/versions.html" \
  | sed -n 's/.*rel-d">\([^<]*\)<.*/\1/p' | head -1)"
STAMP_OK="$(V_ENTRY="$ENTRY_STAMP" node -e "
  const s = process.env.V_ENTRY || '';
  const m = s.match(/^(\w+) (\d+), (\d+), (\d+):(\d+) (AM|PM)/);
  if (!m) { console.log('unparseable'); process.exit(0); }
  const months = 'January February March April May June July August September October November December'.split(' ');
  let h = Number(m[4]) % 12; if (m[6] === 'PM') h += 12;
  const t = new Date(Number(m[3]), months.indexOf(m[1]), Number(m[2]), h, Number(m[5]));
  const off = Math.round((Date.now() - t.getTime()) / 60000);
  console.log(Math.abs(off) <= 20 ? 'ok' : String(off));
")"
if [ "$STAMP_OK" != "ok" ]; then
  echo "   the entry for $V is stamped: $ENTRY_STAMP"
  echo "   the clock says:              $NOW_STAMP"
  echo "   that is off by $STAMP_OK minutes (positive means the entry is in the past)."
  echo "   Paste the clock line above into the entry's rel-d and re-run."
  exit 1
fi
echo "   its timestamp agrees with the clock"

echo "== 7b. the site's release files are committed and pushed BEFORE they deploy =="
# 🛑 SERVED FROM THE WORKING TREE MEANS SERVED FROM NOBODY'S HISTORY. This
# script committed and pushed $REPO but only COPIED into $SITE, and the deploy
# then shipped the working tree, so eleven releases' installers went live with
# no commit behind them (#568; step 8 now deploys an export of HEAD, so what
# is committed here is what ships): the swap-proof installer that ended the
# 0.5.13 wedge was serving and unrecorded, and the "error line numbers
# match no revision" tell that diagnosed that wedge is confounded while
# the served script matches no revision at all. Named paths only, never
# add -A: the site checkout carries other people's in-progress page work.
[ "$(git -C "$SITE" rev-parse --abbrev-ref HEAD)" = main ] || { echo "the site checkout is not on main"; exit 1; }
# 🛑 PATH-LIMITED AT EVERY STEP, the commit included. `git add <paths>`
# alone was not enough: a plain `git commit` takes the WHOLE index, so
# anything somebody had staged in this shared checkout would have ridden
# the release commit to origin/main unseen (caught in review). The
# `-- <paths>` on the commit leaves other staged work exactly as staged.
# What the push DOES carry: any commits already on this checkout's main
# that were not pushed yet, which the deploy would serve regardless.
_site_paths="dist/latest.json dist/kosmos-$V-arm64.manifest.json setup setup.sha256 versions.html"
# shellcheck disable=SC2086
git -C "$SITE" add $_site_paths
# shellcheck disable=SC2086
if ! git -C "$SITE" diff --quiet HEAD -- $_site_paths; then
  # shellcheck disable=SC2086
  git -C "$SITE" commit -q -m "$V: the served installer, pointer and versions entry" -- $_site_paths
fi
# The sha that deploys is the sha that is PUSHED, read before the push and
# pushed by name: the checkout is shared and a commit can land between a
# push of "HEAD" and the archive (#649).
# ⚠️ ON MAIN, CHECKED HERE and not only at the top of 7b's block: the push
# below names refs/heads/main as its target, so a site checkout left on some
# branch would put that branch's tip (plus this commit) onto main, or be
# rejected with a message that blames the wrong cause.
[ "$(git -C "$SITE" rev-parse --abbrev-ref HEAD)" = main ] || { echo "the site checkout is on '$(git -C "$SITE" rev-parse --abbrev-ref HEAD)', not main; refusing to push its tip onto origin/main"; exit 1; }
SITE_SHA="$(git -C "$SITE" rev-parse HEAD)"
git -C "$SITE" push -q origin "$SITE_SHA:refs/heads/main" || {
  echo "could not push the site (origin/main moved, or no network). The $V site commit is local."
  echo "Recover: git -C \"$SITE\" pull --rebase && git -C \"$SITE\" push, then re-run release.sh; expect to bump the version, because the bundle build is not byte-reproducible and the versioned name refuses different bytes."
  exit 1
}
# shellcheck disable=SC2086
[ -z "$(git -C "$SITE" status --porcelain -- $_site_paths)" ] || { echo "release files still dirty after the commit"; exit 1; }
echo "   site committed and pushed: $(git -C "$SITE" log --oneline -1 "$SITE_SHA")"

echo "== 8. deploy, from an export of the COMMITTED site plus the named artifacts (#649) =="
# 🛑 NEVER THE WORKING TREE. This deployed $SITE itself, so a cut published
# whatever anybody had uncommitted in the shared checkout (a half-edited
# homepage twice during the 0.5.22 cut, caught by hand), and the gitignored
# release artifacts reached production only through that accident. The
# export is `git archive` of the sha 7b pushed (the pages as committed)
# plus each artifact class by name (tools/lib/site-deploy.sh says which and
# why), and it prints what the working tree holds that does NOT ship. It
# lives under BUILD_ROOT so the 2b trap removes it.
# ⚠️ The export has no .git, so the Vercel dashboard shows no commit for these
# deploys (the CLI reads <cwd>/.git for that); the manifest's "pages: commit"
# line below is the link from a deployment to its commit.
. "$REPO/tools/lib/site-deploy.sh"
_site_export="$BUILD_ROOT/site-export"
site_deploy_export "$SITE" "$_site_export" "$SITE_SHA" || { echo "could not export the site for deploy; nothing was deployed"; exit 1; }
# The filter that ACTUALLY ships is the export's; 3c read HEAD's early, and
# the sha can have moved since. Same evaluator, same refusal, on the real file.
set +e; _dep_dropped="$(pkg_upload_filter_excludes "$_site_export/.vercelignore")"; _dep_frc=$?; set -e
if [ "$_dep_frc" = 1 ]; then echo "the export has no .vercelignore; nothing was deployed"; exit 1
elif [ "$_dep_frc" != 0 ]; then echo "could not evaluate the export's .vercelignore (rc=$_dep_frc); nothing was deployed"; exit 1
elif [ -n "$_dep_dropped" ]; then echo "the export's .vercelignore would drop $_dep_dropped; nothing was deployed"; exit 1
fi
( cd "$_site_export" && vercel deploy --prod --yes )

DEPLOYED=1   # step 8 finished: the site checkout now claims what is served, so the trap leaves it
echo "== 9. verify what is SERVED, from the code that fetches it =="
# ⚠️ Retried, because a deploy is live before every edge has it, and a single
# read cannot tell "not published" from "not yet".
SERVED_OK=0
for i in 1 2 3 4 5 6; do
  if SITE="$SITE" REPO="$REPO" bash "$REPO/tools/verify-served.sh"; then SERVED_OK=1; break; fi
  echo "   (attempt $i did not match; waiting)"
  sleep 10
done
if [ "$SERVED_OK" != 1 ]; then
  echo "SOMETHING A USER RECEIVES IS STILL WRONG AFTER SIX READS"
  exit 1
fi

echo "== 9b. the served bundle is the frozen tree, file by file (#597) =="
# The log's "built <sha>" is measured here rather than remembered: every
# tree-derived file in the versioned tarball people download (app/ and the
# top-level bin/kosmos) equals the frozen tree, web/index.html after the one
# substitution the build makes.
# ⚠️ RETRIED like step 9, and for the same reason: step 9 hit one edge; the
# edge THIS fetch lands on can still be a beat behind, and a single try would
# raise "not the tree that was tested" as a false alarm on cache lag rather
# than a real mismatch. Six reads, then it is real.
_served_tgz="$(mktemp)"
_bundle_ok=0
for i in 1 2 3 4 5 6; do
  if curl -fsSL -m 120 "${HOST:-https://installkosmos.com}/dist/kosmos-$V-arm64.tar.gz" -o "$_served_tgz" \
     && release_bundle_matches_tree "$_served_tgz" "$BUILD" "$TUNNEL_SHA"; then _bundle_ok=1; break; fi
  echo "   (attempt $i did not match the frozen tree; waiting)"
  sleep 10
done
rm -f "$_served_tgz"
if [ "$_bundle_ok" = 1 ]; then
  echo "   the served kosmos-$V-arm64.tar.gz is ${SHA:0:12}: every tree file (app/ and bin/kosmos) matches, and the connector is ${TUNNEL_SHA:0:12}"
else
  echo "THE SERVED BUNDLE IS NOT THE TREE THAT WAS TESTED (${SHA:0:12}) AFTER SIX READS"; exit 1
fi

echo "== 9c. the served installer .pkg is the one step 3c left in the site dist (#638, B guard) =="
# Step 3c decided from the site's working copy; this reads the SERVED host,
# because the deploy carries the pkg by name from an export (step 8) and an
# edge can serve the prior pair (Kosmos.pkg and its .sha256 share one cache).
# Four facts, all from the wire, and the red names the one that failed: the
# served inputs sidecar is the source's, the served pkg's bytes are the served
# checksum's, the sidecar vouches for those bytes, and those bytes are the
# site dist's. Retried like 9 and 9b: cache lag is not staleness until six
# reads agree. ⚠️ NO BARE `x="$(curl ...)"` CAPTURES: under set -e a 404 on
# the first read (a path that has never existed on the edge, exactly this
# step's first run) would kill the script before the loop retried, and the
# six-read message would never print. Every fetch lands in a file inside the
# if chain, the same shape as step 4's tar guard and step 9b. The temp dir
# lives under BUILD_ROOT so the EXIT trap from 2b removes it on an errexit
# inside the loop.
_pkg_ok=0; _pkg_dir="$(mktemp -d "$BUILD_ROOT/pkg9c.XXXXXX")"; _pkg_fact=""
for i in 1 2 3 4 5 6; do
  _pkg_fact="the served inputs sidecar could not be fetched"
  if curl -fsSL -m 30 -H 'Cache-Control: no-cache' "${HOST:-https://installkosmos.com}/dist/Kosmos.pkg.inputs" -o "$_pkg_dir/inputs"; then
    _pkg_fact="the served inputs ($(pkg_sidecar_inputs "$_pkg_dir/inputs" | cut -c1-12)) are not the source's (${_pkg_want:0:12})"
    if [ "$(pkg_sidecar_inputs "$_pkg_dir/inputs")" = "$_pkg_want" ]; then
      _pkg_fact="the served Kosmos.pkg or its .sha256 could not be fetched"
      if curl -fsSL -m 120 "${HOST:-https://installkosmos.com}/dist/Kosmos.pkg" -o "$_pkg_dir/Kosmos.pkg" \
         && curl -fsSL -m 30 "${HOST:-https://installkosmos.com}/dist/Kosmos.pkg.sha256" -o "$_pkg_dir/sha256"; then
        _pkg_real="$(_pkg_hash < "$_pkg_dir/Kosmos.pkg" | awk '{print $1}')"
        _pkg_fact="the served Kosmos.pkg's bytes (${_pkg_real:0:12}) are not its served checksum's ($(awk '{print substr($1,1,12)}' "$_pkg_dir/sha256"))"
        if [ "$_pkg_real" = "$(awk '{print $1}' "$_pkg_dir/sha256")" ]; then
          _pkg_fact="the served sidecar vouches for other bytes ($(pkg_sidecar_pkgsha "$_pkg_dir/inputs" | cut -c1-12)) than the served pkg's (${_pkg_real:0:12})"
          if [ "$(pkg_sidecar_pkgsha "$_pkg_dir/inputs")" = "$_pkg_real" ]; then
            _pkg_fact="the served Kosmos.pkg is not the one the export deployed (an edge is holding the prior pair)"
            # Against the EXPORT's copy (the file that deployed; a real copy
            # under BUILD_ROOT, not a link), not the shared working tree, which
            # can be replaced in place during the ten-minute wait.
            if cmp -s "$_pkg_dir/Kosmos.pkg" "$_site_export/dist/Kosmos.pkg"; then _pkg_ok=1; break; fi
          fi
        fi
      fi
    fi
  fi
  echo "   (attempt $i: $_pkg_fact; waiting)"
  sleep 10
done
rm -rf "$_pkg_dir"
if [ "$_pkg_ok" = 1 ]; then
  if [ "${PKG_PUBLISHED:-0}" = 1 ]; then echo "   the served Kosmos.pkg is the one published in 3c: inputs ${_pkg_want:0:12}, checksum agrees, sidecar vouches for these bytes"
  else echo "   the served Kosmos.pkg is current: inputs ${_pkg_want:0:12} match source, checksum agrees, sidecar vouches for these bytes"; fi
else
  if [ "${PKG_PUBLISHED:-0}" = 1 ]; then echo "THE SERVED INSTALLER PKG IS NOT THE ONE 3c PUBLISHED, AFTER SIX READS: $_pkg_fact."
  else echo "THE SERVED INSTALLER PKG IS NOT THE SITE DIST'S (nothing was rebuilt this cut), AFTER SIX READS: $_pkg_fact."; fi
  echo "   Either the deploy did not carry dist/Kosmos.pkg* or an edge is holding the prior pair."; exit 1
fi

echo "== 9d. the served manifest answers for the served bytes (#776) =="
# The manifest the build wrote (step 4) was committed beside the pointer (7b)
# and deployed (8); this reads BOTH back from the wire and checks the
# artifact's sha and every file's sha against it. Not a volunteer's check
# after the fact: a cut is not done until the served bytes are the ones the
# build recorded. Small cuts, many times a day (Josh, 2026-08-25), is exactly
# when a check that depends on someone being awake stops happening.
if ! bash "$REPO/tools/verify-manifest.sh" "$V"; then
  echo "THE SERVED MANIFEST DOES NOT ANSWER FOR THE SERVED BYTES. The pointer is live; what it points at is not what the build recorded. Do not announce this cut; read the mismatch above."
  exit 1
fi

echo "== 10. the board on THIS Mac, if it runs from this repo =="
# 🛑 Installs update themselves from what step 9 verified; the developer's own
# board runs the repo under launchd and never did, so every release left it
# serving the previous code until somebody noticed (#360). Gated on the job
# existing AND running from this repo; it says which case it found.
bash "$MAIN_REPO/tools/restart-local-board.sh"
