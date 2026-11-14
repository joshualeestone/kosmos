# pagesserved-8512: deploy-site --publish checks the served home page is the one deployed

Card: kosmos#8512 (follow-up to #8494). tools/deploy-site.sh runs `vercel deploy --prod` itself. After an exit 0,
step 6 checked only the installer artifacts, their .sha256 files and the pointers, none of which a pages-only publish
changes, so a vercel that exited 0 with no deployment passed with the old pages live.

## Change
Before the export is removed, the export's index.html is hashed. After step 6's host negative control, the served
$HOST/index.html (curl -fsSL, no-cache; the site's cleanUrls redirects it to /, followed) must hash the same, read up to
3 times KOSMOS_PAGES_RETRY_S apart (default 10 s). Otherwise: "the home page served at $HOST/ is not the one this deploy
carried, after 3 reads (kosmos#8512)", exit 1. An export with no index.html skips the check.

## Decided
Home page only: the site serves pages at clean URLs behind 30 redirects, and a pages-only change nearly always touches
the home page. Weakest premise: a change to another page alone would still pass unseen.

## Tests
tools/test-deploy-site-exit0-2791.sh B9: a vercel stub (VERCEL_REFUSE=nodeploy) exits 0 without publishing while the
live dir keeps an old index.html: rc 1, the message, never "published and verified". B1 (publishing vercel) is the
control. Mutation (check disabled) reds B9. All 9 deploy-site and autodeploy test files pass.

## Revision after review 1 (11-14 08:2x)
Review 1 BLOCKER (measured): 0 of the site's last 60 commits touch index.html, 35 touch versions.html, so a home-page
check misses most pages-only publishes. Replaced with a per-deploy marker: a random 32-hex id written to
dist/deploy-id.txt in the export only, just before vercel; step 6 requires the served /dist/deploy-id.txt to equal it
(3 reads, --max-time 30, KOSMOS_PAGES_RETRY_S validated as whole seconds). Pointer-freeze diff reads site commits and
dist retention prunes versioned triples in the site checkout, so neither can see an export-only file.
Tests: B9 (no deployment), B9b (home page already identical, only another page changed), B9c (stale id clears on read
2), B9d (bad retry value refused before deploy). Mutations: check disabled reds B9+B9b; one read only reds B9c.
All 11 deploy-site/served-verify/autodeploy test files pass.
Weakest premise: a served deploy-id proves a NEW deployment is live, not that every page in it is byte-correct; that
is the same trust the existing artifact checks extend to vercel's upload.
