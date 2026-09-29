# sendjump-4639: the person's own send takes them to the bottom, like Discord (kosmos#4639)

Josh, #admin 2026-09-29 15:27-15:28: agents' posts must keep not moving the view (the existing no-jump fix), but
when HE sends a message the view should jump to the very bottom so he sees it land, as Discord does.

## Finished means
In a Direct Message and in a project room: a person scrolled back reading is not moved by an arriving agent
post; their own send lands them at the bottom with their message in view; the next agent post keeps them there.
A browser check per surface proves each of those, and goes red with the send's jump removed.

## Change
- `web/index.html`: `jumpToOwnSend(el)`, beside `pinToBottom`, which it calls. Two call sites:
  - `sendTalk` (DM), right after `talkPaintPending` draws the "Sending" bubble, so that row is where they land.
    The reply's repaint (`paintTalk` -> `setThread`) then measures them at the floor and keeps them there.
  - `pjPostSend` (room), after the server confirms the post and before `loadRoom()`. `paintRoom` measures the
    floor before it writes, so the new post is where they land.
  Nothing in `setThread`, `paintRoom` or `holdFloorOnResize` changes: an agent's post still follows only a reader
  who was already at the floor.
- `docs/browser-checks/render-dm-sendjump-4639.js` (new, hermetic file:// harness, real paintTalk / sendTalk): J1
  control (really scrolled back), J2 agent message arriving does not move them, J3 own send lands at the bottom
  with the row in view, J4 the next agent message keeps them there. Listed in `gated.txt` and the README.
- `docs/browser-checks/render-room-scroll.js` arm 4b: the same four for the room on a sandboxed board (arriving
  post by fetch, own post typed into `#pj-post` and clicked).

## Rejected
- `pjSend` (one agent's thread inside a project, `#pj-msgs`): not a scroll box (the page scrolls there), and it
  has no follow-the-tail rule to extend.
- The agent side panel (`asbSend`): already pins while `ASB.sending`.
- A flag read by `setThread` / `paintRoom` ("jump on next paint"): more state across polls; pinning at the send
  and letting the existing floor measurement carry it needs no new state.

## Measured
- Room arm 4b: 4/4 pass; with the room call removed, "own send lands at the bottom" and "next post keeps them
  there" go red (3532px above the floor).
- DM check: 5/5 pass; with the DM call removed, J3 and J4 go red (1715px above the floor).
- Wiring tests (tools.browser-checks-wired, pr-select, indexed, reason-grep, selectors, home-3675): 58/58.

## Weakest premise
The DM jump relies on the "Sending" bubble being painted synchronously by `talkPaintPending`. When the thread has
not been read yet (first open) it paints nothing, and the jump lands on the old tail; the reply's repaint then
follows the floor, so they still end at their message, one repaint later.
