# signedout-4879 (app half): Log out lands on "You're signed out" (the goal; on Josh's phone it depends on the relay plan's unmeasured premise)

Card: kosmos#4879. Relay half: kosmos-relay `signedout-4879` (its plan holds the reasoning and the measurement).

- web/index.html, the Kosmos+ bar's Log out lands on '/#signed-out' instead of '/'. From a bare '/' (the Agents tab)
  only the fragment would change, which reloads nothing, so there it sets the fragment and reloads (review 1);
  elsewhere `location.replace('/#signed-out')`. The tunnel's page
  reads the fragment and says "You're signed out" over Sign in; a tunnel from before it shows its plain sign-in page.
  The board does not route on the fragment (its only hashchange listener cancels voice input).
- docs/browser-checks/render-plus-bar-3837.js: P4 (from a bare '/', precondition asserted) and P4b (from
  '?tab=projects', precondition asserted) both land on '/' + '#signed-out' after a reload.

Order: either half can ship first. The relay half alone removes the JSON only if a service-worker-forwarded navigation still asks for HTML
(unmeasured; see kosmos-relay's plan), and then the plain sign-in page shows. This half alone adds a fragment an
older tunnel ignores.

Weakest premise, the weaker of two: on a phone with the board's service worker, the whole fix depends on the
forwarded navigation still asking for HTML (kosmos-relay plan signedout-4879, measured by its probe). The other:
that nothing in the board reads '#signed-out'. Checked: the board has no fragment routing today; a
future one would have to leave this fragment alone or the browser check's P4 shows it.

## Reviews
Recorded in kosmos-relay's plan (both halves were reviewed together). Review 5 CONVERGED; its four NITs (wording
and plan record only, no behaviour) were taken AFTER convergence without another review.

## Rebase onto cf1307de4 (2026-10-01, after the outage)
Main (#4853, kosmos#4823) moved Log out into one shared `kplusLogout(out, msg)`, used by the bar's button and the new
phone menu's. The redirect now lives there, unchanged, so the phone menu's Log out gets it too. A blind review of the
resolution CONVERGED (0 BLOCKER, 0 WARNING). Its one gap NIT was taken: render-mobilenav-4823.js S5 presses the phone
menu's Log out with a working answer and asserts it lands on '/' + '#signed-out', reloaded (S4 covers the refusal).
