# #3743 the unread edge (Josh 2026-09-25 09:15, DM with Mona Lisa)

Josh, verbatim: "Actually the stroke would be cool for an unread message and then as you read it it fades away"
(straight after choosing the #fbf4e4 fill with no outline, #3742).

## Finished looks like
An agent message the person has not read has a 1px #f5e4bc edge inside its bubble. Once it has been at least half on
screen for 1.2s with the window in front, the edge fades over 1.2s. History never shows it. With reduced motion, the
edge simply goes. Surfaces: agent DMs and project rooms now; the setup-assistant chat once #3733 lands (its code is on
that branch).

## Decided
- Unread is the app's own count, read as the thread opens (a DM's dmUnread in paintTalk, a project's unread in
  pjMarkSeen), taken from the newest agent messages, plus any agent message that lands while the thread is open.
  Rejected: a second read-state store (the card says use what exists).
- Read is half on screen for 1.2s while the window is visible and focused (IntersectionObserver); coming back to the
  window starts the clock. Rejected: fading at once on open, which is no signal at all.
- Marked after the paint by data-mid, so no renderer changes; room rows gain data-mid (DM rows had it).
- An inset box-shadow, so the bubble keeps its size and the edge follows the rounded corners. The tail wing is not
  edged; it is a pseudo-element under the bubble.
- Dark and navy: the gold at half strength, rgba(227,179,65,.5). Light is Josh's #f5e4bc.

## Weakest premise
That the backlog count names the newest N agent messages. The engine counts messages since the DM cursor, which is
the same thing when the newest are agent messages; a person's own message in between is not counted and is skipped
here too, since only agent rows are taken.

## Verification
render-unread-edge-3743 (new; runner, README): U1 the two unread have the edge and history does not; U2 it goes after
a moment on screen, with a 1.2s fade; U3 a repaint does not bring it back and a new arrival has it; U4 not while the
window is behind another, and coming back starts the clock; U5 reduced motion; U6 the room through pjMarkSeen and
paintRoom. Controls: without the backlog and the focus test U1, U4 and U6 fail; without the removal U2 fails.

## After review
- Read also counts 120px on screen, so a very tall message can be read (U8).
- A room read that did not answer is not a first look (U9); a per-thread read set keeps a stale count from re-edging
  what was read (U10); the sets are bounded by the rows shown (U11).
- Known and accepted: while a search filter is active the matching unread messages show no edge (clearing it brings
  it back), and a repaint inside the 1.2s fade ends it at once rather than finishing the animation.
- U13 (a message over twenty thread-heights tall, read down gradually) passes, but its negative control is not yet
  conclusive: without the scroll pass a plain run still passes, while an instrumented run fails. Not claimed as a
  guard until explained.
