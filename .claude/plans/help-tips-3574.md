# #3574: first-run help and first-visit tips

Josh, 2026-09-24 12:50 CDT (#chaoskosmos-design): "lets try putting in the help modals on like .93 and
see how they look". Build the mock as drawn: chaoskosmos-site `design/first-run-help.html`, branch
`first-run-help-3574` (61f29dd). Tour B, the step-through, per Josh 2026-09-24 15:51 ("I liked this
style much better", with the mock's B screenshot); A (all four at once) was built first and replaced.

## Finished looks like
The first time the board opens with this build (a fresh install after setup, and an existing install once after it updates: the tour has not been seen there either, and existing users have not had it), the tour walks the four places one at a time
(New agent, Agents, Projects, your name: "N of 4", the place ringed, the rest dimmed, dots, Skip and
Next, Got it on the last) and ends with Got it, Skip, the x, Escape or a click outside. It
never returns on its own. A ? button beside the user's name reopens this screen's tip, the welcome
tour, or the ring explainer. Each screen named in the mock shows its tip once, the first visit.
"Stop showing tips" turns every first-visit tip off; Settings has the switch to turn them back on.
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
   dots, Skip and Next, Got it on the last. Shown once, on the board (its stats bar in the tab layout,
   its rail in the consolidated one). It takes focus when it opens.
4. The ? button in `.headright` before `#userpop`, with a small popover reusing the userpop
   mechanics: Show tips for this screen / Take the welcome tour again / What does the ring mean?
5. First-visit tips: New agent, the ring (first time a ring is shown), Agents (first time there is
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
That "the first time the dashboard opens after setup" can be detected reliably from the existing
first-run completion signal (revealBoot after the first-run gate resolves). If it cannot, the
fallback is "no `tour` id in seen", which also shows it to existing users once.

## Verification
A browser check: fresh sandbox shows the tour once; Got it records it and a reload does not show it;
? reopens it; each first-visit tip shows once; Stop showing tips hides all and the Settings switch
restores them; light and dark; narrow width places the card in-page. Controls for each "shows once".
