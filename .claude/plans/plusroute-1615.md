# plusroute-1615: the app's Join Kosmos+ link points at the designed /+?from=app (kosmos#1615)

## Change
- web/index.html paintPlus: `site.href = KOSMOS_SITE + '/+?from=app'` (was '/plus'), and the two comment blocks that
  said /+?from=app 404s are removed: false since 09-13 (installkosmos.com/+?from=app 308s to kosmosplus.com/?from=app,
  the page /plus also reaches). The "Create an account" link in the sign-in wizard copies this href at runtime, so it
  moves with it.
- web.plus-route.test.js: the assertion and its comment follow.

## Decided on the card
- The from=app copy swap on kosmosplus.com is dropped: the page is a pricing page whose Kosmos+ tier links to
  login.kosmosplus.com/signup; the only waitlist there is the Cloud tier (#5160).
- The state-2 in-app sign-in live pass needs a real Kosmos+ account (with #5262).

## Checks
web.plus-route.test.js 5/5; browser checks render-plus-signin-3478 (182 PASS), render-plus-gate-1615 (all passed),
render-plus-blue-1615 (passed) run on this branch.

## Weakest premise
That nothing reads the old /plus path from the app (only one KOSMOS_SITE + '/plus' site in the page, grepped).
