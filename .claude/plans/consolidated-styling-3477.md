# consolidated-styling-3477 - Kosmos+ consolidated view formatting

Card: joshualeestone/kosmos #3477

## Context: 4 of the 5 assigned styling cards were already done
Splinter handed me 5 styling cards (#3502/#3503/#3504/#3505/#3477). On investigation,
FOUR were already implemented and merged hours before the handoff (measure-whether-a-card-
is-still-live):
- #3502 / #3503 / #3504 -> PR #3514 (merged 18:21 CDT, tmnt-josh)
- #3505 -> PR #3521 (merged 19:18 CDT, tmnt-josh)
Verified their CSS on origin/main; left them OPEN for 0.6.90 visual QA per the implementer.
Only #3477 was genuinely unbuilt. This PR is #3477 only.

## #3477 problem (Josh, 2026-09-23, screenshot 7.53.43 AM, Kosmos+ consolidated view)
Verbatim: "the formatting on this Kosmos Plus in the consolidated view looks terrible.
Content is pushed way down the page ... let's just move the Kosmos+ content up ... Also
let's make sure the sign-in button at the top isn't touching that horizontal rule for the
header space and move it down a little bit too. I think for now ... I'm going to rethink
how we do the sub-navigation and settings."

## Diagnosis (via ~/work/pw-runtime, real chromium; the MCP's chrome-headless-shell is wedged but full chromium works)
Loaded the live board, switched to consolidated layout, opened Settings -> Kosmos Plus,
and MEASURED:
- `.plus-topbar` (the "Already have Kosmos+? Sign in" row) top == the consolidated header's
  bottom rule (both y=67) -> 0px gap, the sign-in pill was flush against the rule.
- The decorative wordmark canvas `#plus-mark` is `min(560px,82%)` wide, which in the
  narrower consolidated column renders ~262px tall and pushes the hero + value props far
  down (hero at y=390 of a 900px viewport).

## Decision (implemented, consolidated-scoped only, spacing only)
Two rules under `html[data-layout="consolidated"] body.consolidated #s-sec-plus`:
1. `.plus-topbar { margin-top: var(--space-5); }` - lifts the sign-in row off the header rule.
2. `#plus-mark { width: min(420px, 70%); margin: 2px 0 4px; }` - trims the wordmark footprint
   so the content reads higher. The tab view keeps the full immersive wordmark (unscoped rule
   at ~line 8198 is unchanged).

Verified by re-measuring after the change (CSS injected onto the live board): sign-in gap
0 -> 27px (clears the rule); wordmark 262 -> 210px; hero top 390 -> 365 (content moved up),
and the "Join Kosmos+" CTA now sits within the viewport.

## What I did NOT do
- Did NOT restructure the settings sub-navigation. Josh explicitly reserved that rework for
  himself ("I'm going to rethink how we do the sub-navigation and settings"). This is
  spacing-only, "for now."
- Did NOT touch the "settings pills touching the left rule" part of the card - that is #3505,
  already shipped in PR #3521.
- Did NOT touch the tab view or the agent view (#d-nav).

## Weakest premise
The exact amount to "move content up" is a visual judgment Josh will finalize in his sub-nav
rework; I trimmed the wordmark 20% and nudged the sign-in 12px (measured 27px effective gap),
a modest, reversible improvement that addresses both literal asks. The wordmark canvas does
not render under headless chromium, so the screenshot shows its region blank; the geometry
(width/height) and the sign-in gap are the measured, reliable signals. Josh confirms the final
look in 0.6.90 (he reviews in the running app).

## Verification note
Local `yarn test`/full-suite validation fails on an ENV error (this Mac's Xcode license was
reset - `xcrun --find clang` refuses; needs an operator `sudo xcodebuild -license`), not on
this code. CSS-only change; verified via pw-runtime real-chromium measurement. CI runs the
browser-checks against a clean-env chromium.
