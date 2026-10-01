# signedout-4879 (app half): Log out lands on "You're signed out"

Card: kosmos#4879. Relay half: kosmos-relay `signedout-4879` (its plan holds the reasoning and the measurement).

- web/index.html, the Kosmos+ bar's Log out: `location.replace('/#signed-out')` instead of `'/'`. The tunnel's page
  reads the fragment and says "You're signed out" over Sign in; a tunnel from before it shows its plain sign-in page.
  The board does not route on the fragment (its only hashchange listener cancels voice input).
- docs/browser-checks/render-plus-bar-3837.js P4 now also asserts the fragment.

Order: either half can ship first. The relay half alone removes the JSON (the plain sign-in page shows); this half
alone adds a fragment an older tunnel ignores.

Weakest premise: that nothing in the board reads '#signed-out'. Checked: the board has no fragment routing today; a
future one would have to leave this fragment alone or the browser check's P4 shows it.
