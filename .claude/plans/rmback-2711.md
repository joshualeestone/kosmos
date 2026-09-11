# Plan: #2711 item 17 — remove the in-project back arrow (tab view)

Card: joshualeestone/kosmos#2711, item 17 of Josh's 17-item project-page tab-view
styling list ("remove back arrow"). Branch: `rmback-2711`. Repo: joshualeestone/kosmos.

## What finished looks like
- The `← All projects` back arrow (`#pj-back`) no longer renders inside an open
  project's tab view.
- Leaving a project still works: the `Projects` tab in the top nav is the door out.
  It is functionally identical to the old arrow — clicking it runs
  `topLevelReset('projects')` (`pjCloseConfirm(); PJ_CURRENT = null`) + `pjMarkOpen(null)`
  + `showTab('projects')`, which lands on `pjView('list')`, the exact sequence the old
  `#pj-back` handler ran.
- No dangling references to `#pj-back` anywhere (app, tests, browser-checks).
- Full validation green.

## Design call (decided, not parked)
The back arrow is redundant with the always-present `Projects` tab, which is the
canonical top-level route out of a project (Josh's own framing in the tabs handler:
"if I hit a top-level page like Projects, it jumps me back"). Removing it declutters
the project header (the whole point of Josh's #2711 header pass) with zero loss of
navigation. Rejected: keeping the arrow (it is the clutter the card names); moving the
arrow (Josh asked to remove, not relocate).

Weakest premise: that no user relies on the arrow as the *only* obvious way out. The
Projects tab is always visible in the top nav at every width covered by the checks
(1280px) and behind the burger below 56rem, so the route out is never lost. Josh
reviews the actual pixels in the app; treat as PROPOSED until he confirms.

## Changes
1. `web/index.html`
   - Remove `<button class="back" id="pj-back">← All projects</button>` from `#pj-one-view`.
   - Remove the now-dead consolidated CSS rule `#pj-back { display: none }`.
   - Remove the `#pj-back` click handler + its pj-back-specific comment. (The
     `pjCloseConfirm` it did on the way out is still done by the Projects-tab route via
     `topLevelReset('projects')`, so the 5-second-refresh-stuck bug that comment warned
     about stays guarded.)
   - `.back` class is shared by 7 other buttons (detail/create/tk/docs/alltasks/
     pj-settings/pj-add) — the CSS class rule is left untouched.
2. Browser-checks (the door-out route switches from `#pj-back` to `.tab[data-tab="projects"]`,
   already the established route-click in these files):
   - `render-projects.js` (5 clicks) + 2 stale comments.
   - `render-tasks.js` (2 clicks).
   - `render-consolidated-layouts.js` (2 comments only — it never clicked pj-back).
3. `web.unique-ids.test.js` — swap the `pj-back` example id (used as "an existing id"
   in two controls) to `pj-say`, which still exists exactly once.

## Gates
- #1720 coarse browser-check gate: satisfied — the change touches docs/browser-checks/*.
- #2518 surface gate: no check annotates `pj-back` as a surface token, and the 3
  checks that referenced it are all updated on the branch.
