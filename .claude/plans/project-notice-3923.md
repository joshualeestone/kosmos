# Plan: kosmos#3923, the project notice (Mona Lisa's design)

## Finished looks like
On a project page, while any member's told state is could_not, one notice above the Members list
names what is wrong, shaped by what the person must do (Wait: Try again only; Act: a sentence only;
Act then retry: a sentence and Try again; Explain: a sentence saying nothing can be done yet), one row
per agent when several, using the person's names, with no left bar. Nothing renders when every agent
has the folder (success and not_tried say nothing). The per-row interim line is gone from the project
page. Try again re-tells that agent and the notice updates.

## Measured before building (main at the worktree base)
- pjToldLine's interim sentence ("We could not update this agent about this folder: ...") renders on
  the member row, or once below the list via pjSharedTold; none of the design's copy is served.
- The becauses tellAgent returns (engine/projects.js; GROUP_BECAUSE keys plus the N-blocks and worker
  folder ones). No re-sync route exists; POST /api/project/:id/agent/:name on an existing member
  changes nothing (moved=false, no pane line) and re-runs syncAgent, recording a fresh verdict.
- docs/browser-checks/render-projects.js measures the failed tell on the "Quarter close" fixture.

## Change
1. web/index.html: .pnotice CSS (from the mock, .qopt scoped to it, no left bar); #pj-one-notice above
   #pj-one-agents; PJ_NOTICE (exact-because regexes to shape and copy), pjNoticeRow, pjNotice;
   paintOneProject paints the notice and passes suppressTold to every row; a Try again handler.
2. web.project-notice-3923.test.js: each shape, several agents, unknown cause, escaping, and every
   engine because has a shape.
3. render-projects.js measures the notice's headline and reason instead of the row's .pj-told.

## Decided
- Settings' members list keeps its per-member line for now (pjToldLine and its tests stay, used there).
  Rejected: a second notice in Settings in this change. Weakest premise: people check Settings for this;
  the project page is where the design puts it.
- Copy for the reasons the mock does not draw (N blocks, too short, size limit, the ambiguous name, a
  folder Kosmos will not change) follows the mock's pattern: the reason in plain words, the fix in ink.
- Try again posts the member route with `?retell=1`: a current member is re-told (idempotent, nothing
  typed into its window); an agent that has left gets 409 rather than being put back (review round 1).
  A same-answer retry says "It still did not work." on its row; the button re-enables and focus returns.
- The consolidated layout hides the whole Members card (#3218/#3305), so the notice does not show there;
  that was already true of the old line. Not changed here.
- pjSharedTold, pjToldGroupLine, their CSS and tests are removed (dead once the notice replaced the
  group line). pjToldLine stays: the Settings members list still uses it.

## Verified checks
- render-projects and render-project-members-3387 pass through tools/browser-checks.sh with the notice in the Members card (the second is surface-mapped to pjcard-members; the notice adds a sibling and changes nothing it asserts).
