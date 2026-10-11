# tkwho-5842: the task page says who a message did not reach

Card #5842 (filed by Baron from the #5805 limittask review). Slice 1 of 2.

## Done when (this slice)
- After a task message is sent, the line under the box names every assignee it did not reach, from the route's `delivered` list: not told (with the board's reason), kept for later (held, from limittask-5805 once it lands), or not confirmed.
- A send that reached every assignee adds nothing (the activity above already shows the message), and clears any line left from before.
- web.task-say-outcome-5842.test.js runs the page's own tkSayPost and fails on main's page (measured: 5 of 7 fail; the 2 that pass are the says-nothing cases).
- web.task-composer-768.test.js still passes (tkSayPost stays self-contained; the outcome code sits inside it).

## Calls
- The page builds its own sentences from `delivered`, not the board's `summary`. `summary` is written for agents ("Do not send it again.", "Told mara.") and the person already sees the message in the activity.
- The board's reasons already read as sentences to a person ("casey is switched off in this project. Switch it on in the project's members to send it work here."). When a reason starts with the agent's name it is shown as it is; otherwise the name goes in front ("casey was not told: its window is scrolled back right now.").
- A kept (held) message says it comes later ("casey gets it later" or the board's own "casey is out of usage until 3pm; Kosmos types it after the reset"), never "not told": it was accepted.
- An unconfirmed delivery is never claimed either way: "Kosmos could not confirm that casey got it." Same rule as the board's summary.
- Shown in the existing #tk-say-msg line (neutral secondary text, not an error colour).
- Rejected: showing `summary` verbatim (agent-facing instructions on a person's screen), and a per-agent list UI (one line of text is enough for an exception the person rarely sees).
- Weakest premise: role="alert" on #tk-say-msg makes a screen reader announce the line. That is right for "not told", arguably loud for "gets it later". Left as is: both change what the person should expect.

## Slice 2 (waits on limittask-5805, Baron)
- A kept message later dropped is recorded in the task's conversation (a new taskchat kind, rendered in tkActPhrase), readable from the CLI too. The drop hook (limitqueue.sweepHooks onDropped, kind 'task') exists only on limittask-5805.

## Browser check
Plain text in an existing element, driven by the route's existing answer. Covered by the lifted-function test; trailer used.
