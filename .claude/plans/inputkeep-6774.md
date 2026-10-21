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
  and moved it to the back). The page empties the box for it and words the row as not sent, not as a failure.
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
- Review 12: `kosmos msg`'s fold into a copy kept for the box follows the same rule: only while the two have not spoken
  since (#4580's quietSince), on both fold paths; a limit or sign-in copy keeps folding at any age (that recipient
  cannot answer). The box 409 on Send now anyway names what a signed-out row or a row kept behind still waits for.
- Review 11: the box 409 on Send now anyway names what a usage-limit entry waits for (the reset as well). Rejected,
  with the reason: a sweep typing a just-kept message before its row is written. Between limitqueue.add and the row
  write the route runs no await, and the sweep is a timer callback, which cannot run inside synchronous code.
- Review 10: the fold is narrowed to its root rule: only while nothing at all was said in the thread since the kept
  copy, by either side, apart from earlier re-sends of it (so "yes", "no", "yes" keeps all three). The re-send's row
  is worded as not sent (pjVerdict), not "Could not deliver", on every reload. Left as it is: the same words sent twice
  at once, where the box clears between the first's refusal and the second's typing, can arrive twice (the second is
  typed directly, the first by the sweep); it needs the box to clear inside one delivery, as the order window above.
- Review 9: a person's re-send folds only while the agent has not spoken since the kept copy (as `kosmos msg`'s fold,
  #4580); after a reply the same words are a new message, kept behind the first, so a repeated answer is not lost.
  Left as they are: a CLI installed before this branch words a box hold as a usage hold (still "do not re-send");
  a person's message kept behind an entry already typed but not yet removed waits one more minute.
- Review 8: Send now anyway refused because the box still holds text answers 409 with `inputHeld`, and the page says
  that sentence under the box instead of repainting as if it had gone (a row kept for a usage limit still offers the
  button). The stored row's `behindFor` is now asserted, so a reload cannot regress to the usage-limit words unseen.
  The re-send sentence names the agent. Left as it is: a sweep that types a just-kept message in the instant before
  its row write fails is answered with the original refusal (three coincidences; the limit path has the same shape).
- Review 7: a kept message whose row cannot be written is taken back with limitqueue.settle (removed, or remembered as
  done when the file cannot be written), so it is never typed behind the person's "not sent". Reasoned, not tested: a
  failed queue write cannot be staged from outside the module. Left as they are: the sweep's log line says "after its
  usage reset" for every kept message (a log line, not shown to anyone); a re-send whose own row cannot be written
  gets the plain could-not wording (the kept copy still goes once).
- Review 6: a re-send answered as the kept copy is worded with its own sentence ("The same message was already kept
  above, ...") on the page and empties the box (it was
  worded "could not get that to", which invited pressing again); its row keeps `duplicateOf`. The same words sent twice
  at once are matched again when the second is kept, so they are kept once. Left as it is, and said here: a box that
  nothing clears (a pasted-text chip or a tall draft, which #6728's sweep leaves alone on purpose) keeps its messages
  for the day and then drops them with the sender told; before this branch the sender learned at once. The receipt
  says the message waits for the box, so a sender who needs it sooner can go to the person.
- Review 4: a task line (`kosmos task message`) kept behind messages kept for the box gets the same flag and the true
  reason (before this branch that queue never held such messages, so its "out of usage" words were true). A re-send
  matches on the text as typed (spacing does not count). The not-sent row's sentence is time-neutral, so it stays true
  after the kept copy goes. The page's words and the hidden button are covered by web.inputkeep-6774.test.js, and the
  branch carries a Browser-check trailer (wording plus one button condition, covered there). Left as they are: a person's messages
  share one sender cap, so past it a message after the box clears is typed ahead of the backlog (the existing
  fall-through); a box holding only the board's own unsent line holds the queue until its retries clear it (minutes).
- Review 3: a message kept behind a backlog any of which was kept for the box is flagged, released by the box rule,
  matched as a re-send and told that reason: one rule ("any"), so the flag and the words never disagree. Left as it
  is: the same plain words sent on purpose while the first copy still waits are folded into it (they cannot be told
  from an accidental re-send, which is the card's ask; the person sees why on the new row).
- Review 2: a kept message whose row cannot be written is taken back out (the refusal stands), as the limit path does;
  a re-send is folded only into a plain kept copy (no attachment, not a reply) that has not been typed already.
- A mixed queue waits for both: not limited AND the box empty.
- A task message (`kosmos task message`) refused by a stuck box with nothing kept is still refused, as before: the
  card names direct messages and `kosmos msg`. Only a task line arriving behind messages already kept is kept (it
  always was) and now carries the box flag and words (review 4). A person's message in a project thread is not kept
  either (it is not a direct message).
- The drop after a day keeps its existing notice ("kept it for a day and could not type it"), true for both reasons.

## Weakest premise

That `inputHeld` on a refusal means only "the box holds text": it is set at one place (engine/chat.js, the
NOT_OURS refusal). A later refusal that sets it for another reason would be kept and retried when the box empties,
which is still the safe direction (nothing is typed until the box reads empty).
