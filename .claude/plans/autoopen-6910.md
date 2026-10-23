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
- web/index.html:
  - one helper, displayColumnOverlayOpen(), answers "does a view the person opened hold the display column?"
    (Settings, New Agent, Tasks in the column; the Agents view; the Projects page; the New project form).
    paintPjNone uses it in place of its five inline checks.
  - takeOverDisplayColumn() marks both of loadProjects' opens done (PJ_AUTO_OPENED_ONCE, WANT_PROJECT_DONE):
    the person has chosen the column.
  - loadProjects, in the consolidated layout, marks both done too when such a view (the New project form, which
    does not take over the column, included) is open as the read lands.
- docs/browser-checks/render-snav-head-4979.js, consolidated arm: every projects GET is held until Settings has been
  clicked (released after 30 s regardless, cleared on release; try/abort per #6022). Three control lines: no read had
  landed at the click; the late read had an active project to auto-open and no deep link; and no project opened over
  Settings. The page makes three reads at load: holding only the first did not reproduce, because the other two
  landed first.
- Unit tests: web.consolidated-867 pins both marks; web.consolidated-774 pins the hint's line, the helper's six
  views and lifts the helper with paintPjNone; web.projects-signed-out-718 and web.noise2-6533 give their lifted
  loadProjects a non-consolidated document.body.

## Decisions
- Fix the product, not the check: a person who opens Settings on a slow load had it taken away. Rejected: waiting in
  the check for the read before clicking (it would hide the bug).
- Mark the opens done, never defer them. #867's flag exists "so a person who deliberately presses Back to the list is
  not immediately shoved back into a project on the next poll". Review round 1 proposed deferring until the column
  is free, and round 2 found that does exactly that: open Settings, close it, and a poll later opens a project. So a
  person who opens and closes Settings before the first read lands sees the list's own "Open or create a project to
  get started.", which is #867's own exception.
- The deep link is done the same way: the person's later click wins over the URL.
- Weakest premise: that every takeOverDisplayColumn caller is a person's choice. Checked each caller (the menu and
  rail Settings, a login notice, Agents from the nav, detail-back and create-back, tasks, New Agent, the Projects
  page, and tcGoToTeam, which runs only after a create the person started).

## Validation (this Mac, headless, queued-heavy.sh)
- Arm A, the check on origin/main's index.html (re-run on the final code, 11:58): rc 2. "the late read did not open a project over Settings" is
  FAIL with cur "gettingstarted" and pj-one-view shown, the CI signature.
- Arm B, the check on the fix: rc 0, 0 FAIL, no SKIPPED. All three controls and "no page errors" pass in all 4 arms
  (2 engines x 2 widths).
- Untouched arrival (no click, reads not held) on the fix: all 4 arms auto-open gettingstarted, pj-one-view shown,
  the "No projects yet" hint hidden.
- Unit tests: web.consolidated-867 8/8, web.consolidated-774 3/3, web.noise2-6533 9/9, web.projects-signed-out-718
  1/1, browser-checks-teardown-guard-6022 2/2.
- render-consolidated-layouts refuses outside the sandboxed runner; the nightly covers it.
