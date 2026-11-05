# kosmos#7348 bug 2: after a send in a DM the conversation steps instead of settling once

## Measured (iPhone 17e simulator, iOS 27, sample DM with Dana, 260 messages, keyboard up, 11-05)
KOSMOS_SAMPLE_SEND_SLOW=1.5 (Debug) paces a sample send as a real Mac does: the post answers after 1.5 s, the Mac's row
reaches the thread 0.5 s later for the next read. Without it the sample board answers at once and nothing can step (a
check that cannot fail; Splinter caught my first close on that). Each arm is its own copy of ios/ on a fresh simulator.
Bubble positions (the whole bubble's element), SendMovesOnceUITests, 2 runs per arm, both checks:
- main: sent message 360 -> 343 when the post answers (17 pt). Message above moves 25 pt (same-day) to 55 pt (new day), the
  second move at the read. Fails every run.
- hidden time line only: sent message still. Message above moves 25 to 38 pt at the read. Fails every run.
- full branch: 0 pt on both messages, read seen in every run. Passes every run.
Causes: PendingBubble drew no time line while sending and added one (17 pt) when the post answered; and a pending send was
outside Board.chatItems, so the day line, run spacing and the previous message's time line changed at the read.

## Finished looks like
A paced send moves neither the sent message nor the one above it, from the first look to 4 s past the read.
SendMovesOnceUITests (2 checks, in ios/tools/ui-sample.sh), 1 pt limit. Fails on main and on time-line-only; passes here.

## Call
Keep the time line's room while sending (drawn hidden), and group pending sends with the real rows as provisional rows so
each is drawn with the day line, spacing and time line it will have. Layout only; no scrolling changed.
Rejected: time line only. Measured above: the rows above still move.
Withdrawn: an earlier version of this plan recorded a 10 pt step left on purpose, the send "landing short". That was wrong.
The check read the words' own element, which is the words' size while pending and the bubble's size once kept: 10 pt higher
with no pixel moved. Screenshots before the post, after it and after the read put both bubbles on the same pixel rows. So
there is nothing to chase and no reason to touch the id anchor (#7817, #7420).
The check reads the whole bubble and skips (rather than fails) only when the machine is too slow to look: the tap outlasting
the post, or each look over a second.
A real move fails however few looks there were. On a loaded Mac the old count guard went red with no move seen.
Weakest premise: that the paced sample send matches a real Mac's timing closely enough; a real board can answer slower or
change the row more than once. The phone check on #8019 covers it.

Review round 2: a pending bubble takes the tail its row will have too. A failed or unconfirmed send stays out of the grouping
(no row is coming, and the message before it would lose its time line for as long as the bubble stays); that send's own
failure can therefore change the layout once, which is the honest moment for it. The grouping lives in BoardLogic so the logic
suite covers it. Left, on purpose: phone and Mac clocks disagreeing across midnight (a step in a window of seconds, once), and
a send before any conversation has been read (no day line until the first read: the sample board cannot reach it).

Review round 3: a send with files stands alone, as its row does. The read mark is the pending bubble's identifier going away,
not a size measured on one iOS. Left to CI, which runs before merge: whether this 260-message chat is too big to query there
(ChatOpensAtNewestUITests is left out of ui-sample for that; KeyboardSlideUITests runs the same chat on CI). If it times out
there, this class leaves ui-sample the same way.

Review round 4: a send drawn after a failed or unconfirmed one stays out of the grouping too, as it is not next to the rows.

Review round 5, kept on purpose: a taken send (the Mac took it, kept no row) is grouped even though a row may never come. Unlike a
failed or unconfirmed one, its bubble shows as sent with its own time, so as the last of the run it reads correctly with or
without a row, and the message above without a time line is right either way. Weakest premise here: how often taken occurs.

Review round 6, known remaining moves, none built:
- The "is working" line appearing under a send when the agent picks it up (12 pt plus its height). Reasoned from the code, not
  measured: the sample board's Dana never changes status. Rejected for now: keeping its room while a send is pending, because an
  agent that starts after the read would then step twice, and this list has blanked Josh's phone before. To be looked at on the
  phone check (#8019); if it is the step he still sees, it gets its own fix.
- A sent link's preview card arrives at the read: its size is not known until then. Predates this branch.
- A kept-undelivered send whose row says it failed to deliver: the row's line is taller than the note. Predates this branch.
CI: both checks skip if the runner is too slow to look, and a skip reads as a pass with a warning. The first CI run's log gets
read for SKIPPED before merge; a skipped check there means the pace must widen or the class leave, not a pass.

Review round 8: the second check waits for the first message's read rather than a fixed time. Round 8 is the cap (usage ruling): no
blocker is open, so the branch ships; the taken call and the CI skip above stand.

## Not seen
A real iPhone and board: a typed and a dictated send settling with no visible step (on #8019). A 96 pt move at a new day's
read was seen once on time-line-only in an earlier session, and not in the 5 time-line-only runs per check on 11-05 (3 with the
old check, 2 with this one).
