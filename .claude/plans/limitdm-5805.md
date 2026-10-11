# kosmos#5805 slice 2b: a person's own message to an agent out of usage is held, with "Send now anyway"

Stacked on slice 2a (limitmsg-5805), itself on slice 1 (limithold-5805). Slice 2a holds `kosmos msg`; a person's own
direct message (`POST /api/agent/:name/thread`, typed in the agent's page) still goes straight in with
chat.deliverAsync, so a person writing to an agent that is out of usage types into its limit screen.

## What exists (measured)
- The route types a person's message with chat.deliverAsync (no hold) and records the row with appendMessage; the
  row's delivery is `{ state, because, paneState, paneNote }`, and its `at` identifies it (no id).
- The page's composer counts a send as delivered when it was placed, or recorded with any state but could_not; the row
  shows its delivery with pjVerdict (placed: nothing; unconfirmed: "Could not confirm"; anything else: "Could not
  deliver").
- No route takes a kept message out early; no row has a button on a sent message.

## The call
- The route, for a typed message (not automatic, not a menu answer): when chat.limitHeldVerdict holds the agent, or
  the agent still has kept messages (slice 2a's "behind" rule), and the body does not say `anyway: true`, the message
  is kept in engine/limitqueue.js as a `dm` entry (`kind: 'dm'`, the text, the envelope and the trailer the route
  built, `at`), and the row is recorded with delivery `{ state: 'held', heldUntil, because }`. The answer's delivery
  has state `held`, so the composer treats it as recorded (the words are not put back).
- appendLocked keeps `heldUntil` on a held row.
- The minute sweep types a `dm` entry the way the route would (deliverAutomaticAsync with its envelope and trailer)
  and then updates that row in place (chat.updateDmDelivery, the reaction toggle's lock-read-save pattern): its new
  delivery state, or on a drop a day later `could_not` with "Kosmos kept it for a day and could not type it".
- `POST /api/agent/:name/thread/held` with `{ at }`: Send now anyway. Board-token only (a person's action). Takes the
  kept message out, types it now with chat.deliverAsync (no hold), and updates the row. A message no longer kept
  answers 409 (already typed or dropped).
- The page: a held row's pill says "Held: <agent> is out of usage until <time>. Kosmos sends it after the reset." (no
  time when none is known), with a "Send now anyway" button that calls that route and repaints.

## Rejected
- Holding without a way through: the person may need to reach the limit screen itself (answer Claude's limit menu,
  run /usage-credits).
- Putting the words back in the box (as a failed send does): the message is kept, and a second send would be a copy.

## Weakest premise
That a person would rather have their message held than typed into a session that cannot answer. Send now anyway is
the way out when that is wrong.

## Tests
- Route: a typed message to a capped agent is held, kept and recorded held (nothing typed); with `anyway: true` it is
  typed; an automatic message is unchanged; Send now anyway types the kept message and updates the row; a second
  press answers 409.
- Sweep: a kept dm is typed after release and its row reads placed; dropped, its row reads could not deliver.
- Page: a held row shows the held words and the button; pressing it posts the row's `at` (browser check).

## Review 1 (opus)
- FIXED: Send now anyway pressed while the minute sweep was typing the same message typed it twice; a message being
  typed is claimed (limitqueue.isTyping) and the route answers 409 for it (tested).
- FIXED: a held message whose row could not be recorded was kept where the person could not see it (the page then
  put the words back as unsent); it is taken back out and typed now (tested).
- FIXED: a row whose update failed (lock busy) stayed "Held" for a message already typed or dropped; limitqueue.setRow
  keeps the update and the next sweep writes it (tested). A Send now anyway whose typing throws marks the row not
  delivered instead of leaving it held. In memory only: a board restart leaves such a row held (residual).
- FIXED: the "behind" path had no test (now tested); the page reads a structured `behind` flag, not the server's
  wording; queue ids carry a random suffix so two sends in one millisecond stay two.
- CONVENTION taken: the Send now anyway route sits above the thread docblock, not between it and its route.
- Not taken: telling reactions only once across held messages (the route's own rule: telling twice costs one note);
  a retry path when Send now anyway comes back could not deliver (the row says so; the person can send again).
