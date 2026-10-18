# projquestion-6483: one agent question reads as a Question on its project, not a red Issue

Card: kosmos#6483 (noise pass on 0.7.56). One question showed as red five ways on Projects; the project card said
"Issue" while the agent card said "Question"; the Members notice named the agent twice.

## Change (the card's "smallest change", both items)
- `engine/projects.js`: the project summary gains `needsYouQuestions`, the members counted in `needsYou` whose reason
  is `'question'` AND whose report came from the agent (`stateReportedBy === 'agent'`), the same #2808 class-2 rule
  that makes the agent card say a calm "Question".
- `web/index.html` `pjPillOf`: when every needs-you member is such a question, the pill is the agent card's
  `{cls:'question', GLYPH.question, 'Question'}`; any other reason keeps the red Issue. A summary with no
  `needsYouQuestions` (an older board) keeps Issue. Because the card's red border keys on `pill.cls === 'attn'`, a
  question card loses its red border with the pill. `.pjpill .ask` gets `flex: none` like the other glyphs.
- `pjNeedsNotice`: the member its heading names is not named again on its row; button labels keep the name.

## Not changed (the card says a bigger call)
The Projects tab count, the "N Issue" tile and the card's red number still count every needs-you, questions included.

## Decisions
- Question only when ALL needs-you members are questions: one real problem beside a question still says Issue, the
  conservative direction.
- Weakest premise: the tile and tab still say "Issue"/red for the same question, so the screen still mixes words. The
  card scoped that out explicitly; a follow-up can align them.

## Checks
- `web.project-question-6483.test.js` (7): Question for question-only; Issue for mixed, non-question, and an older
  summary; no claim when the roster is unreadable; the notice names one agent once, keeps names for two (CONTROL) and
  for an "also" row. Mutation: reverting either fix fails exactly its tests.
- `engine/projects.test.js`: needsYouQuestions is 1 for an agent's question, 0 for a given-up connection and a trust wait.
- `docs/browser-checks/render-projects-badges-4730.js`: a question-only project draws Question with "?" and no red
  card, beside a red Issue CONTROL, in grid and list.
