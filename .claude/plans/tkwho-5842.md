# tkwho-5842: the task page says who a message did not reach

Card #5842 (filed by Baron from the #5805 limittask review). Slice 1 of 2.

## Done when (this slice)
- After a task message is sent, the line under the box names every assignee it did not reach, from the route's `delivered` list: not told (with the board's reason), kept for later (held, from limittask-5805 once it lands), or not confirmed.
- A send that reached every assignee adds nothing (the activity above already shows the message), and clears any line left from before.
- web.task-say-outcome-5842.test.js runs the page's own tkSayPost (with the page's tkMemberName and quotaResetWords) against the route's real shapes, and fails on main's page (measured: 7 of 9 fail; the 2 that pass are the says-nothing cases).
- web.task-composer-768.test.js still passes (tkSayPost stays self-contained; the outcome code sits inside it).

## Calls
- The page builds its own sentences from `delivered`, not the board's `summary`. `summary` is written for agents ("Do not send it again.", "Told mara.") and the person already sees the message in the activity.
- The board's reasons already read as sentences to a person ("casey is switched off in this project. Switch it on in the project's members to send it work here."). When a reason starts with the agent's name it is shown as it is; otherwise the name goes in front ("casey was not told: its window is scrolled back right now.").
- A kept (held) message says it comes later, never "not told": it was accepted. The page builds this sentence itself from `heldUntil` with the page's quotaResetWords (local time), because the board's reason carries the reset as a raw UTC stamp (review 1). Three shapes: "until <time>. Kosmos sends it your message then.", "after the ones already waiting for it" (kept behind earlier lines, no time), and "after the reset" (no time).
- Agents are named by their card name through tkMemberName, as the activity above does; when the board's reason opens with the session name, that name is swapped for the card name (review 1).
- An empty `delivered` list says "No agent is on this task, so nobody was told." (review 1: the note under the box says messages go to the assigned agents).
- An unconfirmed delivery keeps the board's reason when there is one, since it often says what to look at (review 1).
- An unconfirmed delivery is never claimed either way: "Kosmos could not confirm that casey got it." Same rule as the board's summary.
- Shown in the existing #tk-say-msg line (neutral secondary text, not an error colour).
- Rejected: showing `summary` verbatim (agent-facing instructions on a person's screen), and a per-agent list UI (one line of text is enough for an exception the person rarely sees).
- Weakest premise: role="alert" on #tk-say-msg makes a screen reader announce the line. That is right for "not told", arguably loud for "gets it later". Left as is: both change what the person should expect.

## Slice 2 (waits on limittask-5805, Baron)
- A kept message later dropped is recorded in the task's conversation (a new taskchat kind, rendered in tkActPhrase), readable from the CLI too. The drop hook (limitqueue.sweepHooks onDropped, kind 'task') exists only on limittask-5805.

## Browser check
Plain text in an existing element, driven by the route's existing answer. Covered by the lifted-function test; trailer used.
