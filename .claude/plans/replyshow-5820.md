# replyshow-5820: the person sees an agent's declared reply channel on its page, and can clear it

Card: joshualeestone/kosmos#5820, follow-up to #5805 part 2 (PigeonPete's replychan-5805, `kosmos reply-channel`).

## Finished looks like
- On an agent's page, when it has declared a reply channel: one line, "<name> says it answers you on <channel>, so
  Kosmos does not send it the reminder to answer your first message here.", with Clear. Nothing when none is declared.
- Clear removes the declaration (as `kosmos reply-channel kosmos` would); the first-reply nudge speaks for the agent
  again; the page says "Cleared. ..." and moves focus there.
- Only the person can clear it, from the page. A stranger's session holding the agent's name shows nothing.
- Server tests, page tests that run the real painter and the real Clear handler, and a design-shots screen whose
  verify presses Clear in a browser.

## Decided
- **Place: the agent's page** (header, beside the token notice). Only the first-reply nudge reads the declaration
  (#5805 review 9), so the card's other option, the room's "has not answered" line, does not apply.
  Weakest premise: that a person looks at the agent's page when an agent goes quiet. A later design pass can move it.
- **Read off the row's own profile**, which status.js reads only for a pane tied to the name: no second read per
  poll, and no name-keyed read past the tie gate.
- **Person-only route** (isViaScreen), like codex-hooks. A name is known if it has a worker folder OR a declaration;
  nothing declared answers 200 without writing (a write would overwrite an unreadable profile).
- **A short memory of each clear on the page** (the status poll timeout plus 2 s), so a poll that started before the
  clear does not paint it back.

## Not done
- The README line for the new screen waits for the rebase onto main (the base predates #5816's README edit).
- Telling the agent its channel was cleared: it simply gets the first-reply reminder again.
