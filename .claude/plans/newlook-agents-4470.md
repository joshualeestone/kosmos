# newlook-agents-4470: the Agents page in the new look (behind the switch)

Card: joshualeestone/kosmos#4470 (umbrella: the new look, page by page, behind Settings > Advanced > "Try the new look").
Josh 2026-09-28 22:34: "If you're bored later and want to knock out some of it to see this live project page that would be dope". The project page shipped first (#4537, served in 0.7.11). This is the next page.

## What changes, and only under `html[data-look="new"]` on the tab layout (`body:not(.consolidated)`)
There is no drawing of the Agents page. It follows the approved project page (v9 light, v7 dark): white page, the grey box, round grey buttons, no borders where a ground already separates.

1. **Stat tiles:** Agents, Working, Idle and Messages lose their box (transparent border and ground). The alert tiles (Issue, No project) keep their red outline; that is the row's "look here".
2. **New agent:** the project page's round button (40px, the new look's grey) with "New agent" beside it on one line.
3. **Sort menu and view toggle:** grey pills with no outline. The current view is a white segment, not gold.
4. **Board notices** (`.pj-empty`, the restart note and its siblings): the project page's grey box (radius 28, no border). The restart note sits 18px above the cards.
5. **Cards:** radius 24. Only the plain card (no state class) loses its border and shadow.

## Not changed, on purpose
- Every state stroke: Working (green), Issue (red), Question (blue), the dashed could-not-read card (.unk). Josh, 2026-08-21: "state owns the ground and the stroke".
- Every tile, count, label and hide-at-zero rule; the tile order; the markup. CSS only.
- The consolidated layout (its own screens), and the page with the look off.

## Checks
- `render-newlook-4470`, new arms on the Agents page with the look on: the idle card has no border and the working card keeps its stroke; the Agents tile has no box; New agent is a 40px round grey button; the current view is the page's ground. An Off arm is the control: today's bordered card and tile.
- Control: the branch's check file on main's page fails its 12 new arms. With the four checks the surface gate names, it passes 417/0 on a9d6b83cb.
- `docs/browser-checks/mobile-shots.js`: `nl-home`, `nl-agents-list`, `nl-project-room` screens, and a `newLook(page)` helper that turns the switch on as a person does.

## Weakest premise
The look is drawn from the project page's language, not from a drawing of this page. It is behind the switch and off by default, so a wrong call is visible only to someone who turns it on, and Josh reviews in the running app.

## Done when
The page is merged, then served in a build with the switch on, and screenshots of the running app are on #4470.
