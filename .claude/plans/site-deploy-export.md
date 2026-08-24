# site-deploy-export: the release deploys the committed site plus named artifacts, never the working tree (#649)

## Finished looks like
release.sh step 8 deploys an EXPORT: `git archive HEAD` of the site (the pages exactly as
committed and pushed in 7b) plus the artifact classes the release owns, each by name
(dist/*.tar.gz and .sha256, the Kosmos.pkg triple, .vercel/), and prints a manifest of
what it carried and what the working tree holds that did not ship. A stray untracked
file, a stray ignored file and a half-edited page in the site checkout do not ship
(tools/test-site-deploy-export.sh proves each, with controls that the hazards were
really in the tree). A missing project link, a non-empty export dir or a non-repo refuses.

## Why
The deploy published the shared site checkout's working tree. It fired twice during
the 0.5.22 cut. Baron's comment on #649: the pkg reached production only through this
accident, so the fix is "make the accident a decision": an explicit publish step per
artifact. The pkg half landed in #716 (3c); this is the deploy half.

## Not in this change
Pruning old versioned tarballs from the deploy (a just-read latest.json can still ask
for the version it named; carrying every pair on disk is today's behaviour, kept on
purpose). What Vercel uploads within the export is still .vercelignore's decision.
