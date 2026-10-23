# seen-poll-6951: close the two gaps #6947 left (stacked on nudge-seen-6947)

Card: kosmos#6951 (round-8 follow-up to #6947).

## Finished looks like
A nudge that arrives while the person is on the task's page is drawn on the board's next read and counted as viewed, without an action; and a view the page could not record is tried once more and logged on the board.

## Built
1. web/index.html loadProjects (the 5-second read): while the task's page is up in a visible tab, paintTaskActivity(TK_OPEN, { onlyIfChanged: true }). paintTaskActivity keeps what it last drew on the holder (project, task, event count, last event's time and kind) and, for the poll's call, leaves an unchanged conversation alone: no redraw (which would drop a selection in it) and no new view record every five seconds. Every other caller draws as before.
2. tkMarkSeen: a server error (5xx) or a lost request is tried once more after 3 seconds, only if the task is still on screen (the same checks). A refusal (4xx) is not retried. server.js logs a record it could not write.

## Decided
- Change-only redraw on the poll. Rejected: redrawing every poll (selection lost, a view written every five seconds) and a separate lighter "has it changed" route (a second read path to keep in step).
- One retry. Rejected: none (the card's gap stays) and a retry loop (a broken board would be asked forever).
- No braces in paintTaskActivity's parameters: the page's tests lift functions by their first brace.

## Weakest premise
That one extra activity read per five seconds, only while a task's page is up and visible, is cheap enough. It is one local request; if the conversation file grows large, the read grows with it.

## Still missed (from #6947's list)
Everything there except the two closed here. A view that fails twice still reads as never viewed.
