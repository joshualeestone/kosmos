# consolidated-restyle: kosmos#980, the boxless consolidated view

Josh, 2026-08-26 08:31, four screenshots of the APP's consolidated view
(shipped by #520 as a CSS overlay in web/index.html), plus his needs-you
clarification pending on one item. One complete pass he can click through,
not staged increments.

## What finished looks like

At 1280px in the consolidated layout, light and dark:

1. Agents and Projects are flat columns on the side ground with a vertical
   rule between agents|projects and projects|discussion. No rounded
   `--k-sunk` boxes around #rail-agents/#alist/#pj-list-view.
2. A vertical rule separates the discussion from the right column's ground.
3. The discussion area fills its column, no floating card on a ground.
4. Tasks / Project members / Files keep their card-on-ground look; the
   right column ground reads as the side tone, cards on surface.
5. Tokens follow the mock: rails and right ground on the side tone,
   discussion on the page ground, cards on surface (the mapping I gave
   Josh: --k-side #f3f1ec/#111316, --k-side-2 #ebe8e2/#1c1f23,
   --k-bg #faf9f7/#0c0d0f, --k-surface #ffffff/#17191c). The app already
   carries k-bg/k-surface; side tones arrive as consolidated-scoped vars.
6. NO page scrollbar at any window size; each area scrolls internally
   (agents behind the pinned user strip, projects, and the right column's
   cards), same as the mock's height-bounded grid.
7. No visible scrollbar inside the "Write to the project" composer.
8. Agent rows: smaller name type, no state text row (the needs-you warn
   over the avatar STAYS, it is the signal that matters; Josh's pending
   grid/list answer concerns the tab views, not this).
9. Projects: a persistent selected state on the open project, not just
   hover.
10. Collapsed projects: no header text, just + and the arrow. Collapsed
    agents: gold K stays, + and arrow stop centering mid-column/jumping.
    The agents header stops jumping vertically on expand.
11. Copy: "Project settings" becomes "Settings"; the room search
    placeholder becomes "Search" (consolidated only, via the layout
    apply hook); the project description truncates to one line with an
    ellipsis in the consolidated midhead.
12. Project members: avatars are true circles, not squished.
13. Files in this project renders above Project members in the right
    column (consolidated ordering; done with CSS order within the
    detail column so the tab view is untouched).

Each of these is checkable by rendering the file headlessly and measuring;
the verification section lists the measurements.

## Where the work lands

- The `#520` consolidated CSS block (web/index.html ~1961-2300): the
  box-to-column rewrite, rules, scroll containment, fold fixes, row type.
- The layout-apply JS (railFoldsApply / the data-layout writer): placeholder
  swap for the search field, consolidated class hooks if needed.
- Copy strings: #pj-settings-link text ("Settings"), shared between views
  on purpose (short is right in both).
- No engine, no server, no behavior change beyond presentation and the
  two copy strings.

## Held out of this pass

- The grid/list "finished responding" text removal: Josh's answer on
  whether needs-you goes too is still pending; that is tab-view work and
  its own card once he answers.
- The green-check Connected treatment and the #979 install-first flow:
  separate card, separate pass.

## Verification

- node --test web.firstrun-model.test.js and the full suite (no regression;
  this pass should not touch what they cover, run them anyway).
- tools/browser-checks.sh ids intact (grep docs/browser-checks for any id
  this pass renames; renames are not expected).
- Headless render at 1280 and 1600 in the consolidated layout, light and
  dark: assert no body scrollbar (scrollHeight <= clientHeight), the rails'
  computed backgrounds are the side tone with no border-radius boxes,
  vertical rules present, member avatars aspect ratio 1, the open project
  row carries the selected style, and screenshots for the eyes-on pass.
- sync-forced-theme.js --check clean after any dark-section change
  (regenerate via the tool, never hand-edit).
