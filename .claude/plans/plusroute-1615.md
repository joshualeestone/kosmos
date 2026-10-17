# plusroute-1615: the app's Join Kosmos+ link points at the designed /+?from=app (kosmos#1615)

## Change
- web/index.html paintPlus: `site.href = KOSMOS_SITE + '/+?from=app'` (was '/plus'), and the two comment blocks that
  said /+?from=app 404s are removed: false since 09-13 (installkosmos.com/+?from=app 308s to kosmosplus.com/?from=app,
  the page /plus also reaches). The "Create an account" link in the sign-in wizard copies this href at runtime, so it
  moves with it.
- web.plus-route.test.js: the assertion and its comment follow.
- Measured 2026-10-17 00:23 CDT: `curl -sI 'https://installkosmos.com/+?from=app'` returned `HTTP/2 308` with
  `location: https://kosmosplus.com/?from=app`, so the parameter survives the redirect. Nothing on the site reads
  from=app yet (the copy swap is dropped, below), so the code comments no longer say what the parameter is for.
- Challenge-loop iteration 1 NITs acted on: the comments' claim that the site tells an app arrival apart is deleted
  (nothing reads it), and so is the test comment's unmeasured redirect description.

## Decided on the card
- The from=app copy swap on kosmosplus.com is dropped: the page is a pricing page whose Kosmos+ tier links to
  login.kosmosplus.com/signup; the only waitlist there is the Cloud tier (#5160).
- The state-2 in-app sign-in live pass needs a real Kosmos+ account (with #5262).

## Checks
web.plus-route.test.js 5/5; browser checks render-plus-signin-3478 (182 PASS), render-plus-gate-1615 (all passed),
render-plus-blue-1615 (passed) run on this branch.

## Weakest premise
That nothing reads the old /plus path from the app (only one KOSMOS_SITE + '/plus' site in the page, grepped).
