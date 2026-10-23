# nudge-seen-6947: tell an agent whether the person has seen its nudge on a task

Card: kosmos#6947 (agent feedback, 2026-10-22). Routed to Angel by Splinter 18:20 CDT.

## Finished looks like
An agent that left a message on a task runs `kosmos task activity <project> <n>` (Mac or Windows) and its last line says either that the person has not viewed the task yet, or when they viewed it and whether that was after or before the latest message. Tested on both CLIs, the board route and the page.

## What "seen" means (the card asked the builder to decide)
**The task's conversation was drawn on the person's screen**: any draw of it that succeeded while the tab was visible and the task's page on screen. That is opening the task, a redraw after an action on its page (a reply from its composer, a close, a due date), or coming back to the tab while it was showing, which draws it again first. With #6951 each state of the conversation is recorded once per open of the page, so a redraw of an unchanged conversation (a tab return, an action) records nothing new; the time kept is the latest record. paintTaskActivity marks it after such a draw, for the project and task it drew. The page posts `POST /api/project/<id>/task/<n>/seen`; the board keeps the latest time per task in `<data>/task-seen/` (engine/taskseen.js); `GET .../activity?words=1` (what both CLIs read) answers `seenByPerson`.

Rejected:
- The page's own activity read as the signal: it runs on a timer while a task stays open, whether or not anyone is looking. (#6951 later draws, and so marks, on the five-second read, but only while the person is there: window focused, input in the last two minutes.)
- The card scrolled into view in a column, or a notification opened: the column card does not show the conversation, and notifications are opened outside Kosmos where the board cannot see them.
- A history event per open: it would add a line to the task's conversation every time the person looks.

## What it misses (said plainly, as the card asked)
- A nudge read somewhere else: the project room, a phone or desktop notification, the task's card in a column, the Needs your decision list. Those count as not seen.
- A page opened but not read: opening is not reading; the person may glance and leave. A tab can also report visible while another app's window covers it, or while a dialog inside Kosmos sits over the task's page (its back button keeps its layout box).
- A message that arrives while the task's page is open and the person stays on it: #6951 draws it on the next five-second read, which marks it, while the person is there (window focused, a click, key, wheel or touch in the last two minutes). Someone reading without touching anything for longer, or with the page behind another Kosmos tab, gets it drawn and marked on their next input or return.
- The person answering from the task page's composer adds the latest message and redraws, so the line then reads "after the latest message", where the latest message is the person's own. The conversation above it shows that.
- A message that lands between the page reading the conversation and the board receiving its seen post (one round trip to this computer's own board): counted as seen though not drawn. Closing it would mean the page sending the time of the newest event it drew; not done, as the window is one local request.
- Only the latest view is kept, not each one. Tasks viewed before this version read as not viewed.
- Any draw on screen counts, including a redraw after an unrelated action on the task's page (a due date, a part): the conversation is on screen then, but the person may not have read a new message in it.
- Any browser that shows the board's page counts as the person, the phone's included.
- A task with no events at all prints "Nothing recorded" and no viewed line (every task records its creation, so this does not arise in practice).
- Nothing removes a task's record when its project is deleted, so a project made again under the same id could inherit an old view time for a reused task number.
- "The latest message" means the latest `said` event. Some messages carry no author (the composer's and `kosmos task message`'s), so it may be the person's own reply; the conversation above the line shows which. Other ways an agent reaches the person (a hold notice, a message kept while an agent was out of usage) are not compared.
- A view that could not be recorded (the board failed to write it, or the page's post was refused or lost) reads to the agent like never viewed. #6951 retries a server error or lost post once and logs a failed write; a refusal, or a second failure, still reads as never viewed until the next message is drawn.
- A newer command against an older board, which sends no viewed field, prints no line at all, so the agent cannot tell anything either way.
- Only the person's page can mark a task seen (server.js isViaScreen: no agent token, and the browser's own fetch headers or a local Origin). Those headers are advisory, so a local process that sends them deliberately can still forge it.

## Built
- engine/taskseen.js (markSeen, seenAt), own folder so the room's progress allowance (which counts recently written task-chats files) does not count an open as progress.
- server.js: the seen route (page only via isViaScreen, unknown task 404); activity?words=1 adds seenByPerson.
- web/index.html: paintTaskActivity calls tkMarkSeen(n, project) after each successful draw; tkMarkSeen checks the task and project are still open and the page is on screen; a visibilitychange listener redraws on tab return.
- install/kosmos and tools/windows/kosmos-cli.js: the last line of task activity.
- Tests: server.task-seen-6947, web.task-seen-6947, cli.task-activity-5874 (both CLIs, after and before).

## Weakest premise
That opening the task page is how a person reads a nudge. If people mostly read nudges in the project room, "not opened" will often be wrong in the cautious direction (the agent waits or re-routes when the person already saw it). Next step then: count a room read of the message too.
