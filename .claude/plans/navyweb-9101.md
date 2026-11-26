# navyweb-9101: no navy behind the web board on the iPhone (#9101)

Stacked on failstyle-9095 (#9095): both touch ShellViews.swift, where the navy was defined. Rebase onto main once
#9095 merges.

## Measured (origin/main 8049029dc4)
- ContentView.swift painted UIColor.kosmosNavy (#17233D) in five places: the Close bar over a board page (575) and its
  page (578), webBoard behind the tab bar (713), the web view's host (1054) and the web view itself (1086).
- The board's page ground is NOT navy: its body paints var(--k-bg), #faf9f7 light and #0c0d0f in the dark scheme
  (NOT --bg, which is #1c1c1e in dark: web/index.html warns about that mix-up above the body rule; I read --bg first
  and review 1 caught it). Navy (#132140) is body.plus-active, while the Kosmos Plus settings section is on screen.
- Inside the app the board draws its own 44px header bar (html.kremote.kapptabs .kplus-bar) in Kosmos+ navy #17233d
  with white words: the navy the native code was matching.

## Change
- UIColor.boardGround (ShellViews.swift): #0c0d0f in dark, #faf9f7 in light, the board's --k-bg (the same values as
  Palette.ground). kosmosNavy is removed.
- The five places use boardGround. The Close bar's words are Palette.primary (were white, for navy).
- web/index.html: inside the app (html.kremote.kapptabs) the header bar takes var(--k-bg), var(--k-ink) words and a
  var(--k-rule) hairline; its name, face and focus ring follow. Kosmos+ in a browser keeps its navy bar.
- render-apptabs-6846's H1 asserted the in-app header is navy; it now asserts the bar is the page's own ground.

## Decided
Match the page: the native colours exist to be the page's colour around it, and the in-app header is part of the
app, so it joins the page's ground. Rejected: keeping the navy header (Josh's ruling covers the app), and changing the
browser's Kosmos+ bar (not the app).

## Weakest premises
- The page follows the phone's appearance. A board theme set by hand (data-theme) can differ from the phone's scheme,
  and the band and flash return for that person.
- Other pages the web view loads paint their own grounds: the Kosmos+ sign-in host and gate pages (navy, the gate's
  values), and the Kosmos Plus section (body.plus-active redefines --k-bg to navy #132140, so the in-app header is
  navy there too, matching that page). Around those, the native ground is cream or near-black. Not changed here: the
  Kosmos+ brand look, a decision of its own.
- The board's hidden "new look" switch (html[data-look="new"], kosmos-look in localStorage) sets --k-bg to #fff/#000;
  boardGround stays #faf9f7/#0c0d0f, so a person on that look gets a hairline of difference around the page.
- The full-screen phone menu (#pnav), opened from the in-app header, is still Kosmos+ navy with white type in both
  themes. It is a screen of its own (Josh's #4823 mock), filed as #9103 rather than widened in here.

## Tests
ios.board-ground-9101.test.js: no Swift file uses or spells out the navy; boardGround's two values equal the token the
board's body paints (found from the body rule, then read in the light :root and the dark block, bounded by its braces);
the five places use it; the Close bar's words; the in-app header on --k-bg and --k-ink with no navy or white left. 4/4.
Controls: the old dark value (#1c1c1e) fails test 2; a navy in-app header fails test 4.
web.app-header-6846.test.js updated to the bar rule's new opening.
render-apptabs-6846 (gated) is changed and not yet run: it goes in the queue with the iOS build.
Still owed: an iOS build and screenshots (a board page, Today, the Close bar, light and dark).

## Review ledger
Rounds: 1 opus, 2 sonnet, 3 opus, 4 sonnet. Fixed: boardGround's dark value read from the wrong token (1, BLOCKER),
the navy in-app header the native code matched (1), render-apptabs-6846 S1's white (2, BLOCKER), the Palette.ground
tie (2), the hairline as an inset shadow (3), the catalogue row (3), the guard's #ffffff and the word white (3), the
ios README and stale navy wording in two UI tests, the sweep script and the check's header (4).
Deferred: one value in two copies (boardGround and Palette.ground), pinned equal by test 5; the hidden
.kplus-bar-menu's white (display:none inside the app; outside it is the browser's Kosmos+ bar, navy by design).

## Still owed before the card is done
render-apptabs-6846 run on both engines (light lane, after the App Store gate); an iOS build; screenshots of a board
page, Today and the Close bar, light and dark.
