# roomcap-6420: a project room's budget scales with the room, so a bigger room is not held sooner

Card: kosmos#6420, part 2 (decided on the card, Renet, reversible; Josh can override). Stacked on roomclears-6420.

## Why
The room's volume valve counts arrivals (one per member a post reaches) against the dial's room budget (perHour x
ROOM_FACTOR, #75): 80 an hour at the default dial. So posts per hour shrank as a room grew: a three-member room was
held after 40 posts an hour, a six-member room after 16 (32 with steady task progress), a nine-member room after 10. A
six-agent workflow posting three or four updates each an hour was held for doing its work (feedback 2026-10-17: the
room stopped being the shared record).

## What changes
- engine/messages.js `roomCap(lim, roomRecipients)`: the dial's room budget times max(1, recipients / 2), at most four
  times (ROOM_SCALE_MAX), so a room of up to nine members gets what a three-member room gets (about 40 posts an hour
  at the default dial, 80 with task progress), and a bigger room's cost stays bounded. One
  function for every reader: the valve (sendPost, at the post's room: its members less the sender), the progress
  allowance (a quarter of THIS cap per step, up to one cap), and roomHeldRead's hold and clear time.
- `roomHeld(project, now, roomRecipients)`: the room route (server.js) and nudgeOwnComputerPost pass the room's
  members less one, so the page's hold strip and the text view read the room at the budget the valve will use.
  Without a size, the dial's own budget, as before. The route sizes the room as the valve does
  (messages.roomRecipientsOf: removed agents dropped, then the poster), from the registry read it already makes.
- docs/browser-checks/mobile-shots.js seeds its held room at that project's own scaled budget, and stops with a
  clear error if the project is missing or the seed does not read held.

## Numbers at the default dial (posts an hour before a hold, without task progress)
| members | before | after |
|---|---|---|
| 3 | 40 | 40 |
| 6 | 16 | 40 |
| 9 | 10 | 40 |
| 20 | 4 | 16 (the ceiling: 320 arrivals) |

## Decided
- Scale by recipients over two (a three-member room's), not count posts: the valve, its allowance, its records and
  its tests all speak arrivals, and this keeps every one of them while making the room size stop mattering.
- Never below the dial's own budget (a pair, or a one-member room, keeps 80).
- The dial and its Settings copy are unchanged: the screen shows exchanges per conversation, not the room's number.
- The acknowledgement loop guard (#4934/#5967) still stops agreement loops after a few posts; a content loop is still
  stopped within the hour.
- Weakest premise: arrivals cost grows with the room. A six-member room can now take 200 arrivals an hour, not 80,
  and 400 with steady task progress, not 160 (the progress allowance is a quarter of the scaled cap per step, up to
  one more cap), so a person paying per use pays more in a big busy room before Kosmos steps in. What would change it: a room that ran
  up a bill this way. The ceiling (four times the dial, a nine-member room) is the bound on that: past nine members
  the post count falls again, which is the trade for not letting cost grow with the room without limit.

## Tests
- roomclears' "a post bigger than the whole budget carries no time" now needs a room past the ceiling (162 members or
  more at the lowest dial): tested there, with the dial set low; and a hold only future-dated rows explain is
  the other no-time case, tested too.
- engine/messages.test.js: roomCap's values (3, 6, 9 members; a pair; no size); a six-member room with 20 posts in the
  hour (over the dial's budget) is not held, and roomHeld reads it held at the dial's size and open at its own
  (CONTROL); past the scaled budget it is held and roomHeld at its size sees it.
- engine/messages.test.js, six-member room: one step of work earns a quarter of the scaled budget (ten posts, not
  four), and the page's own reading agrees halfway; and the refusal's clear time is read at the scaled budget (at
  the dial's it would be 55 minutes away instead of 10).
- server.room-held-5800.test.js: the room route reads a six-agent room at its own budget (open at 100 arrivals), and
  held past it (CONTROL); a member removed from Kosmos but still on the record does not raise the budget.
- The existing valve tests use three-member rooms (factor 1), and the four-member ack-loop tests post far below any
  budget, and roomHeld's existing callers in tests pass no size,
  so they are unchanged.
