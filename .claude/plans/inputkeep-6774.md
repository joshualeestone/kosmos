# inputkeep-6774: messages refused while an agent's input box was stuck are sent once it clears

Card: kosmos#6774 (item 2 of #6717's confirmed cause). Owner: PigeonPete.

## What it does

While a Claude Code agent's input box holds text Kosmos cannot vouch for, a delivery is refused before anything is
typed (#6249, `inputHeld`). Today a refused `kosmos msg` or a person's direct message is not sent again on its own.

Now both are KEPT in the agent's existing queue (engine/limitqueue.js, #5805), marked `input: true`, and the board's
minute sweep types them in order, once each, when the box reads empty (`chat.inputBoxEmpty`, the #6256 rule) and the
agent is not held for a limit. They go through the automatic gate like any kept message.

- `kosmos msg` (engine/messages.js sendWithDelivery): a delivery refused with `inputHeld` is kept, logged held, and the
  sender gets a held receipt that says why. A re-send of the same text is answered as the kept copy (the existing
  send key, `keptByKey`), so it is not typed twice.
- A person's own message (server.js, the direct-message route): refused with `inputHeld`, it is kept as `kind: 'dm'`
  and its row reads held with the reason. Re-sent by hand with the same text while a copy is kept (for the box, or
  behind messages kept for it), the new copy is recorded as not sent, saying the kept one goes once the box is clear;
  the kept copy stays in its place (review 1: taking it out first could lose the words if the re-send then failed,
  and moved it to the back). Its words going back into the box is the page's rule for any copy not sent.
- A message kept behind messages kept for the box carries the same flag, so it waits for the box too, is matched
  as a re-send, and later messages are told the true reason.
- Send now anyway is not offered on a row kept for the box (it would be refused by the same box); if pressed
  anyway (an old page), a refusal for the box keeps the message and its row held.
- Once anything is kept, later messages go behind it (the existing order rule), and the sentence for that names the
  real reason when the backlog was kept for the box.
- Released only when the box is read empty: an unreadable box keeps them waiting, as #6256 does for room posts.

## Decided

- One queue, not a second one: order across "out of usage" and "box stuck" is then one order, and every guard the
  queue has (per-run cap, claims, caps per sender, the day's drop with the sender told) applies unchanged. One order
  across a person's messages and `kosmos msg` holds where both name the agent the same way: the route files under the
  URL's name, `kosmos msg` under the card's session name (both since #5805, unchanged here).
- Review 2, left as it is: two messages sent within the same moment to a stuck box both see an empty queue; if the
  box clears between the first being refused (and kept) and the second being typed, the second arrives first. Closing
  it needs the queue check inside the pane's delivery lock; the window is the length of one refused delivery.
- Review 3: a message kept behind a backlog any of which was kept for the box is flagged, released by the box rule,
  matched as a re-send and told that reason: one rule ("any"), so the flag and the words never disagree. Left as it
  is: the same plain words sent on purpose while the first copy still waits are folded into it (they cannot be told
  from an accidental re-send, which is the card's ask; the person sees why on the new row).
- Review 2: a kept message whose row cannot be written is taken back out (the refusal stands), as the limit path does;
  a re-send is folded only into a plain kept copy (no attachment, not a reply) that has not been typed already.
- A mixed queue waits for both: not limited AND the box empty.
- Task messages (`kosmos task message`) are not changed here: the card names direct messages and `kosmos msg`.
- The drop after a day keeps its existing notice ("kept it for a day and could not type it"), true for both reasons.

## Weakest premise

That `inputHeld` on a refusal means only "the box holds text": it is set at one place (engine/chat.js, the
NOT_OURS refusal). A later refusal that sets it for another reason would be kept and retried when the box empties,
which is still the safe direction (nothing is typed until the box reads empty).
