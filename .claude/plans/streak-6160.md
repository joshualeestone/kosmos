# streak-6160: the streak in the Kosmos (kosmos#6160)

Josh, 2026-10-14 09:43 (#admin): hovering the top-left Kosmos logo says how many days in a row the person has used
Kosmos, and once a day, when the person's clock rolls over, a tiny note says "Congrats you've been in the Kosmos for
X days!".

## Done when
- Hovering (or focusing, or long-pressing on a phone) the K mark shows "N days in a row in the Kosmos" ("1 day in the
  Kosmos" on day 1); a click still goes to Agents.
- On the first page load of each new day, from day 2, a small dismissible note beside the K mark says Josh's
  sentence word for word; it appears exactly once per day, even with two screens open.
- The count survives a board restart; a missed day starts it again at 1.
- Tests cover a day rollover and a missed day (engine), the route (server), and the page (browser check).

## Calls (written on the card, Josh can override)
1. A day = the person opened the board that day, by the page's local date. Agent work does not count.
2. A missed day resets to 1 (no grace day).
3. The count lives on this board (`streak.json` under the data root), not synced through Kosmos+. Every screen of
   this board counts, a Kosmos+ remote screen included, and whichever opens first on a new day shows the note.
4. The label words are ours; the note is Josh's sentence verbatim.
5. The note shows from day 2, is recorded as shown in the same write that says to show it, and hides after 12 s.

## Built
- `engine/streak.js`: pure day logic (visit, congratsDue, markCongratulated, plausible) + `record(today)` over one
  file written with `store.saveFlushed`. A page date more than a day from the board's UTC date records nothing.
- `server.js`: `POST /api/streak` `{ today }` -> `{ count, congrats }`.
- `web/index.html`: `#kcongrats` and `#kstreak` under the K mark in `.headleft` (absolute, so the header never
  grows); `streakCheck()` on load, every minute (catches midnight on an open page) and on becoming visible; a long
  press on touch shows the label and swallows that press's click.
- Tests: `engine/streak-6160.test.js`, `server.streak-6160.test.js`, `docs/browser-checks/render-streak-6160.js`
  (wired in `tools/browser-checks.sh` and the README), and two `mobile-shots.js` screens for design shots.

## Weakest premise
Call 2: resetting after one missed weekend may feel like a punishment. A grace day is a change to `visit()` only.
