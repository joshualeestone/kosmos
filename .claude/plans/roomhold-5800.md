# #5800: a held room explains itself to everyone in it

Card: joshualeestone/kosmos#5800 (feedback 10-10). Item 2 (who changed a file last) split to #5812.

## Finished looks like
- The room page, while the loop guard holds the room, shows on the hold's band who can end it and how (post, or Reopen), when it ends by itself, and a working Reopen button. An older band in the scrollback shows none of that.
- An agent reading `kosmos room <id>` sees one `[kosmos]` hold line at the top while the room is held, before it posts, saying who can release it and that it should not send its post another way.
- With the room open, neither appears.

## Decision
- Held is read from the record (`messages.roomHeld`): the limit is on and the latest stopping valve row is inside the window and after the person's last post or reopen. It is a reading, not a re-run of the budget.
- Rejected: re-running the budget sum on every room read (it reads task and file times; too heavy for a 5 s poll) and a new held flag in the store (a second source of truth that can disagree with the valve).
- Agents get no reopen. The reopen route stays the person's (#2710's stance: an agent cannot release a hold it is looping in).
- Weakest premise: `until` is an upper bound. The #4786 allowance (work moving) can let a post through earlier, so the page may still show Reopen for a room that would accept a post. Harmless: pressing it is the same release.

## Steps
1. engine/messages.js `roomHeld` + export. Done.
2. server.js room route: `held` in JSON, hold line atop `?as=text`. Done.
3. web/index.html: `PJ_ROOM_HELD`, `pjHeldAct` on the valve band, `pjHeldReopenClick`, one style line. Done.
4. Tests: server.room-held-5800.test.js (engine + route + reopen clears), web.post-receipt.test.js (#5800 paint test). Mutation checks on the band call and the window check both went red. Done.
5. Design shots, challenge loop, PR, merge on green.

## Validation
Focused: the two test files, server.room-reopen-2710, engine/messages.test.js, the file-scanning guards (fixture-discipline, #4796, no-brand-refs, no-name-refs, the three Windows guards), and all web.*.test.js (2644 pass). Full suite: CI.
