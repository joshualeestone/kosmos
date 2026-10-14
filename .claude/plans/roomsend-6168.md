# kosmos#6168: a project room post is drawn the moment Post is pressed

## Measured first
The agent page draws the person's message at once (#4944, TALK_PENDING). The room's pjPostSend drew nothing until the
POST answered (a room post types into every member's pane in turn) and loadRoom had read the room again.
docs/browser-checks/render-room-send-shows-now-6168.js holds the room POST open 2500 ms and measures press-to-drawn:
- before (origin/main): NOT DRAWN while held (it appeared only after the POST answered and the room was re-read);
- after: 56 ms.

## Change (web/index.html)
- `PJ_ROOM_PENDING[project]`, `pjRoomPendingRow` (the person's own bubble, time slot "Sending…", or "Not posted." /
  "Not confirmed." with the reason) and `pjRoomPendingKept` (same words from the person, a row not in the room at the press and stamped
  no earlier than the press less 10 s), mirroring dmPendingRow / dmPendingKept.
- paintRoom: the pending row after the room's rows until the room holds it; not during a search.
- pjPostSend: drawn at the press from the room's last read (only while still in that project); a refused post and an
  unreachable board mark it (unreachable as "Not confirmed": it may have arrived); a kept post drops it after the re-read.

## Decided
- The box keeps the words on a failure, as before, and the failed bubble stays until the next post replaces it, as the
  agent page does. Rejected: removing the bubble on failure (the message would quietly disappear).

## Weakest premise
That a row id the room did not have at the press is this post. The board writes the row only when its fan-out is done,
so an older row can never be it; the snapshot can be stale, so the row must also be stamped no earlier than the press
less 10 s (review 3). A post of the same words from another window inside those 10 s can still hand over early; if this post is then
refused, it is drawn again as Not posted with its words back (review 4); if this post is unsure, it is treated as gone. An earlier version of this plan said the agent page "has the same
rule" for identical words; it does not (it matches only after the POST answers). Corrected in review 1.

## Evidence
- The browser check above: its arms grew with each review (see Review); on origin/main the press-to-drawn arm and every arm built on it are red, all green after.
- The node tests that read the room's send or paint, plus every browser-check guard, pass; gated.txt (sorted), the README and browser-checks-reason-grep's SITE_COUNTS list the check.

## Review
1. opus: no blocker. WARNINGs fixed, each with a mutant that reds the check: an older post with the same words
   swallowed the pending row (now matched only against rows not in the room at the press); a "Not confirmed" bubble sat
   under its own kept copy (now replaced once the room shows it, and a bare 5xx is "Not confirmed"); the words were in the
   room and the box at once (the box empties at the press when the bubble is drawn, the words come back on a failure, as
   #4944's tookBox / restoreUnsent); the check could not see a double copy (it now reads the room's own hand-over while
   the post is still answering, plus same-words and dropped-connection arms). Also: the first repaint is inside the try.
   Left: no reply header or file cards on the pending row (they appear on the swap); "Sending…" not announced (failures
   and success are). (The unsure-post-lands case was fixed in review 5.)
2. sonnet: no blocker. WARNINGs fixed, each with a check arm that a mutant reds: a failure no longer puts the words back
   when a read already showed the room holding the post (a second press would have posted it twice); a throw after the
   board answered is not reported as a failed post; the id snapshot no longer throws on a malformed read before the try;
   the check gained a bare 5xx, an already-shown-then-dropped post, and a refusal after moving project (parked draft).
   Stale counts in the README and here removed. Left (NITs): a success whose re-read fails shows the post again only at
   the next poll; files-only posts show their names as text until the kept row.
3. opus: BLOCKER fixed: browser-checks-reason-grep.test.js needed the new check's SITE_COUNTS entry (I had run only the
   tests that read the room, not the browser-check guards; now run with them, 616/616). WARNINGs fixed, each with an arm
   a mutant reds: an unsure failure says it cannot tell, in the line and the bubble, never "could not post"; no failure
   line when a read already showed the room holding the post; the line under the box starts empty at the press (a
   verdict about an earlier post sat under the next); the hand-over also requires the row stamped after the press, so a
   stale snapshot no longer lets an older same-words post swallow a new one (and lose its words on a refusal).
4. sonnet: no blocker. WARNINGs fixed, each with an arm a mutant reds: the check now asserts the pending bubble is
   visibly drawn (a real box), not only present in text; a definite refusal after the room handed over to another
   window's same words draws the post again as Not posted and gives the words back (it vanished silently). Stale plan
   lines corrected. Left: a board clock more than 10 s behind the browser's keeps an arrived "Not confirmed" post beside
   its kept copy until the next post.
5. opus: no blocker. WARNING fixed with an arm a mutant reds: an unsure post later seen in the room took its words back
   out of the box (onKept, the success path's rule), so one more press cannot post it twice. Comments corrected (the
   pending shape lists `before` and `onKept`; the thrown branch also covers a throw before the post went). Left: the
   engine's `unconfirmed` state is treated as success, as before this branch; bubble height across the swap unmeasured.
