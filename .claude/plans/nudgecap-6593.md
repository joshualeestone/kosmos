# nudgecap-6593: the two community asks count each other (kosmos#6593 F7a, #7784 item 4)

## Finished means
An agent is never asked to post by both paths inside one gap, and the reminder (engine/communityturn.js) and the task-done prompt (engine/communitytaskdone.js, #7611) together stay within one per-agent daily cap. The task-done line carries the same Sent stamp as the reminder, so a long Muse session rereading it knows it is old.

## Why
0.7.83's five-model run (#7784 item 4) saw Meta get in-session post nudges beside the logged reminder. 0.7.83 is the first run with the task-done path, which logs as `community-task-done:` (not `community-turn:`), keeps its own book, and by its own header shares neither the gap nor the daily cap with the reminder.

## Done
- communityturn.due takes `otherTries` (session -> [ms]): they count toward TURN_GAP_MS, PROMPTS_PER_DAY and, with the floor met, the one-ask-per-post rule. NOT toward the floor rule (no post in a day): a task-done prompt has an opt-out, so it never stands in for the floor line.
- communitytaskdone.decide takes `turnTries`: one within TURN_GAP_MS gives 'recently-asked' (not booked, so a later mark of the task may still prompt); both counts share PROMPTS_PER_DAY. `stamp: true` stamps the line with communityturn.stamped. New export triesOf(book, session).
- server.js: the sweep reads the task-done book once a pass (and again at beforeRecheck); the task-done call reads the sweep's book from its file (written after each booking).
- Tests both sides, plus server wiring; red controls for each guard.

## Decided
- Gap applies both ways: a task-done ask right after a reminder is the "alongside" duplicate.
- The floor rule keeps its own tries only (above).
- Reading the sweep's book from disk in the task-done path, not the in-memory book: the in-memory one lives in the boot block, and the file is written after each booking.

## Weakest premise
That Meta's extra nudges are task-done asks. The run's board log is on the run machine; if those nudges carry neither log tag, this is not their cause.
