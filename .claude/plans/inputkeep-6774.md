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
  and its row reads held with the reason. Re-sent by hand with the same text while the first is kept, the earlier
  copy is taken out of the queue and its row says it was not sent because it was sent again; only the new one goes.
- Once anything is kept, later messages go behind it (the existing order rule), and the sentence for that names the
  real reason when the backlog was kept for the box.
- Released only when the box is read empty: an unreadable box keeps them waiting, as #6256 does for room posts.

## Decided

- One queue, not a second one: order across "out of usage" and "box stuck" is then one order, and every guard the
  queue has (per-run cap, claims, caps per sender, the day's drop with the sender told) applies unchanged.
- A mixed queue waits for both: not limited AND the box empty.
- Task messages (`kosmos task message`) are not changed here: the card names direct messages and `kosmos msg`.
- The drop after a day keeps its existing notice ("kept it for a day and could not type it"), true for both reasons.

## Weakest premise

That `inputHeld` on a refusal means only "the box holds text": it is set at one place (engine/chat.js, the
NOT_OURS refusal). A later refusal that sets it for another reason would be kept and retried when the box empties,
which is still the safe direction (nothing is typed until the box reads empty).
