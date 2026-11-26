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

## Review ledger
3 blind rounds (1 opus, 2 sonnet, 3 opus). Converged at round 3: its two warnings were already recorded (the Close
bar over Today's failure screen is #9101's; the build and screenshots are owed below). Fixed: the forced-dark Mac
switcher (round 1, a BLOCKER), both button edges (1), the overlay test's coverage (2, 3), the starGold pin and the
edge comment (3). Deferred: onGold duplicating Palette.primary's light value (a fixed value on purpose).

## Still owed before the card is done
An iOS build, then simulator screenshots of all four failure states in light and dark, including Trying.

## Screenshot hook (added 11-25 20:3x, after review converged at round 3)
ContentView.sampleFailure: KOSMOS_SAMPLE_FAILURE=offline|unreachable|mac|other[,trying] holds Today on that failure
screen in a Debug build, with a fixed detail ("The request timed out.") and Mac name ("Studio Mac"), so all four
states can be shot in light and dark. Decided: one env hook beside the 100+ KOSMOS_SAMPLE_* ones, read only under
#if DEBUG. Rejected: real failures in the simulator (no way to reach "other" or hold Trying still). Weakest premise:
that Today's web tab draws its overlay in a sample (no account) launch; unmeasured until the iOS build. Test: the new
arm in ios.failure-screens-9095.test.js; a mutant moving the read above #if DEBUG turns it red. Needs one more blind
review round (this is new code after convergence).
Review 4 (sonnet, blind, on the hook): no BLOCKER. Fixed: the comment now says every web tab and to launch without
KOSMOS_SAMPLE_AGENTS (that makes Today native); the buttons do nothing while the hook holds (a real Try again reloaded
the page behind it); the value is lowercased; the test now pins Trying, the detail, the Mac name and all three no-op
buttons (seven mutants, each red). Left: an unknown value silently does nothing (NIT; the shot shows it at once).
