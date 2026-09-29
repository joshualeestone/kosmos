# sendjump-4639: the person's own send takes them to the bottom, like Discord (kosmos#4639)

Josh, #admin 2026-09-29 15:27-15:28: agents' posts must keep not moving the view (the existing no-jump fix), but
when HE sends a message the view should jump to the very bottom so he sees it land, as Discord does.

## Finished means
In a Direct Message and in a project room: a person scrolled back reading is not moved by an arriving agent
post; their own send lands them at the bottom with their message in view; the next agent post keeps them there.
A browser check per surface proves each of those, and goes red with the send's jump removed.

## Change
- `web/index.html`: `jumpToOwnSend(el, query)`, beside `pinToBottom`, which it calls, except while a search is
  filtering that list (`TALK_QUERY` / `PJ_ROOM_QUERY`): their message may not be in it, and a filtered list does
  not follow the tail, so a send leaves them where they are. Two call sites:
  - `sendTalk` (DM), right after `talkPaintPending` draws the "Sending" bubble, so that row is where they land.
    The reply's repaint (`paintTalk` -> `setThread`) then measures them at the floor and keeps them there.
  - `pjPostSend` (room), at the press (where Post is disabled), as the DM does. Not when the server answers: a
    fan-out can take seconds, and a jump that late would pull back someone who scrolled up meanwhile. `paintRoom`
    measures the floor before every write, so the confirming repaint lands them on their post.
  Nothing in `setThread`, `paintRoom` or `holdFloorOnResize` changes: an agent's post still follows only a reader
  who was already at the floor.
- `docs/browser-checks/render-dm-sendjump-4639.js` (new, hermetic file:// harness, real paintTalk / sendTalk): J1
  control (really scrolled back), J2 agent message arriving does not move them, J3 own send lands at the bottom
  with the row in view, J4 the next agent message keeps them there. Listed in `gated.txt` and the README.
- `docs/browser-checks/render-room-scroll.js` arm 4b (`sendJumpArms`), run in the tab view and again in the
  consolidated view: the same four for the room on a sandboxed board (a post arriving by the poll, own post typed
  into `#pj-post` and clicked), plus a fifth: someone who scrolls up while a slow send (POST held 2.5s) is in
  flight is not pulled back when it lands; and a sixth: with a search filtering the room, a send does not move
  them.

## Rejected
- `pjSend` (one agent's thread inside a project, `#pj-msgs`): not a scroll box (the page scrolls there), and it
  has no follow-the-tail rule to extend.
- The agent side panel (`asbSend`): already pins while `ASB.sending`.
- The Terminal tab's send (`sendTerm`): the DM thread is in a hidden section while that tab is open, and
  `pinToBottom` arms nothing on a hidden box; coming back to Talk already lands on the newest row.
- Phone-width runs of the checks: the same boxes are the scrollers at phone width (overflow-y on `#d-dmthread`
  and `#pj-room`), and the code has no width branch. Not measured.
- A flag read by `setThread` / `paintRoom` ("jump on next paint"): more state across polls; pinning at the send
  and letting the existing floor measurement carry it needs no new state.

## Measured
- Room arm 4b: 6/6 in the tab view and 6/6 consolidated (32/32 for the file). With the room call removed, "own
  send lands at the bottom" and "next post keeps them there" go red (3532px above the floor); with the jump moved
  back to after the server answers, the slow-send arm goes red in both views; with the filter guard removed, the
  filtered arm goes red in both views.
- DM check: 5/5 pass; with the DM call removed, J3 and J4 go red (1715px above the floor).
- Wiring tests (tools.browser-checks-wired, pr-select, indexed, reason-grep, selectors, home-3675): 58/58.

## Weakest premise
The fixture's "arriving" post is posted through the person's room route, not as an agent: it reaches the screen
by the same poll an agent's post does, which is the path the rule is about.

The DM jump relies on the "Sending" bubble being painted synchronously by `talkPaintPending`. When the thread has
not been read yet (first open) it paints nothing, and the jump lands on the old tail; the reply's repaint then
follows the floor, so they still end at their message, one repaint later. That first-open path is reasoned, not
measured: no check drives it. A failed room send also jumps (at the press) with nothing new below; the error
sits beside the composer they are looking at.
