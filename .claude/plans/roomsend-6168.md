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
That a row id the room did not have at the press is this post. The board writes the row only when its fan-out is done,
so an older row can never be it; a newer post of the same words from another window in the same flight could hand over
early (harmless: the kept row is then on screen). An earlier version of this plan said the agent page "has the same
rule" for identical words; it does not (it matches only after the POST answers). Corrected in review 1.

## Evidence
- The browser check above: 7 assertions, 4 red on origin/main, all green after.
- 515 node tests that read the room's send or paint pass; gated.txt (sorted) and the README list the check.

## Review
1. opus: no blocker. WARNINGs fixed, each with a mutant that reds the check: an older post with the same words
   swallowed the pending row (now matched only against rows not in the room at the press); a "Not confirmed" bubble sat
   under its own kept copy (now replaced once the room shows it, and a bare 5xx is "Not confirmed"); the words were in the
   room and the box at once (the box empties at the press when the bubble is drawn, the words come back on a failure, as
   #4944's tookBox / restoreUnsent); the check could not see a double copy (it now reads the room's own hand-over while
   the post is still answering, plus same-words and dropped-connection arms). Also: the first repaint is inside the try.
   Left: no reply header or file cards on the pending row (they appear on the swap); "Sending…" not announced (failures
   and success are); an unsure post that did land leaves its words back in the box.
