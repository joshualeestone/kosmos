# newlook-agents-4470: the Agents page in the new look (behind the switch)

Card: joshualeestone/kosmos#4470 (umbrella: the new look, page by page, behind Settings > Advanced > "Try the new look").
Josh 2026-09-28 22:34: "If you're bored later and want to knock out some of it to see this live project page that would be dope". The project page shipped first (#4537, served in 0.7.11). This is the next page.

## What changes, and only under `html[data-look="new"]` on the tab layout (`body:not(.consolidated)`)
There is no drawing of the Agents page. It follows the approved project page (v9 light, v7 dark): white page, the grey box, round grey buttons, no borders where a ground already separates.

1. **Stat tiles:** Agents, Working and Idle, while inert, lose their box, even on hover. Messages is a filter: at rest it keeps a soft grey ground with no border (its "you can press this", which a touch screen needs), and pressed or hovered it takes today's gold. Its padding does not change with state, so the row never jumps. (A floored Agents tile, which becomes a button when the window list cannot be read in full, keeps today's box.) The alert tiles (Issue, No project) keep their red outline; that is the row's "look here".
2. **New agent:** a round grey button (40px, the new look's grey) with "New agent" beside it on one line; the control stays 44px tall.
3. **Sort menu and view toggle:** grey pills with no outline; the toggle's end segments take the pill's round, so the keyboard focus ring follows it. The current view stays gold (Josh, 2026-08-17, twice: "selected is gold, not ink").
4. **Board notices** (`.pj-empty`: the restart note, the could-not-read notes, and the empty notes of the board and the Projects list): the project page's grey box (radius 28). The empty notes lose their border; a notice that something is wrong (`.boardfail`, which the restart note is) keeps its solid border, which is what tells it apart. The restart note sits 18px above the cards.
5. **Cards:** radius 24. Only the plain card loses its border and shadow; stopped (.off) and paused cards count as plain, per the 08-21 ruling that they keep the white treatment.

## Not changed, on purpose
- Every state stroke: Working (green), Issue (red), Question (blue), the dashed could-not-read card (.unk). Josh, 2026-08-21: "state owns the ground and the stroke".
- Every tile, count, label and hide-at-zero rule; the tile order; the markup. CSS only.
- The consolidated layout (its own screens), and the page with the look off.

## Checks
- `render-newlook-4470`, new arms on the Agents page with the look on:
  - the idle card has no border and 24px corners, the Agents tile has no box, and New agent is a 40px round grey button;
  - the Agents tile shows no box under the pointer either;
  - the Messages filter rests on the grey ground and keeps its width under the pointer;
  - hand-drawn Issue, Question and could-not-read cards keep their strokes (the last one dashed);
  - a pressed Messages filter still shows its pressed ground and border;
  - a board note is the grey box with 28px corners, and a could-not-read note (.boardfail) keeps a solid, visible border.
- With the look off, the control: today's bordered card, Agents tile and New agent tile.
- Compared on the same board, on against off: the working card's stroke and the current view's gold are identical.
- Control: the branch's check file on main's page fails its new Agents arms. With the four checks the surface gate names, it passed 438/0 on ddc79d512 (the head before the review-5 fixes; re-run on the final head before the PR).
- `docs/browser-checks/mobile-shots.js`: `nl-home`, `nl-agents-list`, `nl-project-room` screens, and a `newLook(page)` helper that sets the switch's stored value (`localStorage['kosmos-look']`) and reloads, which is what the page reads before paint.

## Not yet in the new look
The list view's rows and the org chart keep today's style; they are the next pages of this umbrella.

## Weakest premise
The look is drawn from the project page's language, not from a drawing of this page. It is behind the switch and off by default, so a wrong call is visible only to someone who turns it on, and Josh reviews in the running app.

## Done when
The page is merged, then served in a build with the switch on, and screenshots of the running app are on #4470.
