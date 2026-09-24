# #3574: first-run help and first-visit tips

Josh, 2026-09-24 12:50 CDT (#chaoskosmos-design): "lets try putting in the help modals on like .93 and
see how they look". Build the mock as drawn: chaoskosmos-site `design/first-run-help.html`, branch
`first-run-help-3574` (61f29dd). Tour B, the step-through, per Josh 2026-09-24 15:51 ("I liked this
style much better", with the mock's B screenshot); A (all four at once) was built first and replaced.

## Finished looks like
Tips show by themselves only for someone new (changed 2026-09-24 18:02 from "every install once,
upgraders included": the auto tour covered the agent card render-url-state clicks, and its step 1
"Make your first agent" is wrong on a board that has agents).
- The welcome tour shows by itself when the board has answered and has no agents, and "tour" is not
  in seen. It walks the four places one at a time (New agent, Agents, Projects, your name: "N of 4",
  the place ringed, the rest dimmed, dots, Skip and Next, Got it on the last). Got it, Skip, the x,
  Escape or a click outside record it. If its screen goes without any of those (keyboard, Back, a
  link) it is not recorded and shows again on the next visit to an empty board.
- Once a tour that showed by itself this session sees agents on the board, it counts as seen (its job
  is done) and the screen tips can follow. This is keyed on the board confirming "tour" (TIP_TOUR_SAVED),
  not the local list, and a failed save retries, backing off 5s to a minute. Without it, a new user
  whose tour went unrecorded, or whose save failed, would look like an upgrader for good.
- Each first-visit screen tip shows by itself once, and only after "tour" is seen.
- A board that already had agents at load (every upgrade) gets nothing by itself. The ? beside the
  user's name offers this screen's tip, the welcome tour, and the ring explainer. Closing a tour taken
  from the ? records it, and from then on the first-visit screen tips follow as for anyone else:
  deliberate, since asking for the tour is asking for help.
- "Stop showing tips" turns every first-visit tip off; Settings has the switch to turn them back on.
  Seen state survives a reload and a board restart. Light and dark both correct. Browser-checked.

## Pieces
1. Store: `engine/tips.js` (modelled on `engine/styles.js`): a JSON file in the data dir,
   `{ seen: [ids], off: bool }`. `GET /api/tips`, `PUT /api/tips` (merge `seen`, set `off`). A read
   failure answers `{ ok: false }` and the page shows no tips rather than re-showing seen ones.
2. The help card: one component (small gold "Tip" label, title, 2-3 sentences, primary button,
   "Stop showing tips", x). Arrow pointing up/down/left at its target; never covers the target; not
   modal (the page stays usable); on narrow windows it sits in the page with no arrow.
   Tokens only, no solid left bars (Josh 2026-09-24).
3. Welcome tour, step-through (Josh's pick, the mock's B): one card walks New agent, Agents, Projects
   and your name, "N of 4", the place ringed in gold with the rest dimmed by the ring's own shadow,
   dots, Skip and Next, Got it on the last. Shows by itself as above, on the board (its stats bar in the tab layout,
   its rail in the consolidated one). It takes focus when it opens.
4. The ? button in `.headright` before `#userpop`, with a small popover reusing the userpop
   mechanics: Show tips for this screen / Take the welcome tour again / What does the ring mean?
5. First-visit tips (by themselves only once the tour is seen): New agent, the ring (first time a ring is shown), Agents (first time there is
   one), Projects, inside a project (four-numbers layout). The agent-page and Settings tips per the
   mock's table (Settings says tips turn back on there).
6. Settings switch: "Show tips" on/off, writing `off`.

## Copy
Verbatim from the mock (my draft copy, which Josh has seen). "this computer", never "this Mac".
No em dashes.

## Rejected
- localStorage for seen state: per-origin and can come back empty (private window, cleared data),
  which would re-show every tip. The layout preference already lives server-side for the same reason.
- A modal tour: the mock says the card never blocks the screen.

## Weakest premise
That zero agents on the board means someone new. It rests on the status read: a board that cannot
read its agents answers with an error, and the page keeps its last list on an error (it never sets
LAST to []), and stopped agents are still listed. So only a genuinely empty roster reads as new.
If a future status path ever returned an empty list while degraded, an existing user could see the
tour once and then get the screen tips. Also: an upgrader never sees first-visit tips unless they
use the ?.

## Verification
A browser check: fresh sandbox shows the tour once; Got it records it and a reload does not show it;
? reopens it; each first-visit tip shows once; Stop showing tips hides all and the Settings switch
restores them; light and dark; narrow width places the card in-page. Controls for each "shows once".
T23: a board with agents and nothing seen shows nothing and records nothing. T24: a tour that went
unrecorded is recorded once the first agent arrives, through a failed first save. T25: an ordinary
close whose save failed is mended the same way. Each was run against the code with its fix removed
and failed.
