# #4583: done at creation, and a warning for two coordinators

Card: joshualeestone/kosmos#4583 (#4580 items 3 and 4). Started by Ice Cream Kitty (projdone-4583 @ 60b6e0eee, WIP, untested); moved to PigeonPete by Splinter 14:39 CDT. Built on her commit, merged with main, on branch projdone2-4583 (her branch and worktree untouched).

## What it does
(a) Done: the create form has an optional "Done looks like" box (one line, 1000 characters, sent only when typed). Given, it is written under "Done looks like" in the seeded BRIEF.md. Blank, the brief says "**Not set yet.**", the project read says `doneSet: false`, the projects list row shows "Done not set", and a staffed project with a goal gets ONE agents-only room note: the Project Manager (or one agent) asks the person and writes the answer into BRIEF.md. The brief-less note (#2707) now also asks for done. Briefs written before this (the old placeholder) still read as not set.
(b) Coordinators: two or more members whose role is a coordinating one (chat.looksLikeManager, the rule the room already uses) are warned about, never refused: in the create answer and when a coordinator joins (not when anyone else joins). The warning names them and suggests one owns the brief and one the task queue. A member not running has no live role, so its saved profile role is used. The page shows it in the project notice after an add or a create that brought it on, until it no longer holds or the person dismisses it (tab-lived; a warning at add time, not a standing nag).

## Decisions
- Kitty's room note is kept instead of a line in the managed instructions block: it reaches the staffed agents once, like #2707's note, and does not rewrite every member's instructions.
- Profile fallback for role (added): without it the warning never fired at creation, when members are usually not running yet.
- Event-based page warning (added): Kitty's server returned the warning but the page never showed it.

## Tests
- engine/projects.done-4583.test.js (8): done written / placeholder / old placeholder / person's brief / unreadable brief / missing brief; cleanDone rules and a refused create writes no brief; warning with two, not one; live role before profile; joiner filter; the read's warning from saved roles.
- server.projects.test.js #4583 (4): done note once and agents-only; done given means no note and the brief carries it; over-long done refused, nothing created; create and join warnings, a non-coordinator join does not re-warn and is never refused.
- docs/browser-checks/render-project-done-4583.js (12), gated: form box, POST shape, row badge and its control, warning shown only after an add, Dismiss, dropped when resolved and not revived.
- Mutations (all restored, cmp-verified): 6 engine, 4 server, 3 web; each fails. The check fails against main's page.

## Neighbours (found before review)
- The titles-only rail (#3105) grew to 52.8px per row with the badge; the rail now hides "Done not set" like the status pill (render-project-rows back to 26px). The list view keeps it.
- Room tests built on the generic "briefed" fixture now also set a done, for the same reason #2707 gave it a description (a goal with no done posts the done note).
- web.project-notice-3923: its harness stubs pjCoordNotice and asserts the rail puts the warning first.
