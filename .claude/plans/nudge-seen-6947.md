# nudge-seen-6947: tell an agent whether the person has seen its nudge on a task

Card: kosmos#6947 (agent feedback, 2026-10-22). Routed to Angel by Splinter 18:20 CDT.

## Finished looks like
An agent that left a message on a task runs `kosmos task activity <project> <n>` (Mac or Windows) and its last line says either that the person has not opened the task's page yet, or when they last opened it and whether that was after or before the latest message. Tested on both CLIs, the board route and the page.

## What "seen" means (the card asked the builder to decide)
**The person opened that task's page in Kosmos, with the tab visible and the task page on screen, or came back to the tab while it was showing.** The page posts `POST /api/project/<id>/task/<n>/seen`; the board keeps the latest time per task in `<data>/task-seen/` (engine/taskseen.js); `GET .../activity?words=1` (what both CLIs read) answers `seenByPerson`.

Rejected:
- The page's own activity read as the signal: it runs on a timer while a task stays open, whether or not anyone is looking.
- The card scrolled into view in a column, or a notification opened: the column card does not show the conversation, and notifications are opened outside Kosmos where the board cannot see them.
- A history event per open: it would add a line to the task's conversation every time the person looks.

## What it misses (said plainly, as the card asked)
- A nudge read somewhere else: the project room, a phone or desktop notification, the task's card in a column, the Needs your decision list. Those count as not seen.
- A page opened but not read: opening is not reading; the person may glance and leave. A tab can also report visible while another app's window covers it.
- A message that arrives while the task's page is already open: the page draws the conversation when the task opens or after an action, not on its timer, so the new message is not on screen and reads as not seen until the person opens the task again.
- Only the latest open is kept, not each one. Tasks opened before this version read as not opened.
- "The latest message" means the latest `said` event. Some messages carry no author (the composer's and `kosmos task message`'s), so it may be the person's own reply; the conversation above the line shows which. Other ways an agent reaches the person (a hold notice, a message kept while an agent was out of usage) are not compared.
- Only the person's page can mark a task seen (server.js isViaScreen: no agent token, and the browser's own fetch headers or a local Origin). Those headers are advisory, so a local process that sends them deliberately can still forge it.

## Built
- engine/taskseen.js (markSeen, seenAt), own folder so the room's progress allowance (which counts recently written task-chats files) does not count an open as progress.
- server.js: the seen route (page only via isViaScreen, unknown task 404); activity?words=1 adds seenByPerson.
- web/index.html: tkMarkSeen after pjView('task') in openTaskPage, and on visibilitychange.
- install/kosmos and tools/windows/kosmos-cli.js: the last line of task activity.
- Tests: server.task-seen-6947, web.task-seen-6947, cli.task-activity-5874 (both CLIs, after and before).

## Weakest premise
That opening the task page is how a person reads a nudge. If people mostly read nudges in the project room, "not opened" will often be wrong in the cautious direction (the agent waits or re-routes when the person already saw it). Next step then: count a room read of the message too.
