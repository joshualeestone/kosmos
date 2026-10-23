# seen-poll-6951: close the two gaps #6947 left (stacked on nudge-seen-6947)

Card: kosmos#6951 (round-8 follow-up to #6947).

## Finished looks like
A nudge that arrives while the person is on the task's page is drawn on the board's next read and counted as viewed, without an action; and a view the page could not record is tried once more and logged on the board.

## Built
1. web/index.html loadProjects (the 5-second read): while the task's page is up in a visible tab and the person is there (tkPresent: the window has focus and they moved, clicked, typed or scrolled in the last two minutes), paintTaskActivity(TK_OPEN, { onlyIfChanged: true }). paintTaskActivity keeps what it last drew on the holder (project, task, event count, last event's time and kind) and, for the poll's call, leaves an unchanged conversation alone: no redraw (which would drop a selection in it). The view is remembered apart from the draw (tkMarked: the board answered for this conversation). A mark that declined (nothing sent: the page behind another Kosmos tab) is tried on the next read of the same conversation; one on its way or waiting on its retry (tkMarking) is not sent twice; a settled one is not sent again until the conversation changes, by any draw. So the stored time is when the person first saw the conversation as it now stands, and both CLIs say "viewed at", not "last viewed at". Opening a task clears both; a failed read clears only the draw, so the next read redraws without re-recording.
2. tkMarkSeen: a server error (5xx) or a lost request is tried once more after 3 seconds, only if the task is still on screen (the same checks). Then the attempt is settled: recorded, refused (4xx, not retried), or failed twice. So a refusing or broken board is asked at most twice per conversation, not every five seconds. server.js logs a record it could not write.

## Decided
- The five-second read marks only while the person is there. Without that, a task page left open in a visible tab (an unattended desk) would mark every new nudge seen within five seconds, the exact false comfort #6947 exists to avoid. Rejected: the tab and on-screen checks alone (they cannot see an empty chair). Weakest premise: two minutes of no input means away; someone reading without touching anything for longer counts as away, and the new message is drawn and marked on their next input.
- Change-only redraw on the poll. Rejected: redrawing every poll (selection lost, a view written every five seconds) and a separate lighter "has it changed" route (a second read path to keep in step).
- One retry per conversation, then settled. Rejected: none (the card's gap stays), and retrying on every read (a refusing or broken board would be asked every five seconds while the page is up).
- No braces in paintTaskActivity's parameters: the page's tests lift functions by their first brace.

## Weakest premise
That one extra activity read per five seconds, only while a task's page is up and visible, is cheap enough. It is one local request; if the conversation file grows large, the read grows with it.

## Still missed (from #6947's list)
Everything there except the two closed here. A view refused or failed twice reads as never viewed until a new message arrives and is drawn. A slow read that lands after a newer one redraws the older conversation until the next read. The change-only check sees new events, not a change in how they read (a member renamed, "5 minutes ago" aging): those words stay as drawn until the conversation changes or the person acts. Two reads slower than five seconds can both draw, which is harmless. A message that lands in the 3 seconds before a retry is counted with the retried view though it was not drawn.
