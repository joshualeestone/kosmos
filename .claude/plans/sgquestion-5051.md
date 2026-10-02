# sgquestion-5051: the detail page finds the question on Claude Code's safeguards model-switch menu (kosmos#5051)

Started 2026-10-02 13:42 CDT, Ice Cream Kitty. STACKED on safeguards-5039 (#5039, which names the menu on the board); rebases onto
main once that merges. Filed from #5039's review round 1.

## Problem
While an agent sits on the safeguards menu, the detail page says it "cannot find the question on its screen", because chat.questionIn
matches only ALL_NEEDS_YOU_MARKERS and the menu's question (wrapped prose in a frame) has none. After #5039 the same page also shows the
board's evidence of the menu, so it contradicts itself.

## Change
- engine/status.js safeguardsMenuAt(text): the live-menu rule from #5039 ("1. Switch automatically" is the LAST "1." row, "2. Stay on
  <model>" within 3 rows), returning { at, model }. safeguardsMenu now uses it, so the board and the question finder share ONE rule.
- engine/chat.js questionIn: when the live safeguards menu is below any marker match, the region starts at its "Model switch" title
  (searched up to 16 rows above option 1; 10 rows as the fallback), so the person reads the whole question and both choices.

## Decided, and why
- No buttons: optionsIn needs consecutive option lines, and the menu puts a description row between them, so it returns null. The person
  types the answer; a guessed button never answers for them. Pinned.
- Starting at the title, not a fixed run-up: a narrower pane wraps the question onto more rows; pinned with a wrapped variant.

## Weakest premise
"Model switch" as the title row is from one capture (with blank and border rows stripped). If the title differs, the fallback (10 rows
above option 1) still returns the region, possibly starting mid-question.

## Validation
- #5051 test (chat.test.js): the region starts at the title, holds the question and "2. Stay on Opus 5.5", stops above earlier output; a
  wrapped question still starts at the title; optionsIn draws no buttons; the menu's words in prose above a live permission prompt leave the
  permission prompt as the question. Fails on the base at "the safeguards menu yields no question region".
- Mutants: no branch -> that arm; no title search -> the wrapped arm. Survives, effectively equivalent: dropping "below any marker match"
  (a question below the live menu would carry its own "1." row, so safeguardsMenuAt would no longer call the menu live).
- chat.test.js + status.test.js + status.pane-states-1889.test.js: 381/381.

## Review
- Round 1: PENDING.
