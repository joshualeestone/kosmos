# gatechan-0725: the release-gate test's sandbox no longer inherits KOSMOS_CUT_CHANNEL (0.7.25 cut abort, 04:16)

The 0.7.25 staging cut (pin e5b8b4d1c) aborted at step 3: tools.release-gate.test.js 4 red, red alone 3/3. Cause: the cut
runs release.sh with KOSMOS_CUT_CHANNEL=staging exported; step 3's suite inherits it; the test's sandboxes copy
process.env, so their release.sh runs became STAGING runs and hit step 1f (#5032, merged 20:13 Mon: "the site serves
/setup-staging uncached"), which fetches the site's origin; the sandbox site has none -> exit 1 before step 2. This is the
first staging cut since #5115, which is why no earlier cut saw it. #5115's validation ran without the variable (1f skipped).

Change: sandboxEnv deletes KOSMOS_CUT_CHANNEL; the git-gate spawn env sets it undefined (beside the other cut-time strips).
Tests: with KOSMOS_CUT_CHANNEL=staging exported, 4 fail on e5b8b4d1c, 53/53 with this change; plain 53/53 either way.
Ships: branch from the 0.7.25 pin e5b8b4d1c, merged with a MERGE commit, re-cut pinned at this branch head, so only this
fix joins the 03:00 tree (Splinter's cutoff).
Weakest premise: other suites that copy process.env and run release.sh could hold the same leak; only this file went red
in the cut, which ran the whole suite with the variable set.
