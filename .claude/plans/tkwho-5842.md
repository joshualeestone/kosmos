# tkwho-5842: the task page says who a message did not reach

Card #5842 (filed by Baron from the #5805 limittask review). Slice 1 of 2.

## Done when (this slice)
- After a task message is sent, the line under the box names every assignee it did not reach, from the route's `delivered` list, in the page's own sentences: not told, kept for later (held, from limittask-5805 once it lands), or not confirmed.
- A send that reached every assignee adds nothing (the activity above already shows the message), and clears any line left from before.
- web.task-say-outcome-5842.test.js runs the page's own tkSayPost (with the page's tkMemberName and quotaResetWords) against the route's real shapes, and fails on main's page (measured at each round; the tests that pass there are the says-nothing cases).
- web.task-composer-768.test.js still passes (tkSayPost stays self-contained; the outcome code sits inside it).

## Calls
- The page writes its own sentences from `delivered`, never the board's `summary` or its reasons word for word (review 3). Both were written for agents and direct messages: some reasons say "send it again" (on a task that records the message twice and re-tells everyone already told), some use terminal words (scrollback, terminal), and one opens with the card name, which doubled the name. Agents and the CLI still get the full reason.
- Three reasons the task route writes itself are recognised and get their own sentence: switched off in this project (keeps "Switch it on in the project's members to send it work here."), no longer on the project, and (limittask-5805) a message Kosmos could not keep: "Kosmos could not keep your message for X, so it was not told." which claims no cause, since the keep fails for a full queue, an unreadable store, or with no cause given (reviews 4 and 5). Every other failure: "Kosmos could not reach X, so it was not told. Your message stays on the task." No "just now": a paused agent clears tomorrow (review 5). A reworded reason falls to that sentence, which stays true.
- Unconfirmed is never claimed either way: "Kosmos could not confirm that X got it."
- A kept (held) message says it comes later, never "not told": it was accepted. Built from `heldUntil` with the page's quotaResetWords (local time), never from the reason, which carries the reset as a raw UTC stamp (review 1). "X is out of usage until <time>. Kosmos sends it your message after that." ("after that", not "then": the sweep also waits on the automatic gate, review 3). Kept behind earlier lines (recognised by the board's wording, since the route does not forward `behind`): "X gets your message after the ones already waiting for it." No time known, a reset already past, or a reworded reason: "Kosmos is keeping your message to send to X later." claims nothing more.
- Agents are named by their card name through tkMemberName, as the activity above does (review 1).
- An empty `delivered` list says "No agent is assigned to this task, so nobody was told." ("assigned", as the note under the box says) The page sends as the person, so the route lists every assignee (review 1).
- Each line starts with a capital, since a line can open with a name (review 5).
- Shown in the existing #tk-say-msg line (neutral secondary text, not an error colour).
- Rejected: showing `summary` or the reasons verbatim (above); a per-agent list UI (one line is enough for an exception the person rarely sees).
- Weakest premise: the generic failure sentence drops the specific cause (a question waiting in the agent's window, say), so the person learns that it failed but not why. The agent's own page shows its state, and a person who wants detail can open it. If people ask "why", the next step is a short, page-written reason per known cause, not the board's text.
- Deferred (review 4): "out of usage until <time>" is not refreshed, so a person who leaves the task open past the reset still reads it. It describes the moment of the send, sits under the message just sent, and clears on the next send or task change. A timer to rewrite it is more machinery than the line is worth.
- Kept-behind wording is cross-checked against engine/messages.js by a test that arms itself once heldReceipt lands with limittask-5805 (review 6).
- Deferred (review 6): aria-live "polite" for this line. #tk-say-msg also carries real send errors, which should stay assertive; splitting the element is more than this slice needs.
- Also: role="alert" on #tk-say-msg announces "gets it later" as loudly as a failure. Left as is: both change what the person should expect.

## Slice 2 (waits on limittask-5805, Baron)
- A kept message later dropped is recorded in the task's conversation (a new taskchat kind, rendered in tkActPhrase), readable from the CLI too. The drop hook (limitqueue.sweepHooks onDropped, kind 'task') exists only on limittask-5805.

## Browser check
Plain text in an existing element, driven by the route's existing answer. Covered by the lifted-function test; trailer used.
