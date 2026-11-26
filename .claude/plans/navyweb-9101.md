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
  values), and the Kosmos Plus section (body.plus-active, a navy gradient). Around those, the ground before the first
  paint is now cream or near-black rather than their navy. Not changed here; it is the Kosmos+ look, not the app's.

## Tests
ios.board-ground-9101.test.js: no Swift file uses or spells out the navy; boardGround's two values equal the token the
board's body paints (found from the body rule, then read in the light :root and the dark block, bounded by its braces);
the five places use it; the Close bar's words; the in-app header on --k-bg and --k-ink with no navy or white left. 4/4.
Controls: the old dark value (#1c1c1e) fails test 2; a navy in-app header fails test 4.
web.app-header-6846.test.js updated to the bar rule's new opening.
render-apptabs-6846 (gated) is changed and not yet run: it goes in the queue with the iOS build.
Still owed: an iOS build and screenshots (a board page, Today, the Close bar, light and dark).
