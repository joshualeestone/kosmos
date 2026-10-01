# signedout-4879 (app half): Log out lands on "You're signed out"

Card: kosmos#4879. Relay half: kosmos-relay `signedout-4879` (its plan holds the reasoning and the measurement).

- web/index.html, the Kosmos+ bar's Log out lands on '/#signed-out' instead of '/'. From a bare '/' (the Agents tab)
  only the fragment would change, which reloads nothing, so there it sets the fragment and reloads (review 1);
  elsewhere `location.replace('/#signed-out')`. The tunnel's page
  reads the fragment and says "You're signed out" over Sign in; a tunnel from before it shows its plain sign-in page.
  The board does not route on the fragment (its only hashchange listener cancels voice input).
- docs/browser-checks/render-plus-bar-3837.js: P4 (from a bare '/', precondition asserted) and P4b (from
  '?tab=projects', precondition asserted) both land on '/' + '#signed-out' after a reload.

Order: either half can ship first. The relay half alone removes the JSON (the plain sign-in page shows); this half
alone adds a fragment an older tunnel ignores.

Weakest premise: that nothing in the board reads '#signed-out'. Checked: the board has no fragment routing today; a
future one would have to leave this fragment alone or the browser check's P4 shows it.
