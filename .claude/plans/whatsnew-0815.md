# whatsnew-0815: What's New for the 0.8.15 cut

## Why
Splinter called a 0.8.15 staging cut at 03:49 CST 11-22. The cut's step 1b-ii refuses unless web/whats-new.json is for
the version it cuts and the pool records what prod serves. Prod has served 0.8.14 since 02:38 CST, and the pool still
recorded 0.8.13 (the same refusal that cost the 0.8.14 re-cut at 21:46 on 11-21). So this goes in before the cut.

## What
`node tools/whats-new-pool.js build 0.8.15`. Its prod sync marked 0.8.14's 5 highlights shown (shownIn 0.8.14) and
set lastProd 0.8.14. Hand edits to the pool, each a decision recorded here:
- RETIRED two Windows-only items, as the tool's header asks ("once Windows prod has shown it, retire it by hand"):
  "Windows Settings stops a false warning" and "Removing Kosmos takes out its agent hooks" are in 0.8.03's window
  (read at its v0803 commit), which Windows 0.8.03 and 0.8.04 carried (both signed by me on 11-11). Status shown,
  shownIn 0.8.03.
- "A little more room between chat lines" stays UNTAGGED. It is in the 0.8.01, 0.8.03, 0.8.04 and 0.8.05 windows,
  so Windows users on any of those builds have probably seen it. Mac prod never served those versions (the pool's
  shownIn set has none of them), and we assume the same for Linux, which is promoted with the Mac family (the pool
  records Mac promotes only, so that is not checked from here), and the engine cannot tag "mac and
  linux, not windows": a mac tag hides it from Linux (platformOf() gives Linux no tag; review 3). DECISION: a repeated
  true line on Windows costs less than a missing one on Linux, where the Cloud customers are. Its line now reads
  "Messages in an agent conversation now have a little more space between lines." (review 3: the rule applies wherever
  the board renders, so "in the app on your computer" was narrower than the change).
- Two lines reworded on Mona Lisa's copy read (fleetreleases m5879): "A closed task says how it closed" and "A paused
  room says why it stayed quiet" (her text, which drops "a room's wake pause", our word, not the person's).
- "The restart note says what was checked" (mac) is also in the 0.8.01 to 0.8.05 windows, all versions Mac prod never
  served, so Mac users have not seen it.
The build then chose, by rank (10.25, 10.45, 10.7, 11, 11.2):
- A little more room between chat lines
- The restart note says what was checked (mac)
- A just-started agent gets your first message (Windows; in no earlier window)
- A closed task says how it closed
- A paused room says why it stayed quiet
web/whats-new.json is never hand-edited. Review 3 checked every line against each v08NN window from 0.8.00 to 0.8.14.

## Rejected
- Tagging the chat-spacing line mac (review 2's suggestion, made and then reverted): it hides a true line from Linux.
- Hand-picking lines: the tool chooses by rank and platform. The next pending item is "A new Cloud machine can be
  allowed" at 11.3; the `kosmos ... --how` ones are notes-only, which the tool keeps out.

## Weakest premise
That Windows prod served a build carrying 0.8.03's window. Its only evidence is that Windows 0.8.03 and 0.8.04 were
signed on 11-11; nobody read Windows prod's pointer history. If it is false, the two retired lines were never shown on
Windows prod, and retiring them costs two true lines. The untagged chat-spacing line does not rest on it.

## Checks
- `node tools/whats-new-check.js 0.8.15` and `prod-check` after the build.
- What's New and release-notes tests; the full suite.
