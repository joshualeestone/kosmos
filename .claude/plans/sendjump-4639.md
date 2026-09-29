# sendjump-4639: the person's own send takes them to the bottom, like Discord (kosmos#4639)

Josh, #admin 2026-09-29 15:27-15:28: agents' posts must keep not moving the view (the existing no-jump fix), but
when HE sends a message the view should jump to the very bottom so he sees it land, as Discord does.

## Finished means
In a Direct Message and in a project room: a person scrolled back reading is not moved by an arriving agent
post; their own send lands them at the bottom with their message in view; the next agent post keeps them there.
A browser check per surface proves each of those, and goes red with the send's jump removed.

## Change
- `web/index.html`: `jumpToOwnSend(el, query)`, beside `pinToBottom`, which it calls, except while a search is
  filtering that list (`TALK_QUERY` / `PJ_ROOM_QUERY`): their message may not be in it (the DM draws no "Sending"
  row while filtering, and the room's filtered paint never scrolls), so a send leaves them where they are. Two call sites:
  - `sendTalk` (DM), right after `talkPaintPending` draws the "Sending" bubble, so that row is where they land.
    The reply's repaint (`paintTalk` -> `setThread`) then measures them at the floor and keeps them there.
  - `pjPostSend` (room), at the press (where Post is disabled), as the DM does. Not when the server answers: a
    fan-out can take seconds, and a jump that late would pull back someone who scrolled up meanwhile. `paintRoom`
    measures the floor before every write, so the confirming repaint lands them on their post.
  Nothing in `setThread`, `paintRoom` or `holdFloorOnResize` changes: an agent's post still follows only a reader
  who was already at the floor.
- `docs/browser-checks/render-dm-sendjump-4639.js` (new, hermetic file:// harness, real paintTalk / sendTalk): J1
  control (really scrolled back), J2 agent message arriving does not move them, J3 own send lands at the bottom
  with the row in view, J4 the next agent message keeps them there, J5 with a search filtering the thread their
  send does not move them, J6 someone who scrolls up while a slow send is in flight is not pulled back when it
  lands, J7 with no "Sending" bubble drawn (the thread's last read gone) the reply's repaint still ends with their
  message in view. Listed in
  `gated.txt` and the README.
- `docs/browser-checks/render-room-scroll.js` arm 4b (`sendJumpArms`), run in the tab view and again in the
  consolidated view: the same four for the room on a sandboxed board (a post arriving by the poll, own post typed
  into `#pj-post` and clicked), plus a fifth: someone who scrolls up while a slow send (POST held 2.5s) is in
  flight is not pulled back when it lands; a sixth: with a search filtering the room, a send does not move them;
  and a seventh: a send that fails lands them at the bottom with its sentence beside the composer (the trade for
  jumping at the press).

## Rejected
- `pjSend` (one agent's thread inside a project, `#pj-msgs`): not a scroll box (the page scrolls there), and it
  has no follow-the-tail rule to extend.
- The agent side panel (`asbSend`): already pins while `ASB.sending`.
- The Terminal tab's send (`sendTerm`): the DM thread is in a hidden section while that tab is open, and
  `pinToBottom` arms nothing on a hidden box; coming back to Talk already lands on the newest row.
- Phone-width runs of the checks: the same boxes are the scrollers at phone width (overflow-y on `#d-dmthread`
  and `#pj-room`), and the code has no width branch. Not measured. In a very short window the fill-state CSS can
  make `#d-talk-box` the scroller instead; the existing no-jump rule shares that premise.
- A flag read by `setThread` / `paintRoom` ("jump on next paint"): more state across polls; pinning at the send
  and letting the existing floor measurement carry it needs no new state.

## Measured
- Room arm 4b: 7/7 in the tab view and 7/7 consolidated (34/34 for the file). With the room call removed, "own
  send lands at the bottom" and "next post keeps them there" go red (3532px above the floor); with the jump moved
  back to after the server answers, the slow-send arm goes red in both views; with the filter guard removed, the
  filtered arm goes red in both views.
- DM check: 8/8 pass. With the DM call removed, J3, J4 and J7 go red (1715px above the floor); with `TALK_QUERY`
  dropped from the call, J5 goes red; with the jump moved after the send lands (the `finally` repaint), J6 goes red.
- Wiring tests (tools.browser-checks-wired, pr-select, indexed, reason-grep, selectors, home-3675): 58/58.

## Weakest premise
The fixture's "arriving" post is posted through the person's room route, not as an agent: it reaches the screen
by the same poll an agent's post does, which is the path the rule is about.

The DM jump relies on the "Sending" bubble being painted synchronously by `talkPaintPending`. With no last read
to draw into it paints nothing, and the jump lands on the old tail; the reply's repaint then follows the floor,
so they still end at their message, one repaint later (J7 measures it with the bubble suppressed). A real first
open shows the "Opening" note, not a list anyone can be scrolled back in, and its first read lands at the bottom. A failed room send also jumps (at the press) with nothing new below; the room check measures that
the sentence is beside the composer they are at.
