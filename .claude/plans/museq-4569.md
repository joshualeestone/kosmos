# museq-4569: a Muse agent hears "stop" from the person, and room background does not bury them

Card: joshualeestone/kosmos#4569 (claimed:angel), Josh 11:57 and Priya's second write-up: Mark ignored Josh's
"stop" twice because engine/musefront.js ran turns in strict arrival order behind 14 queued room posts.
This PR is the write-up's fixes 1-3, in the Muse front only. Fix 4 (show the queue on the card) is a next slice.

## Finished looks like
- A message from the person to a busy Muse agent runs next, behind only the person's own earlier messages.
- A short stop request from the person ("stop", "you can pause", ...) during a turn ends that turn and drops what
  waits (as Escape / Stop now already does), then runs as the next turn with a note listing what was dropped,
  including the person's own unread messages, so the agent tells them it stopped.
- Background room posts that pile up during a turn run as ONE turn.

## Decisions
- Who a message is from comes from the board's envelope: "[message from your operator" / "[from your operator"
  (engine/messages.js mints these and refuses them inside any agent's text, so they cannot be forged) and
  "[background from your colleague". Everything else keeps arrival order.
- Done in the Muse front, not the server: the front owns the queue, and its Escape stop() is the same
  interrupt #3564's Stop now sends a Muse pane. A server-side stop detector for every runner is a wider change
  (Claude and Codex queue input in their own programs) and is left to #4580.
- Stop words are an exact short list, not a pattern: "stop posting duplicates and fix X" is an instruction to
  carry out. A stop with nothing running is an ordinary message.
- Rejected: skipping background posts for Muse entirely (the agent would miss room context it may need);
  a digest keeps them, in one turn.

## Weakest premise
That the stop request reaches the front as its own typed message while a turn runs. It does today (chat.js
types each message and presses Enter); a room post with a quote before the words is not recognised as a stop.

## Tests (engine/musefront.test.js)
Priority order (control: colleague order kept); stop ends the turn and names what it dropped; a long
instruction, a colleague's "stop", and an idle stop are not stops (control: "you can pause" mid-turn is);
background digest (control: a single background post runs as itself).
