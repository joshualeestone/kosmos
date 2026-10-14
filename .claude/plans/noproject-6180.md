# kosmos#6180: no "No project" chip; an agent need not be on a project

## Measured first (origin/main)
The "No project" chip was never "agents with no project". It was #1898's drill-down of Issue: needs_you agents whose
question named no project (`counts.needsYouUnattributed`). That is why the user saw one agent under both chips: it was
asking a question (a real Issue) that named no project, and the label read as "this agent has no project".
Nothing counted project membership as an Issue or drew a triangle for it: the card's triangle is its state (asking,
trust wait, crash loop...), the same thing Issue counts.

## Change
- web/index.html: the No project tile (#st-attn-noproj-tile), its counts on a good and a failed poll, its `noproj`
  board filter and CSS, and `data-noproj` on every card, list row and org node are gone. Issue is unchanged.
- engine/status.js: the fleet `needsYouUnattributed` count (its only reader was that tile) is gone. The per-project
  `needsYouUnattributed` in engine/projects.js stays (the project pages read it).
- Part 4 (Josh 17:05): the team creator labels its field "Project (optional)" and its no-project choice reads "No
  project for now". The default stays "A new project called ..." (a team usually works together; the card allows it).
  The single-agent create asks for no project at all (its request carries none), so there is nothing to label there.

## Decided
- Rejected: renaming the chip ("Question, no project named"). Josh asked for no such tab; Issue and the triangle
  already say the agent needs you.

## Weakest premise
That the reported agent really was asking a question. Every path to Issue and the triangle I found is a real state.

## Evidence
- docs/browser-checks/render-chip-filters-3423.js now pins the absence: no tile and no chip words, no data-noproj on a
  card, list row or org node, BOARD_FILTERS is exactly Messages and Issue; its Issue-filter arms are kept. rc=0.
- engine/status.test.js: needs_you counts with or without a project, and no no-project tally exists.
- server.test.js: the stats-tile harnesses end on the Issue tile; the page carries no st-attn-noproj.
- Related node suites and the browser-check guards: 1037 pass, 0 fail.
