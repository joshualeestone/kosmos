# whatsnew-0816: the What's New list for 0.8.16

Built with `node tools/whats-new-pool.js build 0.8.16` (online) on origin/main after #8906 merged (d76e10239a), the last PR planned for the 0.8.16 staging cut (#8905 rides the next one).

## What the build did
- Read Mac prod (0.8.15, cut from f6ac36b940) and marked its four highlights shown; `lastProd` 0.8.14 -> 0.8.15.
- Picked the top five pending highlights.

## One hand edit, per the tool's header
"A just-started agent gets your first message" is Windows-only and was in 0.8.15's window, which Windows prod (0.8.15, fd2715b8aa2c) serves. The pool records Mac promotes only, so it is retired by hand: `status: shown`, `shownIn: 0.8.15`. Without that, Windows users would be told about it twice. Rebuilt after the edit.

## The list (5)
- all: The restart note says when restarts repeat (#8866; shipped in 0.8.15, never yet in a window; its words checked against 0.8.15 (f6ac36b940): engine/restartnote.js PATTERN_COUNT = 3 within PATTERN_MS = 7 days, and the board lists the dates)
- windows: Windows agents keep their account at login (shipped 0.8.06, never in a window)
- windows: Start at login stops misreading the account (shipped 0.8.06, never in a window)
- all: No number left on the K mark (shipped 0.8.02; retitled from "The day count is off the K mark", which could read as "the count is wrong")
- all: The computer control stays while a page loads (shipped 0.8.02)

Per platform: Windows 5, Mac 3, Linux 3.

## Mona Lisa's copy read (15:54), taken
As first built, the three Windows lines took shared slots, so Linux saw one line and Mac two. Ranks only: the K mark line 11.85 -> 11.62, the computer control line 11.9 -> 11.65. "A removed startup job explains its folder" (Windows) and "A warning before an agent runs twice" (Mac) wait for the next window.

## Checks
- `prod-check`: the pool records prod 0.8.15, rc 0.
- An offline build of the committed pool is byte-identical to `web/whats-new.json` (the cut's #7617 check).
- The five What's New test files: 60/60.

## Weakest premise
That two older all-platform lines are a better use of the shared slots than a third Windows one; it is a ranking, reversible in the pool.
