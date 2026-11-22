# whatsnew-0815: What's New for the 0.8.15 cut

## Why
Splinter called a 0.8.15 staging cut at 03:49 CST 11-22. The cut's step 1b-ii refuses unless web/whats-new.json is for
the version it cuts and the pool records what prod serves. Prod has served 0.8.14 since 02:38 CST, and the pool still
recorded 0.8.13 (the same refusal that cost the 0.8.14 re-cut at 21:46 on 11-21). So this goes in before the cut.

## What
`node tools/whats-new-pool.js build 0.8.15`. Its prod sync marked 0.8.14's 5 highlights shown (shownIn 0.8.14) and
set lastProd 0.8.14. Then two Windows-only items were RETIRED BY HAND, as the tool's header asks ("once Windows prod has
shown it, retire it by hand"): "Windows Settings stops a false warning" and "Removing Kosmos takes out its agent hooks"
are in 0.8.03's shipped window (read at its v0803 commit), and Windows 0.8.03 and 0.8.04 were signed and shipped on 11-11,
so Windows users were already told. Both are status shown, shownIn 0.8.03. One line was reworded in the pool ("in the
app on your computer", review 1). Review 2 found "A little more room between chat lines" untagged in 0.8.01 to 0.8.05's
shipped windows: Windows has shown it and Mac prod never did, so it is now tagged mac (pending), the platform still owed it. The build then chose, by rank:
- A little more room between chat lines (mac)
- The restart note says what was checked
- A just-started agent gets your first message (Windows; first time in any window)
- A closed task says how it closed
- A paused room says why it stayed quiet
mac 4, windows 3 (the cap is on the file, so Windows shows one fewer). web/whats-new.json is never hand-edited.
Review 2 also checked the other four lines against every v08NN window: none was shown before.

## Rejected
- Hand-picking lines: the tool chooses by rank and platform. Other pending items lose on rank (the next is 11.8), and
  the `kosmos ... --how` ones are notes-only, which the tool keeps out.
- Leaving the two Windows items in: Windows users would be told old news as new.

## Weakest premise
That Windows prod actually served a build carrying 0.8.03's window. I signed Windows 0.8.03 and 0.8.04 on 11-11, but I
did not read Windows prod's pointer history. If Windows prod skipped from before 0.8.03 to 0.8.11, those two lines were
never shown on Windows prod, and retiring them costs two true lines. That is the cheaper mistake of the two.

## Checks
- `node tools/whats-new-check.js 0.8.15` (mac 4, windows 3) and `prod-check` after the build.
- What's New and release-notes tests; the full suite.
