# failstyle-9095: the iPhone's four failure screens move from navy and blue to the app's own ground (#9095)

Josh, 11-25 16:49: "we are not going to have the blue background anywhere in the app." Split out of #9091 by Splinter.

## Change (ios/Kosmos/ShellViews.swift, LoadFailureView)
- Ground: Palette.ground (cream #FAF9F7 in light, #0C0D0F in dark), was Kosmos navy #17233D.
- Icon: Palette.starGold (deep gold in light for contrast on cream, bright gold in dark), was KosmosColor.gold.
- Title and message: Palette.primary and Palette.secondary, the app's own text colours, were ink and muted for a
  dark ground.
- Try again: Palette.starFill (#E3B341) with dark words (LoadFailureView.onGold, #14161A) in both appearances, was
  blue #2F57C4 with white words. The Trying dots take the same word colour. Its edge is the deep gold
  (Palette.starGold): the bright gold alone is about 1.85:1 on cream (review 1).
- Choose another computer: Palette.primary words, Palette.secondary outline (separator was about 1.3:1, and the
  outline is the button's only edge). Back to Kosmos: Palette.primary.
- The Agents tab's "Mac not answering" screen (AgentsView.swift, .unreachable) lays the Mac switcher over this view
  and forced it to dark appearance, "light on the navy page": on cream its text would vanish. It now follows the
  person's appearance (review 1).
- KosmosColor removed: nothing else used it.

## Decided
Follow the person's appearance (Palette pairs), not cream in both: every other native screen does, and dark is
near-black, never blue. Rejected: a fixed cream screen, which would flash white for a dark-mode person on every
failed load. What would change my mind: Josh wanting the failure screens light in both.

## Not in scope (noted on the card)
ContentView.swift still paints kosmosNavy behind the web view and on two screens (lines 575, 578, 713, 1054, 1086).

## Tests
ios.failure-screens-9095.test.js: no navy, no KosmosColor, no blue spelled out, no white-on-fill in the view; the
ground, text and gold button tokens; the palette values it leans on; nothing over a failure screen forces dark; the
two button edges. 5/5. Controls, run with `git stash -- <file>` then the test: main's ShellViews.swift fails the
view tests; the old AgentsView.swift (forced dark) fails the overlay test.
Still owed: an iOS build, and simulator screenshots of all four states in light and dark (queued after the App Store
gate).
