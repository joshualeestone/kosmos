# The served installer lives in history (#568)

## What finished looks like

Every release commits and pushes the site's tracked release files
(dist/latest.json, setup, setup.sha256, versions.html) BEFORE deploying,
as one commit naming the version, by explicit path so nobody else's
in-progress page work is swept. verify-served gains a check that the
SERVED /setup matches origin/main of the site, so a script matching no
revision can never pass a cut again. The eleven-release backlog was
committed by hand first (6778963), so the check is true from its first
run.

## Why

release.sh committed and pushed the app repo but only copied into the
site, and Vercel deploys the working tree: the swap-proof installer that
ended the 0.5.13 wedge was serving from nobody's history, and the
line-number diagnostic that found that wedge is confounded while the
served script matches no revision at all.

## Review bound (stated before the loop)

One blind round; findings in these two scripts are fixed in place;
anything beyond is carded.
