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
- web/index.html: one helper, displayColumnOverlayOpen(), answers "does a view the person opened hold the display
  column?" (Settings, New Agent, Tasks in the column; the Agents view; the Projects page). paintPjNone uses it in place
  of its five inline checks, and loadProjects' two opens (the ?project= deep link and the #867 arrival auto-open)
  both wait while it is true. Neither is marked done then, so a later read (the 5 s poll) opens it once the column is
  free: a person who opens and closes Settings before the read lands still gets a project, not an empty centre.
- docs/browser-checks/render-snav-head-4979.js, consolidated arm: every projects GET is held until Settings has been
  clicked (released after 30 s regardless; try/abort per #6022). Three control lines: no read had landed at the
  click; the late read had an active project to auto-open and no deep link; and no project opened over Settings.
  The page makes three reads at load: holding only the first did not reproduce, because the other two landed first.
- web.consolidated-867.test.js: both opens check the helper, and the auto-open flag stays inside its guard.
  web.consolidated-774.test.js: the hint's line names the helper, the helper names all five views, and the
  lifted paintPjNone lifts the helper with it.

## Decisions
- Fix the product, not the check: a person who opens Settings on a slow load had it taken away. Rejected: waiting in
  the check for the read before clicking (it would hide the bug).
- Decide at read time, not by setting PJ_AUTO_OPENED_ONCE when a view takes the column (review round 1). That first
  version switched the auto-open off for good, so opening and closing Settings early left the empty centre #867
  exists to prevent.
- The deep link waits the same way: the person's later click wins over the URL until the column is free.
- Weakest premise: that opening the project after the person closes their view (on the next read) is wanted. It is
  what #867 asks for on arrival; it could surprise someone who closed Settings expecting the board.

## Validation (this Mac, headless, queued-heavy.sh)
- Arm A, the check on origin/main's index.html: rc 2. "the late read did not open a project over Settings" is
  FAIL with cur "gettingstarted" and pj-one-view shown, the CI signature.
- Arm B, the check on the fix: rc 0, 0 FAIL, no SKIPPED. All three controls and "no page errors" pass in all 4 arms
  (2 engines x 2 widths).
- Untouched arrival (no click, reads not held) on the fix: all 4 arms auto-open gettingstarted, pj-one-view shown,
  the "No projects yet" hint hidden.
- Unit tests: web.consolidated-867 8/8, web.consolidated-774 3/3, web.noise2-6533 9/9, web.projects-signed-out-718
  1/1, browser-checks-teardown-guard-6022 2/2.
- render-consolidated-layouts refuses outside the sandboxed runner; the nightly covers it.
