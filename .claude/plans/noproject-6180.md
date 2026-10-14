# kosmos#6180: no "No project" chip; an agent need not be on a project

## Measured first (origin/main)
The "No project" chip was never "agents with no project". It was #1898's drill-down of Issue: needs_you agents whose
question named no project (`counts.needsYouUnattributed`). That is why the user saw one agent under both chips: it was
asking a question (a real Issue) that named no project, and the label read as "this agent has no project".
Nothing counts project membership as an Issue. One triangle DID come from projects (review 1, which I had missed):
the stale-instructions badge beside the name, when "Kosmos took it off its last project" and the tell did not land.

## Change
- web/index.html: the No project tile (#st-attn-noproj-tile), its counts on a good and a failed poll, its `noproj`
  board filter and CSS, and `data-noproj` on every card, list row and org node are gone. Issue is unchanged.
- engine/status.js: the fleet `needsYouUnattributed` count (its only reader was that tile) is gone. The per-project
  `needsYouUnattributed` in engine/projects.js stays as a field of the project summary (review 1: nothing reads it now;
  an earlier line here claimed the project pages did, which was wrong).
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

## Review
1. opus: no blocker. WARNINGs fixed: the stale badge beside the name drew a triangle for "Kosmos took it off its last
   project" (now that write is marked quiet in the stored record, wroteBy carries it, and staleBadge draws nothing for
   it; tests in web.told-banner.test.js, a mutant reds them); the false "project pages read it" claim corrected here and
   on the card. Stale prose fixed (server.test.js, web/index.html, the chip check header, its README row). Part 4 now
   has web.noproject-6180.test.js (option text, default, label; mutants red).
2. sonnet: no blocker. WARNINGs fixed: the quiet mark now has a REAL engine test (engine/instructions.test.js: write
   then wroteBy, with an unmarked control) instead of only a source match; the off write is no longer quiet when a
   person's edit is already waiting (offWriteIsQuiet, exported and unit-tested in engine/projects-quiet-6180.test.js; a
   mutant dropping the guard reds it), so the quiet write cannot hide that edit. Nits fixed (test messages, the lift's
   silent constant fallback, a grammar slip, the chip check's "kept for history" line).
