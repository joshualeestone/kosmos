# #5800: a held room explains itself to everyone in it

Card: joshualeestone/kosmos#5800 (feedback 10-10). Item 2 (who changed a file last) split to #5812.

## Finished looks like
- The room page, while the loop guard holds the room, shows in a strip between the thread and the composer (out of the scroll, so a person scrolled up still sees it) why, who can end it and how (post, or Reopen), when it should lift by itself, and a working Reopen button. The hold bands in the scrollback stay plain records.
- An agent reading `kosmos room <id>` sees one `[kosmos]` hold line at the top while the room is held, before it posts, saying who can release it and that it should not send its post another way.
- With the room open, neither appears.

## Decision
- Held is the valve's own decision for the next agent post, read from the record (`messages.roomHeld`): the limit is on, and the agent arrivals counted since the person's last post or reopen (the valve's sum and countFrom), plus the next post charged like the latest one, exceed the budget plus the #4786 allowance. The allowance is one function shared with the valve (roomProgressAllowance), read only for a room already over its plain budget, and the answer is kept 4 s per room while the record has not grown (the page polls every 5 s). No valve row is required: a full room refuses the next post whether or not anyone has been refused yet.
- Rejected: going by the valve row's age alone (review 1: reads held after the room accepts posts again, and open while still over budget); treating a post landed after the latest refusal as "open" in place of the allowance (review 4: refusals are deduped per agent per window, so the hold could stay hidden for the rest of it); requiring a stopping valve row (review 7: a row written while the limit was off hid a hold the valve enforces once it is back on); and a new held flag in the store (a second source of truth that can disagree with the valve).
- The notice's button carries the room it was drawn for, and the strip is cleared on every room switch (review 7: a notice left from another room reopened the room on screen).
- Agents get no reopen. The reopen route stays the person's (#2710's stance: an agent cannot release a hold it is looping in).
- Weakest premise: the next post's charge is an estimate (the latest post's; a member switched off or added changes it), and `until` counts only steps already taken, so both surfaces say "should lift by", not a promise. A wrong guess shows Reopen for a room that would take a post; pressing it is the same release.

## Steps
1. engine/messages.js `roomHeld` + export. Done.
2. server.js room route: `held` in JSON, hold line atop `?as=text`. Done.
3. web/index.html: `PJ_ROOM_HELD`, `pjHeldNotice` in the `#pj-held` strip above the composer, `pjHeldReopenClick`, one style line. Done.
4. Tests: server.room-held-5800.test.js (engine, allowance, route, reopen clears), web.post-receipt.test.js (#5800 strip paint test and the Reopen click). Mutation checks on each rule went red. Done.
5. Design shots, challenge loop, PR, merge on green.

## Validation
Focused: the two test files, server.room-reopen-2710, engine/messages.test.js, the file-scanning guards (fixture-discipline, #4796, no-brand-refs, no-name-refs, the three Windows guards), and all web.*.test.js (2644 pass). Full suite: CI.
