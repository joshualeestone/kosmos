# seen-poll-6951: close the two gaps #6947 left (stacked on nudge-seen-6947)

Card: kosmos#6951 (round-8 follow-up to #6947).

## Finished looks like
A nudge that arrives while the person is on the task's page is drawn on the board's next read and counted as viewed, without an action; and a view the page could not record is tried once more and logged on the board.

## Built
1. web/index.html loadProjects (the 5-second read): while the task's page is up in a visible tab and the person is there (tkPresent: the window has focus and they clicked, typed, used the wheel or touched it in the last two minutes; not scroll or pointermove, which also fire when the page itself scrolls or its layout moves under a still cursor). One read at a time (tkPollActivity): a read slower than five seconds is not joined by another, paintTaskActivity(TK_OPEN, { onlyIfChanged: true }). paintTaskActivity keeps what it last drew on the holder (project, task, event count, last event's time and kind) and, for the poll's call, leaves an unchanged conversation alone: no redraw (which would drop a selection in it). The view is remembered apart from the draw (tkMarked: the board answered for this conversation). A mark that declined (nothing sent: the page behind another Kosmos tab) is tried on the next read of the same conversation (the five-second read, so while the person is there; or a tab return or an action); one on its way or waiting on its retry (tkMarking) is not sent twice; a settled one is not sent again until the conversation changes, by any draw. So within one open of the page the board is told once per state of the conversation; a reopen or a reload records again. The time kept is the latest record, so it can be earlier than the person's latest look at an unchanged conversation; both CLIs say "viewed at" (a view at that time), which stays true either way. Opening a task clears all of it and starts a new open (tkOpen), so a record still in flight from an earlier open of the same task cannot settle the new one; a failed read clears only the draw, so the next read redraws without re-recording. Each read takes a number before it fetches, and one that lands after a newer read was drawn is dropped; an open also drops every read begun before it. A read from an earlier open is dropped by the sequence check; mark() and done() also refuse an earlier open's record (defence in depth: a test fails only with the sequence check and mark()'s guard both removed), and a retry from an earlier open does not post (current()). An older state settling late does not overwrite a newer one.
2. tkMarkSeen: a server error (5xx) or a lost request is tried once more after 3 seconds, only if the task is still on screen (the same checks). Then the attempt is settled: recorded, refused (4xx, not retried), or failed twice. So a refusing or broken board is asked at most twice per conversation, not every five seconds. server.js logs a record it could not write (not a 503 for an unreadable project list, which the page cannot tell apart either).
3. The five-second read's redraw switches #tk-activity's live region off for the swap and back on after, so a screen reader is not read the whole conversation, unasked, whenever something is recorded. A redraw the person asked for announces as before. The poll's redraw also puts keyboard focus back on the history row (a rollup's summary) the person had focused. A read that hangs lets the next one start after 15 seconds; only the run holding the flag releases it.

## Decided
- The five-second read marks only while the person is there. Without that, a task page left open in a visible tab (an unattended desk) would mark every new nudge seen within five seconds, the exact false comfort #6947 exists to avoid. Rejected: the tab and on-screen checks alone (they cannot see an empty chair). Weakest premise: two minutes of no input means away; someone reading without touching anything for longer counts as away, and the new message is drawn and marked on their next input.
- Change-only redraw on the poll. Rejected: redrawing every poll (selection lost, a view written every five seconds) and a separate lighter "has it changed" route (a second read path to keep in step).
- One retry per conversation, then settled. Rejected: none (the card's gap stays), and retrying on every read (a refusing or broken board would be asked every five seconds while the page is up).
- No braces in paintTaskActivity's parameters: the page's tests lift functions by their first brace.

## Left for a follow-up (review round 8, the usage cap)
- Within one open, an unchanged conversation is recorded once, so "viewed at" can be hours older than the person's latest look; re-recording on a tab return would refresh it for one request.
- The poll gate's wiring is pinned by its source line only (below).
- Focus inside a plain history row (not a rollup) is not restored; those rows hold no focusable control today.

## Not tested by running
The five-second read's gate (task view shown, tab visible, tkPresent) in loadProjects is pinned by its source line only: the lifted loadProjects tests run with no task open. Its parts (tkPresent, tkPollActivity, paintTaskActivity, tkMarkSeen) are run.

## Weakest premise
That one extra activity read per five seconds, only while a task's page is up and visible, is cheap enough. It is one local request; if the conversation file grows large, the read grows with it.

## Still missed (from #6947's list)
Everything there except the two closed here. A view refused or failed twice reads as never viewed until a new message arrives and is drawn. The change-only check sees new events, not a change in how they read (a member renamed, "5 minutes ago" aging): those words stay as drawn until the conversation changes or the person acts. Two reads slower than five seconds can both draw, which is harmless. A message that lands in the 3 seconds before a retry is counted with the retried view though it was not drawn.
