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
- web/index.html (7 lines added, nothing else changed): pjOpensDone() sets PJ_AUTO_OPENED_ONCE and WANT_PROJECT_DONE,
  ending both of loadProjects' arrival opens (the #867 auto-open and the ?project= deep link). It is called first in
  takeOverDisplayColumn (Settings, Agents, Tasks, New Agent, the Projects page) and in openAddProject (the New project
  form, which does not take over the column). loadProjects itself is unchanged: its existing guards read the marks.
- docs/browser-checks/render-snav-head-4979.js, consolidated arm: every projects GET is held until Settings has been
  clicked and the 300 ms sample taken, then released (a 30 s fallback from the click, cleared on release; try/abort per
  #6022). Three control lines (no read had landed at the click; Settings opened before the release; the late read had
  an active project to auto-open, no deep link and the consolidated layout) and one assertion (no project opened over
  Settings). The page makes three
  reads at load: holding only the first did not reproduce, because the other two landed first.
- web.consolidated-867.test.js: runs the real takeOverDisplayColumn and checks both marks; openAddProject calls
  pjOpensDone first; both opens still read the marks.

## Decisions
- Fix the product, not the check: a person who opens Settings on a slow load had it taken away. Rejected: waiting in
  the check for the read before clicking (it would hide the bug).
- Mark the opens done when the person opens a view, never defer them. #867's flag exists "so a person who
  deliberately presses Back to the list is not immediately shoved back into a project on the next poll". Review round
  1 proposed deferring until the column is free; round 2 found that does exactly that (open Settings, close it, and a
  poll opens a project). So a person who opens and closes Settings before the first read lands sees the list's own
  "Open or create a project to get started.", #867's own exception.
- Mark at the opener, not at read time (review round 3): one rule for every view, and loadProjects untouched, so the
  two layout signals and the "view is the record" rule of paintPjNone are not in play.
- The deep link ends the same way: the person's later click wins over the URL.
- The window is "until the first read that succeeds", not only a slow one (review round 5). While reads fail (offline,
  signed out, a 500), both opens stay armed, and a view opened then ends them too: a ?project= link opened offline is
  lost if the person browses to Settings and back before coming online, and lands on the list. Rejected: not marking
  after a failed read, which brings this card's own bug back on recovery (a read that finally lands replaces the view
  the person has open). Losing the link costs a click on that project in the list; the other costs their place.
- Weakest premise: that losing an unopened deep link after the person browses is acceptable (above); and that every caller of takeOverDisplayColumn and openAddProject is a person's choice. Checked each:
  the menu and rail Settings, a login notice, nav clicks, detail-back and create-back, tasks, New Agent, the Projects
  page, tcFinish -> tcGoToTeam(true) (TC is in memory only, null at boot, and made only by openTeamCreate from the
  team-seeded-go click or an already-started team session), and the two New project buttons.

## Validation (this Mac, headless, queued-heavy.sh), final code
- Arm A, the check on origin/main's index.html (12:05): rc 2. "the late read did not open a project over Settings"
  FAILs with cur "gettingstarted" and pj-one-view shown, the CI signature; both controls pass, and the diagnostic
  reads settingsHiddenAt300ms false and settingsHidden true (opened, then hidden).
- Arm B, the check on the fix (12:06): rc 0, 0 FAIL, no SKIPPED; all three controls, the assertion and "no page
  errors" pass in all 4 arms (2 engines x 2 widths).
- Untouched arrival (no click, reads not held) on the final fix: all 4 arms auto-open gettingstarted, pj-one-view
  shown, the "No projects yet" hint hidden.
- Unit tests: web.consolidated-867 8/8 (7/8 against origin/main's index.html); web.consolidated-774,
  web.noise2-6533, web.projects-signed-out-718 (identical to main), web.federation-3312, web.task-seen-6947 and
  browser-checks-teardown-guard-6022 all pass.
- render-consolidated-layouts refuses outside the sandboxed runner; the nightly covers it.
