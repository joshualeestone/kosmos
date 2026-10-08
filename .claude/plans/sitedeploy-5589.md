# sitedeploy-5589: website changes ship on their own (kosmos#5589)

Josh, 2026-10-08 06:45 and 06:47 CDT: "We have got to get the Mac OS build separated from pushing a
simple website change" and "push website stuff immediately and not bundled with a Mac release."

## What exists already

`tools/deploy-site.sh --publish` (#2014) deploys the site without a release: it fetches the live
downloads into the site's dist/, checks each by sha, builds the export and deploys it, then checks
the served bytes. Angel used it at 06:48 the same morning. So the work is making it automatic and
safe beside a cut, not building a new deploy.

## This branch (agent-workforce half)

1. **deploy-site.sh: refuse when a live pointer moved mid-run.** The existing guards compare the
   checkout with live at the START. A release cut that publishes while this run fetches and
   builds (minutes) would be overwritten by the older pointers. `live_pointer_snapshot` reads the
   four live pointers (latest, latest-staging, latest-win, latest-win-staging) before any
   start-of-run comparison with live, and again right before `vercel deploy`; any change, or an
   incomplete read, refuses with nothing deployed, exiting 75 (try again later). Test: test-deploy-site-promote.sh case 28 (red with the
   comparison disabled).
2. **tools/site-autodeploy.sh: one tick of an automatic deploy.** If site origin/main moved past
   the last deployed sha, fast-forward the job's OWN site checkout and run deploy-site.sh
   --publish. Skips beside a running release.sh (anchored match on the command column; checked
   against the live 0.7.28 cut on Mortals), one tick at a time (pid lock), does not retry a failed
   sha until main moves, keeps a heartbeat. Test: test-site-autodeploy-5589.sh, wired into the
   shell suite in package.json.

## Site half (separate PR, chaoskosmos-site branch sitedeploy-5589)

`.github/workflows/site-deploy.yml` runs site-autodeploy.sh on the site repo's self-hosted runner
on Mortals: on push to main, every 15 minutes as a backstop, and on demand.

## Decisions

- **Mortals, via the existing self-hosted runner**, not a hosted GitHub runner: Mortals has the
  working Vercel login (Agent1s does not), cuts run there so the cut check sees them, and no
  deploy token has to be stored in GitHub. Rejected: a launchd poller (my first call; the runner
  is push-triggered and its failures show in GitHub), and a hosted runner (needs a token secret
  and a macOS runner, and cannot see the cut).
- **Its own site checkout** (`git clone --reference`), so a cut's half-populated dist/ is never the
  one deployed, and it can sit on main as deploy-site.sh's #3073 guard requires.
- **A failed sha is not retried** until main moves: a refusal is a finding, and a tick re-running it
  every 15 minutes would bury it.
- **Stage 2, not this branch:** move the Mac downloads to R2 behind redirects (as Windows is), so a
  site deploy carries no downloads at all. The reader sweep on the card lists the fixes it needs
  first (verify-served.sh and two others do not follow redirects).

## What the pointer guard does not cover

It NARROWS the cut race, it does not close it. Two things stay outside it: a cut publishing in the
seconds between the second read and Vercel switching the deployment over, and a change to download
bytes that moves no pointer (a staging cut adds new versioned files and moves latest-staging.json, and
a prod alias changes only with a latest.json move, so neither happens today). Both are caught after
the fact by deploy-site.sh's post-deploy served check, which fails loudly. **A post-deploy served-check
failure while a cut was publishing is a rollback event, not a retry**: redeploy from the site
checkout that has the cut's release commit.

**Exit codes.** The new refusals exit 75 (try again later). No script runs deploy-site.sh and branches
on its exit code: release.sh deploys through site-deploy.sh directly, and promote-channel.sh and
publish-kosmos-windows.sh only print advice to run it. site-autodeploy.sh is the one caller and it
treats 75 as retry, every other non-zero as a failure.

## Weakest premise

Mortals has to be up for merges to deploy. If it is down they wait, and the manual
`deploy-site.sh --publish` still works from Mortals or anywhere with a Vercel login.

**Second premise: a cut that aborts between step 7b and step 8.** 7b pushes the site's release
files (the moved pointers) to site main, and step 8 deploys them. If the cut dies in between, the next
tick sees no cut running and tries to publish pointers naming artifacts that were never served. What
stops it is deploy-site.sh itself: a moved prod latest.json is refused by the committed-vs-live guard
(test-deploy-site-promote.sh case 2 is that exact refusal under --publish), and a staging pointer
naming a build that is not live fails its fetch (#4819, test-deploy-site-staged-mac-4819.sh). The
tick then records the failure and its run goes red once, which is the signal to finish or roll back
the cut by hand. Reasoned from those tests, not run end to end through site-autodeploy.sh.

## One-time setup on Mortals (before the site workflow merges)

    git clone --reference ~/work/chaoskosmos-site --dissociate <site remote> ~/work/chaoskosmos-site-autodeploy
    cp -R ~/work/chaoskosmos-site/.vercel ~/work/chaoskosmos-site-autodeploy/

The workflow creates the agent-workforce tools worktree itself on its first run.

## Validation

Targeted tests each review round. The full suite runs on Mortals after the 0.7.28 re-cut releases
the box.
