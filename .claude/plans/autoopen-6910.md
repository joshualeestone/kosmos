# autoopen-6910: a view opened into the display column survives a late first projects read (kosmos#6910)

## Why
The nightly run (39968566117, 2026-10-23) went red in render-snav-head-4979, webkit consolidated 1000px. The #6938
diagnostic read settingsHidden:true at 300 ms and at the timeout, the chain was section#panel-settings hidden, and
shownInProjects was ["pj-list-view","pj-one-view"] at ?project=gettingstarted. Settings had opened, and a project view
took the column back. The cause is loadProjects' one-time arrival auto-open (#867):
`if (!PJ_AUTO_OPENED_ONCE && !WANT_PROJECT && !PJ_CURRENT && consolidated) openProject(first)`. When the page's projects
reads land after the person has opened something into the display column, PJ_CURRENT is still empty, so the
auto-open fires and replaces it. Only a slow runner gets that order.

## Change
- web/index.html: takeOverDisplayColumn() sets PJ_AUTO_OPENED_ONCE = true. Every caller is a person's action (Settings
  from the user menu or the rail, a login notice, Agents, Tasks, project tasks, New Agent, the Projects page), so an
  untouched arrival still auto-opens.
- docs/browser-checks/render-snav-head-4979.js, consolidated arm: every projects GET is held until Settings has been
  clicked (released after 10 s regardless; try/abort per #6022). A control line asserts no read had landed at the
  click, so the arm cannot silently stop testing the late order. The page makes three reads at load: holding only
  the first did not reproduce, because the other two landed first.
- web.consolidated-867.test.js: takeOverDisplayColumn sets the flag.

## Decisions
- Fix the product, not the check: a person who opens Settings on a slow load has it taken away. Rejected: waiting in
  the check for the projects read before clicking (it would hide the bug).
- Set the flag in the one shared takeover, not in each opener (repo convention: one place).
- Weakest premise: that every takeOverDisplayColumn caller is a person's choice. Checked each caller today; a future
  automatic caller would also stop the arrival auto-open.

## Validation (this Mac, headless, queued-heavy.sh)
- Arm A, the check change on the UNFIXED product: rc 2, with the CI signature exactly (settingsHidden and
  settingsHiddenAt300ms true, pj-one-view shown); the control line passed (readBeforeClick false).
- Arm B, the same check with the fix: rc 0, 0 FAIL, no SKIPPED; the control line passed in all 4 arms (2 engines x
  2 widths) and no page errors.
- Arrival, untouched (no click, reads not held), on the fix: all 4 arms auto-open gettingstarted, pj-one-view shown.
- render-type-to-focus-3283: rc 0. render-consolidated-layouts refuses outside the sandboxed runner; PR CI and the
  nightly cover it.
- web.consolidated-867.test.js 8/8; red (7/8) against origin/main's index.html.
