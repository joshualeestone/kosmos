# kosmos#2456 -- needs_you false-positive at scale

## Problem
Josh, 2026-09-07: "a TON of agents" showed "needs me" while NOT waiting. Clicking
in, the board could not say why; the 7.01.14 diagnostic (FClaude-Casey) shows the
agent explicitly said it was NOT blocked and only posed an OPTIONAL your-call
question, yet read needs_you AND the banner admitted "we cannot find the question
on its screen right now."

## Root (verified against code + tests, not the card's paraphrase)
The scraped needs_you comes from `engine/status.js` `classify()`'s old
`asksSomething`, which matched a `NEEDS_YOU_MARKERS` prose phrase ANYWHERE in the
25-line tail and sat ABOVE the working checks (SPINNER / INTERRUPT_LINE /
WORKING_LINE). A freshly-imported/reactivated agent's first-breath output is full
of "Would you like to ...?" / "Do you want to proceed ...?" prose drawn WHILE
actively producing, so every such agent read needs_you. The "cannot find the
question" banner (server.js ~9724) is the symptom: `classify` caught a transient
prose line the pane redrew past before the route's `chat.questionIn` re-reads it.

## Fix
Split `asksSomething` and position-gate the prose half:
- `drawsOptionMenu` (structural `OPTION_LINE`) -- a runner-drawn `❯ 1.` menu --
  stays ABOVE the working checks (genuinely waiting even mid-turn; #1155/#2146
  "blocked beats busy").
- `blockingProseAtBottom` fires only when a `NEEDS_YOU_MARKERS` prose phrase
  (index-0 + ends-at-`?`, the #1155 rules unchanged) is the LAST non-blank line of
  the tail. A live blocking prompt is the BOTTOM of the screen (its dialog
  replaced the composer -- the same premise the idle-footer and trust/consent
  rules already rest on). It stays ABOVE the working checks so a real
  bottom-anchored prompt is never suppressed by a STALE work line above it.

So the discriminator is POSITION, not the working signal: the same prose reads
needs_you at the bottom of the screen and not-needs_you with anything below it.

## Rejected
- Wholesale reorder (all of asksSomething below working): breaks the #1155/#2146
  "blocked beats busy" test (a real `❯ 1. Yes` menu + a live spinner must stay
  needs_you), and -- caught in challenge review -- opens a false CALM: a real
  bottom prompt sharing its tail with a stale work line would be suppressed to
  working (the module's cardinal sin). This was the first cut; the bottom-anchor
  above-working design replaced it.
- Narrow the markers: the markers are correct; the false positive is transient
  prose WHILE working, not a bad phrase.

## Weakest premise (inherited, not new)
A blocking prompt REPLACES the composer, so the footer is gone and the prompt is
the bottom line. This is asserted, not measured (it is a claim about Claude's UI,
which the repo does not control) -- the same premise the idle-footer rule names in
its own docblock. A future Claude that drew a bare-prose prompt WITH the footer
still beneath it would read idle here, the trap that rule already documents. Add
the fixture if one appears.

## Out of scope
#2456 may have a SECOND cause on freshly-imported agents (a reported/stale
needs_you from import, cf gemini-nancy stale-status #972/#1494). That is not a
scraped-classify path (it would not produce the "cannot find the question"
banner), so this fix does not touch it.

## Tests
`engine/status.needsyou-working-2456.test.js`: both arms, a discriminator
(position), the FClaude-Casey shape, and a REVIEW-WARNING-FIX arm (a bottom prompt
with a stale work line above stays needs_you). Perturbation-verified both
load-bearing properties: scanning all lines reds the false-positive arms;
below-working placement reds the REVIEW-WARNING arm.
