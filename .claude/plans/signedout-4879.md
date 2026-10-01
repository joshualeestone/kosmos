# signedout-4879 (app half): Log out lands on "You're signed out" (measured in Chromium and WebKit: both premises hold; Josh's phone is the real check)

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

## Measured and validated (2026-10-01, after the outage)
- p-4879 (the probe): both premises hold in Chromium and WebKit (see kosmos-relay plan signedout-4879).
- b1-4879 on 6a95c3e40 (rebased): render-plus-bar-3837 P4 and P4b PASS; render-mobilenav-4823 PASS in chromium and
  webkit, including the new phone-menu Log out arm (renamed LO1 after the run: the check already had an S5).
- After the run, label and comment only: the arm's name, and the index.html comment that still said "unmeasured".
- Convergence run on the rebased head (18:22): both browser checks PASS (mobilenav 171/171); full suite 13576/1.
  The one failure was browser-checks-selectors.test.js: it reads every quoted '#name' in a check as an element id,
  and '#signed-out' is a URL fragment. The three comparisons now test path and fragment together
  ('/#signed-out'), the form the guard reads as a URL (as '/#settings'). Same assertion, slightly stronger.
  The guard: 4/4 after, failing before. Both checks re-run after the edit.
