# #8024: opening an agent acknowledges its needs-you

Addresses #8024. #2336 stays off; switching the email on is that card's.

## What finished looks like
A report or stuck-terminal needs-you, opened by the person, is acknowledged to the coordinator; an unopened one is not.

## Decided
- "Opened" is the agent's chat open on the person's own screen, board or phone: the existing read cursor, POST /api/agent/<name>/seen (#2863, #7354). A push merely delivered does not count. Rejected a new route: that is a second meaning for the same act.
- Only isViaScreen acks. The route has no such gate, since a cursor is harmless, but with acks attached an agent posting to it could silence its own email.
- Board and phone sent /seen only with unread replies, and a question usually has none, so the read alone would miss it. A status field, openAckDue, tells them.
- Only pushes that went out are kept (happened() returned true). Crashloop and own-bounds needs-you rows are not covered: the card did not name them and production's rows are the two it names. Would change my mind: those rows appearing in numbers.
- Weakest premise: an open chat means the person dealt with it. They may have seen the question and walked off. It is the card's suggestion and the signal we have, and an email they did not get is the cost.
- Also not covered: a question that ends without the person opening it (the agent clears it, say) stays unacknowledged, so #2336 needs a rule for that before it turns on. Stated on the card.

## Not verified
A real row on the live coordinator, the card's own test: that needs a release and a phone. The ack was checked only as far as the request the coordinator's own test matches on.
