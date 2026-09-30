# docsback-4586: the back chevron beside the title on a project's Documents and Tasks views

Card: joshualeestone/kosmos#4586 (Josh, #admin, 2026-09-29 11:35, reversing #3502's removal).

## Done
- web/index.html: a round chevron button (`.sub-back`, the #2928 back glyph in #4470's round frame,
  32px) beside the title:
  - Documents (`#docs-chev`), shown in the consolidated view only; click returns to the room
    (`pjView('one')`, the same as `#docs-back`). Named "Back to <project>" by openDocsView.
  - Tasks (`#tsk-back`), shown exactly when the view is for one project (when the crumb shows
    Open project); it carries `data-open-project`, so the panel's existing delegated click opens the
    room: one way in, not two.
- Layout: Documents' title block is a two-column grid so the chevron sits on the title's line; on Tasks
  the title takes the free space (margin-right: auto) so the chevron sits against it and "+ New task"
  stays at the far right.
- Test pin web.tasks-new-3703 widened to allow the leading chevron (New task still follows the title).
- New gated browser check render-subback-4586: consolidated Documents and Tasks, tab-view Tasks at 1280 and 390, focus kept across a repaint, and controls (all-projects Tasks, tab-view Documents, #docs-back still hidden). Fails on origin/main.

## Decided
- Documents chevron is consolidated-only: the tab view keeps its "<- name" back above the title, and
  two backs on one screen is the redundancy #3502 removed. Rejected: un-hiding #docs-back in
  consolidated (Josh asked for a chevron next to the title, which is not where #docs-back sits).
- Tasks chevron in both layouts whenever a project is picked (the Tasks view has no other back beside
  its title in either layout). Includes a project picked from the dropdown: "back" then goes to that
  project, the same place the crumb's Open project goes.
- No Escape binding: these are pages, not overlays; the page's comments say a page has no Escape.
- #4470's new-look styling is not applied here: that look is scoped to the tab view's project header.

## Weakest premise
That Josh wants the Tasks chevron when the project was chosen from the dropdown rather than a door.
Reversible in one line (gate on how the view was opened).
