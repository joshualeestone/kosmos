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
- engine/chat.js questionIn: when the safeguards menu is live, the region starts at its "Model switch" title (to the end of the screen)
  (searched up to 16 rows above option 1; 10 rows as the fallback), so the person reads the whole question and both choices.

## Decided, and why
- No buttons, ENFORCED: optionsIn returns null whenever safeguardsMenuAt matches its text (round 1: the captured layout's description rows
  only happened to prevent them). server.js refuses a BUTTON press (`chose`) that lands on the live menu with the usual 409 "changed on
  its screen": option 1 switches models and saves that in the agent's Claude settings. A typed answer (no `chose`) goes through.
- Starting at the title, not a fixed run-up: a narrower pane wraps the question onto more rows; pinned with a wrapped variant.

## Weakest premise
"Model switch" as the title row is from one capture (with blank and border rows stripped). If the title differs, the fallback (10 rows
above option 1) still returns the region, possibly starting mid-question.

## Validation
- #5051 test (chat.test.js): the region starts at the title, holds the question and "2. Stay on Opus 5.5", stops above earlier output; a
  wrapped question still starts at the title; optionsIn draws no buttons; the menu's words in prose above a live permission prompt leave the
  permission prompt as the question. Fails on the base at "the safeguards menu yields no question region".
- Mutants: no branch -> that arm; no title search -> the wrapped arm. [CORRECTED round 1: I called dropping "below any marker match"
  equivalent; it was not, a non-numbered marker line below the menu started the region mid-menu. The guard is now removed.]
- chat.test.js + status.test.js + status.pane-states-1889.test.js: 381/381.

## Review
- Round 1 (opus, blind): 0 BLOCKER, 2 SHOULD-FIX + 1 follow-up, all taken. SF1: the "below any marker" guard could only make the region
  worse (a non-numbered marker under the menu started it mid-menu); removed, BELOW arm. SF2: "no buttons" rested on the captured layout;
  optionsIn now refuses the menu, BARE arm (assumed compact layout). Follow-up taken here rather than filed: a stale BUTTON press landing on
  the menu went through (no menu parsed, no 409) and would press "Switch automatically" [CORRECTED round 2: only for a client that still
  sends `chose`; no in-tree client has since #3419, so the guard is defense in depth for stale or API clients]; server.js now refuses it, test in
  server.projects.test.js with a typed-answer control. NITs: the 10-row fallback is untested (a pane narrow enough to need more than 16
  rows above option 1, reasoned not measured); the PROSE control exercises the base's live-menu rule, not this change (kept as a control).
  Measured 13:46, each red by name: optionsIn refusal off -> BARE; the below guard back -> BELOW; server guard off -> the stale press was
  PLACED. chat + status + pane-states 381/381; server 5051 + the existing button test 2/2.
- Round 2 (sonnet, blind): 0 BLOCKER, 0 SHOULD-FIX. CONVERGED (13:50). No in-tree client sends `chose` (removed #3419), so every page, phone,
  notification and `kosmos reply` path sends bare text, which goes through as a typed answer by design; the server guard covers stale/API
  clients. optionsIn's two callers (server.js offering and checking buttons) are consistent with the refusal. NITs recorded, not taken: the
  guard is skipped when the card is not needs_you or `chose` carries a control character (both then count as typed, no worse than typing 1);
  an OLD menu above a later non-numbered question starts the region far above it (question still included, reasoned not observed); the
  10-row fallback and the exact title regex are unpinned (mutants survive, both fail safe).
