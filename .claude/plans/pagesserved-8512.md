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
