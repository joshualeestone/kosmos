# setupstaging-5032: the installer is channelled like the pointer (kosmos#5032)

Decision and reasoning: https://github.com/joshualeestone/kosmos/issues/5032#issuecomment-5955763976

## Defect
`tools/release.sh` step 5 copied `dist/setup` to the site's `/setup` on EVERY cut. Staging cuts gate the
pointer (latest-staging.json) and the prod alias, but not the installer, so between a staging cut and its
promote every prod install and prod in-app update ran the NEW installer against the OLD prod tarball: a
combination no channel tests. setup.sh had 36 commits in September.

## Change
- release.sh: `SETUP_FILE` from the channel (staging -> setup-staging, prod -> setup). Step 5, the release
  commit's `_site_paths`, the post-push discard, step 9's verify (`KOSMOS_VERIFY_SETUP`) and the staging
  hand-off's fresh-install line use it.
- verify-served.sh: `KOSMOS_VERIFY_SETUP` (setup | setup-staging, anything else refused before any fetch)
  chooses which served installer is compared with install/setup.sh and with the site's origin/main.
- lib/release-freeze.sh `release_site_restore`: puts back a changed tracked setup-staging pair; removes an
  untracked one (never committed = never served).
- THE POINTER NAMES ITS INSTALLER (review 1): release.sh passes the build's installer sha to
  tools/lib/write-latest-pointer.js (KM_LJ_SETUP_SHA -> "setup_sha256", optional, must be a sha256).
  Promote copies the pointer verbatim, so latest.json names the /setup it belongs beside.
- promote-channel.sh (Mac): if the staging pointer names an installer, setup-staging must be committed,
  unmodified, hash to that sha, and its sidecar must agree, checked before any write; after the pointer
  and alias the pair is copied onto setup / setup.sha256 (temp + rename, read back). A pointer naming no
  installer (before #5032, or republished by hand) leaves /setup alone, whatever setup-staging holds.
- deploy-site.sh: EVERY deploy (promote, rollback, site copy) refuses when the committed latest.json names
  an installer and the committed setup or setup.sha256 is not it. This replaced a setup == setup-staging
  blob comparison that review 1 showed wrong for rollbacks (it passed a rollback beside the newer
  installer, refused the correct one, and refused every rollback while a staging cut was pending).
  Every deploy also edge-checks the /setup-staging pair when the commit carries one.
- engine/update.js `setupUrl()`: `/setup-staging` when `installPointer()` is staging.
- Docs: releasing.md, staging-channel.md (promote step, commit line, fresh install), phone-push-go-live.md.
- Site half (chaoskosmos-site branch setupstaging-5032): vercel.json headers for the new pair. Merges first,
  and release.sh step 1f (before the bump) refuses a staging cut while the site's vercel.json lacks them.
- release_site_restore keeps an untracked setup-staging file origin/main already holds WITH THE SAME BYTES (a cut
  that died after 7b's push and before its deploy); other bytes are removed (review 5).
- promote-channel.sh's installer checks run BEFORE the board gates (review 5: the predictable refusal on a stale
  checkout costs seconds, not a gate run), with a hash re-check right before the first write.

## Tests
- tools/test-setup-staging-5032.sh (new, in test:shell): channel selection evaluated; the release.sh
  installer-sha block RUN on a fixture (right sha; a lying sidecar refuses); source checks of step 5 /
  site paths / verify and audit calls; verify-served name gate run (with a control reaching the network
  control); restore arms run with controls; promote copy + no-field arms + seven refusals run on a fixture
  git site, each refusal asserting the prod pointer and /setup unchanged; the unnamed-installer WARNING
  with a control; publish-staging keeps the name for the same build only (control: another build); the
  pointer writer's field (absent, present, refused when not a sha).
- engine/update.win32-check.test.js: staging box -> /setup-staging, prod control -> /setup.
- tools/test-staging-wire-2036.sh: the hand-off grep now expects /setup-staging.
- tools/test-deploy-site-promote.sh cases 19-27 (RUN, not grepped): matching installer deploys and is
  served; mismatched promote and mismatched site copy refuse with nothing served; a lying sidecar
  refuses; a committed /setup-staging pair deploys and passes its edge check, a mangled served one is
  refused; a pointer naming an installer over a commit with no sidecar is refused.
  Case 27 (review 13): an edge serving an OLD /setup pair that agrees with its own sidecar is refused by the
  served-vs-pointer check (deploy-site.sh, the CSETUP line); deleting that line reds case 27 alone (measured 12:07
  CDT 2026-10-02 in a scratch worktree), case 19 is its passing control.
- tools/test-artifact-setup-source-2360.sh: its static pins follow the \$SETUP_NAME spelling (review 3). Cases 1-18 (pointers with no field) are the not-checked control.

## Rejected
- Keep one /setup and flag setup.sh diffs at cut time: keeps the untested combination.
- A prod-channel cut writing /setup-staging too: would pair the newest installer with an older staging
  pointer on staging boxes, the same untested combination moved to staging.
- Rewriting the sidecar's name field to "setup-staging": every reader takes field 1 only, and a verbatim
  copy makes the promote a straight copy.

## Weakest premise
That no installer change must reach prod boxes before their app update. The escape hatch is a
prod-channel cut (KOSMOS_CUT_CHANNEL=prod), which still writes /setup directly.

## Residuals
- promote is not atomic across latest.json and the /setup pair; a failure between them is refused by deploy-site and
  the message names the by-hand finish (review 12, kept). An aborted cut's restore also reverts an UNCOMMITTED promote
  in the site checkout (setup with latest.json, consistently); commit a promote before cutting again.
- `curl .../setup-staging | sh` WITHOUT `KOSMOS_UPDATE_CHANNEL=staging` on the sh installs the prod tarball with the
  staging installer. setup.sh cannot tell which URL served it; every doc and the hand-off put the variable on the
  sh, and update.js passes it.
- install/kosmos's "Reinstalling fixes this: curl .../setup | sh" hints send a staging box to the prod installer
  (as before this card; a staging box should use /setup-staging with KOSMOS_UPDATE_CHANNEL=staging).
- promote writes latest.json before the /setup pair. A filesystem failure between them leaves a half-promote that
  deploy-site refuses (the prod pointer names an installer /setup is not); the message says to re-run. Either order
  leaves a refusable half state, so the pointer, which the guard reads, moves first.
- A staging box whose release base points at a mirror with no /setup-staging now gets a 404 on update where
  it used to fetch /setup (no such mirror exists today).
- Rollback to a pointer from BEFORE #5032 (no setup_sha256): unchecked, so after the first #5032 promote it
  would serve the old build beside the newer /setup. Restore that pointer's installer by hand too (the setup
  pair committed with it); docs/staging-channel.md step 5 and the cut hand-off say so (review 4).
- First cuts after this lands: staging boxes still on a pre-#5032 build update with /setup (prod's
  installer) until they run a build carrying the new setupUrl, so for those cuts only FRESH staging
  installs (from /setup-staging) exercise the installer the promote will put on /setup.
- Kosmos.pkg: a staging cut whose pkg inputs changed still copies the rebuilt .pkg into the site's dist/,
  the prod download button. Same class (a staging cut reaching prod), not fixed here.
- publish-staging-pointer.sh keeps setup_sha256 only when it republishes the same version, artifact and sha
  the current staging pointer names (review 2); any other republish names no installer, and a promote of
  it leaves /setup as it is, with a WARNING when a differing setup-staging is committed.
- Rollback: the deploy guard REFUSES a #5032 pointer served beside the wrong installer, so the operator
  must put that pointer's installer back by hand (docs/staging-channel.md step 5 says where it is).
  Refused rather than automated.
- A staging box whose updater is new while the site has never had a /setup-staging (only if a prod-channel
  cut carried this change before any staging cut did) fetches a 404; the next staging cut fixes it.
- Step 9e's outside audit (kosmos-artifact-check.sh) now audits the channel's installer (review 2:
  KOSMOS_VERIFY_SETUP), so a staging cut that raises the macOS floor is not a false red. It still reads
  the PROD pointer for the artifact half on every cut, as before this card.
- tools/clean-machine.sh walks /setup by default; KOSMOS_VERIFY_SETUP=setup-staging walks the staging one.
