# setupfloor-6149: the rollback floor (#6149 point 1)

## Why
#4455 (merged as #6146, in 0.7.49, now on staging) makes the installed app read-only. An installer older than 0.7.45
does not lift that lock: it removes bin/, fails at the read-only app/, and cannot put the board back, on every Mac and
Linux install that 0.7.49 touched. The rule ("never serve a /setup or /setup-staging older than 0.7.45") was prose
only. Splinter asked for it in the promote and rollback path before Josh's go for 0.7.49's prod promote.

## What
- tools/lib/setup-floor.sh, the floor (0.7.45) and three checks:
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
    installers too, including the ones the cut does not touch), and early (step 1a-floor) on the site checkout's
    pair the cut re-publishes UNTOUCHED (the prod pair for a staging cut, the staging pair for a prod cut: the pair
    a cut writes is the remedy, not checked there), a fail-fast on a checkout that may be behind origin/main.
  - promote-channel.sh also checks the installer before any write: setup-staging when it is about to become /setup,
    or, when the staging pointer names no installer, the /setup prod keeps serving beside the new pointer.
  - release.sh refuses the test knob outright (no test drives a cut with it), and at step 1a also checks the cut's
    own install/setup.sh, before anything is built or pushed.
- deploy-site's early committed-pointer check is a fail-fast: its export check would refuse the same pointers;
  only the staging-pointer arm of the test is specific to it.
- NOT covered, and said so in docs/staging-channel.md: a rollback done in Vercel itself (Instant Rollback or
  `vercel rollback`) to a deployment from before 0.7.45 goes around every script. No code here can close it.
- docs/staging-channel.md's floor section no longer says nothing in the tools refuses it.
- Out of scope, on purpose: the .pkg (its postinstall fetches and verifies /setup, so /setup covers it) and the
  unversioned alias tarball (the app, not an installer).
- No override for real use: the fix for an old build is a newer build, never a flag.

## Decided
- The pointer floor is 0.7.45, the first PROD-served installer that can lift the lock; 0.7.42 to 0.7.44 can lift
  too (the marker check accepts them), so 0.7.45 is stricter than needed, which fails closed.
- The floor is unconditional, not "only once 0.7.49 is served": a rollback of staging to 0.7.47 would disarm a
  conditional floor, and the next step down would break installs that had 0.7.49.
- Tests whose fixtures are 0.6.x builds lower it with BOTH KOSMOS_SETUP_FLOOR_TEST=1 and a plain-number
  KOSMOS_SETUP_FLOOR_LOWER (one alone, or a non-numeric value, keeps the real floor); every lowered check warns, and
  the installer-marker check is skipped under it (the fixtures' installers are stand-ins). Weakest premise: the
  knob is environment an operator could also set. It takes two variables, warns on every check, and a real promote
  or deploy sets neither.
- Windows is out of scope: its pointers and zips have no /setup.
- The marker is a content check, so an installer that drops KOSMOS_READONLY_APP some day would be refused: that
  fails closed and loud, and the fix is to update KOSMOS_SETUP_FLOOR_MARKER with it.
- release.sh's call is not run by a test (a cut cannot run in the suite); it is the same function the export arms
  of test-deploy-site-promote.sh run, and test-setup-floor-6149.sh asserts it sits above release.sh's vercel deploy.
- A consequence, intended: once a committed pointer is below the floor, every site deploy is refused, an HTML-only
  one included, until a Mac build at or above the floor is cut. That is the fail-closed shape: the fix is a build.
- Declined (reviews 3 and 9): also requiring a test-run marker (KOSMOS_TEST_RUN) for the knob. CI's shell shards do not set
  it, so each test would set it itself: a third variable the same tests set adds nothing over the two required.

## Known limits (reviews 9 and 10), stated rather than closed
- release.sh pushes its site commit (step 7b) BEFORE its export check: if the fresh-main rebase pulled in a pointer
  or installer below the floor that the early checkout check did not see, that tree is on the site's main when the
  cut refuses. It is never served by these tools (site-autodeploy runs deploy-site.sh, which refuses it), but every
  site deploy then stays refused until a fix lands. Checking inside site_commit_on_fresh_main before the push would
  close it; not done here, to keep tools/lib/site-deploy.sh out of this change.
- release.sh's calls are tested by source (order and presence), not run: a cut cannot run in the suite.
- deploy-site's own #4819 refusal is shadowed for a malformed staging artifact by the floor's earlier refusal in
  test-deploy-site-promote.sh arm 20; it is still covered by test-deploy-site-staged-mac-4819.sh (st8, st13).
- deploy-site.sh, promote-channel.sh and publish-staging-pointer.sh honour the knob (their tests use it); only
  release.sh refuses it. Every lowered check warns.

## Tests
tools/test-setup-floor-6149.sh: the library (boundary, numeric compare, unreadable versions, the knob in each
combination, the pointer check, the tree check), then the REAL promote-channel.sh and publish-staging-pointer.sh on a
temp site (refused below the floor with nothing written; a 0.7.49 control reaches each script's next check).
tools/test-deploy-site-promote.sh runs deploy-site for real under the real floor: a pointer below it, a pointer naming
another version's tarball, an old installer beside a 0.7.49 pointer, a staging pointer below it (each refused with
nothing deployed) and a control that deploys. Registered in test:shell.
