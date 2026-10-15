# setupfloor-6149: the rollback floor (#6149 point 1)

## Why
#4455 (merged as #6146, in 0.7.49, now served on prod and staging) makes the installed app read-only. An installer
that cannot lift that lock (any cut before #4449) removes bin/, fails at the read-only app/, and cannot put the board
back, on every Mac and Linux install that 0.7.49 touched. The rule's floor is 0.7.45, the first such installer served
on prod: stricter than needed (some earlier installers can lift too: 0.7.40's staging installer already had the lift), which fails closed. The rule ("never serve a /setup or /setup-staging older than 0.7.45") was prose
only. Splinter asked for it in the promote and rollback path before Josh's go for 0.7.49's prod promote.

## What
- tools/lib/setup-floor.sh, the floor (0.7.45) and five checks: floor_ok, pointer_ok, installer_ok, tree_ok and site_untouched_ok (the last two
  combine the first three):
  - `kosmos_setup_floor_ok <label> <version>`: a numeric part-by-part compare (0.7.100 is above 0.7.45); a version
    that is not plain numbers and dots is refused.
  - `kosmos_setup_floor_pointer_ok <label> <json>`: a Mac pointer's version AND the version in its artifact name
    (kosmos-<v>-<arch>.tar.gz) must clear the floor and agree; any other artifact shape is refused (fail closed).
  - `kosmos_setup_floor_tree_ok <who> <dir>`: the tree a deploy publishes: both pointers through the pointer check,
    and /setup and /setup-staging must carry KOSMOS_READONLY_APP. A pointer's version says nothing about the
    installer bytes beside it (a hand rollback can commit an old one next to a new pointer). The switch and the
    lift came in one change, #4449, so naming the switch means the installer can lift the lock. Measured by Ice
    Cream Kitty at each version commit's install/setup.sh: 0.7.42 6 mentions, 0.7.43 to 0.7.48 7, 0.7.49 9; the prod
    /setup served before 0.7.45 (0.7.35's) has 0; today's /setup 7, /setup-staging 9.
    CORRECTION (mine): an earlier version of this plan said "0.7.44's /setup 0"; the file I read was the previous
    commit in the site's setup history, which is 0.7.35's prod /setup, not 0.7.44's.
- Called:
  - publish-staging-pointer.sh, before the staging pointer is written (version);
  - promote-channel.sh (mac family), on the staging snapshot's version and artifact, before prod is touched;
  - deploy-site.sh, early on both committed pointers (fail fast), and on its EXPORT right before vercel (the bytes
    it publishes);
  - release.sh, on its own site export right before its vercel deploy (a cut publishes both pointers and both
    installers too, including the ones the cut does not touch), and early (step 1a-floor) on the pair the cut re-publishes UNTOUCHED, read from the site's origin/main (fetched,
    when that ref resolves; the checkout only if not; a file origin/main lacks is named and not checked here) (the prod pair for a staging cut, the staging pair for a prod cut: the pair
    a cut writes is the remedy, not checked there), a fail-fast on a checkout that may be behind origin/main.
  - promote-channel.sh also checks the installer before any write: setup-staging when it is about to become /setup,
    or, when the staging pointer names no installer, the /setup prod keeps serving beside the new pointer.
  - release.sh refuses the test knob outright (no test drives a cut with it), and at step 1a also checks the cut's
    own install/setup.sh (the checkout's), then, right after the freeze (step 2b), the FROZEN install/setup.sh it
    actually publishes (the shared checkout can be fast-forwarded between step 1 and the freeze): both before
    anything is built (the frozen one after step 2's bump push, see Known limits).
    release.sh checks the version the cut names ONLY under KOSMOS_ALLOW_VERSION_JUMP: otherwise #4075's forward-only
    rule refuses a cut older than the checkout's package.json, which is past 0.7.45 in any checkout carrying this
    step. An unconditional check reddened 17 tests of tools.release-gate.test.js (its fixtures cut 0.6.x on purpose)
    in the Mortals validation of 97ec10391.
    The library is loaded once, at step 1a, and never re-sourced from the frozen tree (its functions are defined).
- deploy-site's early committed-pointer check is a fail-fast: its export check would refuse the same pointers;
  only the staging-pointer arm of the test is specific to it.
- NOT covered, and said so in docs/staging-channel.md: a rollback done in Vercel itself (Instant Rollback,
  `vercel rollback`, `vercel promote` of an older deployment) and a hand-run `vercel deploy --prod` go around every
  script. No code here can close them.
- docs/staging-channel.md's floor section no longer says nothing in the tools refuses it.
- Out of scope, on purpose: the .pkg (its postinstall fetches and verifies /setup, so /setup covers it) and the
  unversioned alias tarball (the app, not an installer).
- No override for real use: the fix for an old build is a newer build, never a flag.

## Decided
- The pointer floor is 0.7.45, the first PROD-served installer that can lift the lock; some earlier installers can lift
  too (the marker check accepts them), so 0.7.45 is stricter than needed, which fails closed.
- The floor is unconditional, not "only once 0.7.49 is served": a rollback of staging to 0.7.47 would disarm a
  conditional floor, and the next step down would break installs that had 0.7.49.
- Tests whose fixtures are 0.6.x builds lower it with BOTH KOSMOS_SETUP_FLOOR_TEST=1 and a plain-number
  KOSMOS_SETUP_FLOOR_LOWER (one alone, or a non-numeric value, keeps the real floor); every lowered check warns. The
  knob lowers ONLY the version floor: the installer-marker check always runs, and the fixtures' stand-in installers
  carry the marker (review of #6200: a lowered floor used to skip it, and deploy-site and promote-channel honour the
  knob, so `KOSMOS_SETUP_FLOOR_TEST=1 KOSMOS_SETUP_FLOOR_LOWER=0.7.44 deploy-site.sh --publish` could ship an installer
  with no lift). Weakest premise: the knob is environment an operator could also set; at worst it now lets through
  an OLD VERSION number whose installer still knows the read-only app. It takes two variables and warns.
- Windows is out of scope: its pointers and zips have no /setup.
- The marker is a content check, so an installer that drops KOSMOS_READONLY_APP some day would be refused: that
  fails closed and loud, and the fix is to update KOSMOS_SETUP_FLOOR_MARKER with it.
- release.sh's call is not run by a test (a cut cannot run in the suite); it is the same function the export arms
  of test-deploy-site-promote.sh run, and test-setup-floor-6149.sh asserts it sits above release.sh's vercel deploy.
- A consequence, intended: once a committed pointer is below the floor, every site deploy is refused, an HTML-only
  one included, until a Mac build at or above the floor is cut. That is the fail-closed shape: the fix is a build.
- Declined (reviews 3 and 9): also requiring a test-run marker (KOSMOS_TEST_RUN) for the knob. CI's shell shards do not set
  it, so each test would set it itself: a third variable the same tests set adds nothing over the two required.

## The real site passes (measured 14:16 on the served files, and on chaoskosmos-site origin/main by reviews 4 and 11)
Before the 0.7.49 promote: dist/latest.json 0.7.47, dist/latest-staging.json 0.7.49, /setup 7 marker hits,
/setup-staging 9. After it (16:2x, origin/main): both pointers 0.7.49, /setup 9, /setup-staging 9. Either way no
deploy, promote or cut that is valid today is refused by this change.

## Known limits (reviews 9 to 44), stated rather than closed
- release.sh's step 1a-floor runs through the real script for PROD cuts only (the release-gate arms check the staging
  pair, on both the fallback and the origin/main path); a STAGING cut's choice of the prod pair is tested at the
  library level (site_untouched_ok arms), not through release.sh.
- The marker check skips whole-line comments only: a trailing comment or a quoted string naming the marker passes
  (the installer check is a string check, not a proof; real installers carry it on code lines).
- If BOTH channels' pointers or both installers are below the floor, every cut refuses (each checks the other
  channel's pair). The repairs need no cut; docs/staging-channel.md, "Repairing a site the floor refuses", is the one
  place they are written (each step traced against deploy-site's modes, #5032 and #4819), and release.sh's refusal
  points there.
- A NUL byte in a pointer is dropped by command substitution before the ASCII check sees it. The installer's own
  $(curl ...) capture drops it too (so it reads what the check read), and JSON.parse rejects the pointer, so the
  app's update path fails closed rather than installing something old.
- The installer check is a string check on a non-comment line, not a proof the installer lifts the lock.
- The floor guards against mistakes, not a hostile environment: whoever controls PATH, BASH_ENV or an exported
  function controls every tool the checks run (and vercel itself). Tool-named functions are cleared on load,
  GREP_OPTIONS cannot invert a check (no grep decides one), and every check needs a POSITIVE answer (a printed
  verdict, a count of exactly 0 or 1), so a broken or shadowed tool refuses rather than passes.
- The site repo's own vercel-prod-deploy gate hook accepts any site_deploy_export output, so a hand export followed by
  a hand vercel deploy passes it without the floor (the hand-deploy class; DEPLOY.md and the README show the way).
- site-autodeploy.sh's KOSMOS_AUTODEPLOY_DEPLOY test seam runs a given command instead of deploy-site.sh, so no floor
  check runs under it (pre-existing; test-site-autodeploy-5589.sh uses it). Never set it on a real autodeploy.
- The tree checks read the committed setup, setup-staging and dist/latest*.json; they do not read vercel.json. A
  redirect or rewrite of /setup or a Mac pointer added there (the site already redirects /dist/latest-win.json)
  would serve something else past every check. None exists today for those paths.
- Without the version-jump override, release.sh relies on #4075 to keep a cut's own version above the floor, which
  assumes the checkout's package.json is past 0.7.45. Only a hand revert breaks that; such a cut would push its site
  commit (step 7b) before the export check refused it. Nothing is served.
- release.sh's frozen-installer check runs after step 2's version-bump push (the freeze follows the bump). Step 1a
  checked the checkout's install/setup.sh before that push; only a fast-forward between step 1 and the freeze that
  brought in an installer without the marker refuses here, with the bump already on origin. Nothing is built or
  served.
- A checkout that predates this change has no floor at all: site-autodeploy runs that checkout's own
  tools/deploy-site.sh. Every checkout that pulls main after the merge has it; until then the hand check stands.
- release.sh pushes its site commit (step 7b) BEFORE its export check: if the fresh-main rebase pulled in a pointer
  or installer below the floor that the early checkout check did not see, that tree is on the site's main when the
  cut refuses. It is never served by these tools (site-autodeploy runs deploy-site.sh, which refuses it), but every
  site deploy then stays refused until a fix lands. Checking inside site_commit_on_fresh_main before the push would
  close it; not done here, to keep tools/lib/site-deploy.sh out of this change.
- release.sh's export check is tested by source (its order above vercel and its failure tail), not run: a cut
  cannot reach step 8 in the suite. Step 1a-floor IS run through the real release.sh by six arms of
  tools.release-gate.test.js: the version-jump refusal and its control; an untouched staging pair without the marker
  refused and its control on a plain-directory site (the fallback); and the same on a real clone whose origin/main,
  not its checkout, holds the pair (the main path, after the fetch).
- docs/staging-channel.md's manual fallback commits and pushes the pointer BEFORE its floor check (which runs on the
  export, before vercel): the same class as release.sh's step 7b. Never served (the site does not deploy main by
  itself, and site-autodeploy runs deploy-site.sh, which refuses it), but site deploys stay refused until fixed.
- deploy-site's early committed latest.json check is not separately pinned: its export check refuses the same
  pointer (same refusal text, a different label; arm 35 matches the common text), so deleting the early one only loses the fail-fast (the staging one is pinned, arm 39).
- release.sh step 1a reads origin/main after a fetch (a stale checkout once refused a valid cut in review 15's
  reading); if the fetch fails it reads the checkout and says so.
- deploy-site's own #4819 refusal is shadowed for a malformed staging artifact by the floor's earlier refusal in
  test-deploy-site-promote.sh's FIRST arm 20 (the malformed staging pointer; the file numbers two arms 20); it is still covered by test-deploy-site-staged-mac-4819.sh (st8, st13).
- deploy-site.sh, promote-channel.sh and publish-staging-pointer.sh honour the knob (their tests use it); only
  release.sh refuses it. Every lowered check warns.

## Tests
tools/test-setup-floor-6149.sh: the library (boundary, numeric compare, unreadable versions, the knob in each
combination, the pointer check, the tree check), then the REAL promote-channel.sh and publish-staging-pointer.sh on a
temp site (refused below the floor with nothing written; a 0.7.49 control reaches each script's next check).
tools/test-deploy-site-promote.sh runs deploy-site for real: under the real floor, a pointer below it, an old installer beside a 0.7.49 pointer, a staging pointer below it (each refused with
nothing deployed) and a control that deploys; under the lowered floor, a pointer naming another version's tarball (a
check that does not depend on the floor). Registered in test:shell.
