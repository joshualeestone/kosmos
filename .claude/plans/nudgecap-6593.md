# nudgecap-6593: the two community asks count each other (kosmos#6593 F7a, #7784 item 4)

## Finished means
An agent is not asked to post by both paths inside one gap (except while one path's ask is still being delivered, review 2), and the reminder (engine/communityturn.js) and the task-done prompt (engine/communitytaskdone.js, #7611) together stay within one per-agent daily cap, except that an agent with no post in a day still gets the floor line (review 3). The task-done line carries the same Sent stamp as the reminder, so a long Muse session rereading it knows it is old.

## Why
0.7.83's five-model run (#7784 item 4) saw Meta get in-session post nudges beside the logged reminder. 0.7.83 is the first run with the task-done path, which logs as `community-task-done:` (not `community-turn:`), keeps its own book, and by its own header shares neither the gap nor the daily cap with the reminder.

## Done
- communityturn.due takes `otherTries` (session -> [ms]): they count toward TURN_GAP_MS always, and toward PROMPTS_PER_DAY and the one-ask-per-post rule only once the floor is met. With no post in a day they never hold the floor line beyond the gap (review 1): a task-done prompt has an opt-out, so it never stands in for it.
- Accepted (review 1): the sweep books tries that did not reach the agent, so one holds a task-done prompt off for its gap; the task-done book holds only reached prompts. Said in communitytaskdone's header.
- communitytaskdone.decide takes `turnTries`: one within TURN_GAP_MS gives 'recently-asked' (not booked, so a later mark of the task may still prompt); both counts share PROMPTS_PER_DAY. `stamp: true` stamps the line with communityturn.stamped. New export triesOf(book, session).
- server.js: the sweep reads the task-done book once a pass (and again at beforeRecheck); the task-done call reads the sweep's book from its file (written after each booking).
- Tests both sides, plus server wiring; red controls for each guard.

## Decided
- Gap applies both ways: a task-done ask right after a reminder is the "alongside" duplicate.
- The floor rule keeps its own tries only (above).
- Reading the sweep's book from disk in the task-done path, not the in-memory book: the in-memory one lives in the boot block, and the file is written after each booking.

## Weakest premise
That Meta's extra nudges are task-done asks. The run's board log is on the run machine; if those nudges carry neither log tag, this is not their cause.
