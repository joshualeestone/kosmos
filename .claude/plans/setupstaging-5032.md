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
- promote-channel.sh (Mac): before any write, a present setup-staging pair must be committed, unmodified,
  and its sidecar must name its bytes; after the pointer and alias, the pair is copied onto setup /
  setup.sha256 (temp + rename, read back). Absent pair (a staging cut before #5032) = /setup left alone.
  Prints that setup + setup.sha256 must be committed with latest.json.
- deploy-site.sh: `--promote` refuses when the site has a committed setup-staging and the committed setup
  (or its sidecar) is not the same blob; every deploy checks the /setup-staging pair at the edge when the
  commit carries one.
- engine/update.js `setupUrl()`: `/setup-staging` when `installPointer()` is staging.
- Docs: releasing.md, staging-channel.md (promote step, commit line, fresh install), phone-push-go-live.md.
- Site half (chaoskosmos-site branch setupstaging-5032): vercel.json headers for the new pair. Merges first.

## Tests
- tools/test-setup-staging-5032.sh (new, in test:shell): channel selection evaluated; source checks of
  step 5 / site paths / verify call; verify-served name gate run (with a control reaching the network
  control); restore arms run with controls; promote copy + absent arm + four refusals run on a fixture
  git site, each refusal asserting the prod pointer and /setup unchanged; deploy-site guard source check
  and its name mapping evaluated under sh.
- engine/update.win32-check.test.js: staging box -> /setup-staging, prod control -> /setup.
- tools/test-staging-wire-2036.sh: the hand-off grep now expects /setup-staging.

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
- Rollback by promoting a PRIOR staging pointer copies the CURRENT setup-staging onto /setup; restore the
  prior commit's setup-staging pair with the pointer (documented here; not automated).
- A staging box whose updater is new while the site has never had a /setup-staging (only if a prod-channel
  cut carried this change before any staging cut did) fetches a 404; the next staging cut fixes it.
- Step 9e's outside audit (kosmos-artifact-check.sh) reads the prod pointer and /setup; it does not audit
  /setup-staging (unchanged by this card; step 9 verify-served covers the staging installer's bytes).
