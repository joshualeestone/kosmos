# kosmos#6168: a project room post is drawn the moment Post is pressed

## Measured first
The agent page draws the person's message at once (#4944, TALK_PENDING). The room's pjPostSend drew nothing until the
POST answered (a room post types into every member's pane in turn) and loadRoom had read the room again.
docs/browser-checks/render-room-send-shows-now-6168.js holds the room POST open 2500 ms and measures press-to-drawn:
- before (origin/main): NOT DRAWN while held (it appeared only after the POST answered and the room was re-read);
- after: 56 ms.

## Change (web/index.html)
- `PJ_ROOM_PENDING[project]`, `pjRoomPendingRow` (the person's own bubble, time slot "Sending…", or "Not posted." /
  "Not confirmed." with the reason) and `pjRoomPendingKept` (same words from the person, kept no earlier than a minute
  before the press), mirroring dmPendingRow / dmPendingKept.
- paintRoom: the pending row after the room's rows until the room holds it; not during a search.
- pjPostSend: drawn at the press from the room's last read (only while still in that project); a refused post and an
  unreachable board mark it (unreachable as "Not confirmed": it may have arrived); a kept post drops it after the re-read.

## Decided
- The box keeps the words on a failure, as before, and the failed bubble stays until the next post replaces it, as the
  agent page does. Rejected: removing the bubble on failure (the message would quietly disappear).

## Weakest premise
That matching by words and the operator flag is enough to hand over to the kept row. Two identical posts within a minute
would hand over at the first kept copy; the second is then drawn when the room is read (the agent page has the same rule).

## Evidence
- The browser check above: 7 assertions, 4 red on origin/main, all green after.
- 515 node tests that read the room's send or paint pass; gated.txt (sorted) and the README list the check.
