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

## Blind review round 1 (Opus, separate reviewer)
Three WARNINGs, fixed, each with a test that fails on revert:
- The coordinator rule was chat.looksLikeManager, which matches Marketing Manager, Tech Lead, Lead Developer. Now its own narrow PROJECT_COORDINATOR (project manager, program manager, project lead, project coordinator, pm).
- "Done not set" showed for a folder with no BRIEF.md (adopted folders, older projects) and on the welcome project from day one. Now: no brief says nothing (doneSet null); the welcome brief carries WELCOME_DONE.
- A done typed for a folder that already had a BRIEF.md was dropped. Now fillDone replaces Kosmos's placeholder, or adds a Done section to a brief without one; a Done section the person wrote is left alone.
NITs taken: "both have" for two; a saved role is paired with the saved name, never an untied pane's card name; the root-only skip is recorded (t.skip). Accepted: the done note (like #2707's) is posted only at creation; per-read file reads (existsSync + BRIEF.md + a profile per member not running) are small and uncached, a cache keyed by mtime is the fix if it shows.

## Blind review round 2 (Sonnet, separate reviewer)
Five WARNINGs, fixed, each with a test that fails on revert:
- fillDone passed the person's words as a replacement string ($& and $' were interpreted). Now a function replacement.
- The page cleared the warning on any null read, including one that started before the add. Reads are numbered as they start; a null clears it only from a read started after the add.
- A placeholder quoted inside other text counted. It now counts only as a whole line, for both the badge and fillDone.
- A Done heading titled another way ("### done looks like (draft)") got a second section. Any level, any case, trailing words count as present.
- BRIEF.md is read and written only as a regular file under 256 KB (lstat); a symlink or huge brief says nothing and is never written through.
NITs taken: CRLF briefs keep CRLF; "PM" counts only as a whole role word (not AM/PM, Post-PM). Accepted: read-modify-write is not atomic against a simultaneous edit of BRIEF.md (a create-time, one-off write); a person's own brief with no Done section reads as set (only Kosmos's placeholder means unset).

## Blind review round 3 (Opus, separate reviewer)
One WARNING, fixed: the brief note (#2707) had been reworded to ask for done too, so a project given a done but no goal told its agents to ask for the done again. BRIEF_PENDING_NOTE is main's goal-only text again; BRIEF_AND_DONE_PENDING_NOTE is posted only when done is not set either. Two route tests (done-no-goal asks only for the goal; neither asks for both), each failing its mutant. Also run by hand: render-projects on a sandboxed board with the harness's fleet (passes); it runs only in the cut's page layer.

## Blind review round 4 (Sonnet, separate reviewer)
One WARNING, fixed: a done refusal reached no field. The done box now has its own error line (pj-add-done-err), a pre-check at 1000 code points before the round trip (as the description has), and the create catch routes an engine refusal naming "done looks like" to it. Browser check: +2 arms (too long caught at the box with nothing sent; an engine refusal shown at the box), both failing their mutant. Accepted NIT: a done typed for a folder whose own brief already has a Done section is not written (their words win) and nothing says so.
