# Plan: projects-list-860

Josh, #chaoskosmos-design, 2026-08-25 10:35.

His words: "let's do something similar to what we're doing on the
agents list view but I think we have all the information in here. I
think the problem right now is we're kind of bunched up on the far
right and there's nothing in the middle... Let's list it in equal
portions across the top: Project title (which could probably be
truncated at some particular length too)..., Project description
(which could probably be truncated at some particular length too)...,
The agents, with the number of agents, The status on the far right...
right now we have the title far left, the description almost centered,
and all the agents plus the status all crammed over on the right.
They're bleeding over on top of each other and wrapping in a weird
way."

## Changes

1. **Four columns roughly evened out**, title and description now
   sharing the row's width more evenly instead of title-narrow/
   description-wide. The agents column widened to `12rem` max so its
   worst case (five faces plus the "N agents" count text, the cap
   `projectCard()` already draws) fits without spilling.
2. **Title and description truncate with ellipsis** in the list row
   specifically, rather than wrapping unpredictably. The grid tile
   view is untouched -- it keeps its own wrap/clamp treatment and its
   own pinned 200-char-description check.
3. **The real overlap bug, root-caused**: a CSS grid item defaults to
   `min-width: auto`, which lets its content's natural size push past
   the track width assigned to it -- exactly what let the agents
   column's flex row (faces + count) bleed into the status column
   beside it. Fixed with `min-width: 0; overflow: hidden;` on that
   column.

## Verification

- [x] `npm test` (full suite) -- one pinned test needed updating (the
      literal grid-template-columns values), done, plus a new test
      added for the truncation and overflow-guard rules. 0 failures.
- [x] Real live-server Playwright verification: created a project with
      a long title, a long description, and five agents (the exact
      worst case Josh's complaint describes) via the real API. Title
      and description both truncate cleanly; all five faces plus the
      count render with no overlap into the status column, which sits
      clean on the far right.
- [x] `bash tools/browser-checks.sh` (full suite) -- see pre-challenge
      proof.
