# navyweb-9101: no navy behind the web board on the iPhone (#9101)

Stacked on failstyle-9095 (#9095): both touch ShellViews.swift, where the navy was defined. Rebase onto main once
#9095 merges.

## Measured (origin/main 8049029dc4)
- ContentView.swift painted UIColor.kosmosNavy (#17233D) in five places: the Close bar over a board page (575) and its
  page (578), webBoard behind the tab bar (713), the web view's host (1054) and the web view itself (1086).
- The board's page ground is NOT navy: web/index.html :root --bg #faf9f7, and #1c1c1e in the dark-scheme block. Navy
  (#132140) is only body.plus-active, set by syncPlusChrome while the Kosmos Plus settings section is on screen.
  So the navy matched neither scheme; it showed as a band and as a flash before a page painted.

## Change
- UIColor.boardGround (ShellViews.swift): a dynamic colour, #1c1c1e in dark, #faf9f7 in light, the board's own --bg.
  kosmosNavy is removed.
- The five places use boardGround. The Close bar's words are Palette.primary (were white, for navy).

## Decided
Match the board's page, not the app's native ground (Palette.ground is #0c0d0f in dark, the board's #1c1c1e): these
colours exist to be the page's colour around the page. Rejected: Palette.ground, which would leave a dark band in dark.

## Weakest premise
That the page follows the phone's appearance. A person who set the board's theme by hand (data-theme="light" or
"dark") gets a page that may differ from the phone's scheme, and the band and flash return for them. Closing that needs
the page to tell the app its theme; not done here.

## Tests
ios.board-ground-9101.test.js: no Swift file uses or spells out the navy; boardGround's two values equal the board's
light and dark --bg read from web/index.html; the five places use it; the Close bar's words are Palette.primary.
3/3. Controls: a wrong dark value fails test 2; main's ContentView.swift and ShellViews.swift fail all three.
Still owed: an iOS build and screenshots (a board page, Today, the Close bar, light and dark).
