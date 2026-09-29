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

- A whole-room post from the person ("[from your operator in project ... for the whole room]") counts as the
  person's too: a room-wide "stop" stops every busy Muse member. Claude and Codex agents only weigh such a post;
  for Muse it is mechanical on purpose (Josh's report is that a stop was not heard).
- Review round 1: the stop test reads the person's own words, without a reply's '(answering: "...")' in front or
  the reactions / catch-up notes after; a second stop leaves the first stop's note alone (its list of what was
  dropped survives); a digest carries at most 40 posts, the newest, and says how many it left out.

- Review rounds 2-4: a digest also stops adding posts past 32 KB (a single longer post still goes whole); a
  second stop keeps the first stop's note and, when it drops messages from the person, names them in a short
  "asked you to stop again" note (identical notes are queued once); "hold" is not a stop word (it can answer
  "hold or ship?"); Escape clears waiting stop notes (housekeeping no test can observe).
- Review round 5: a stop kills the running Muse process and its note starts at once, while Muse may still hold
  the session; a stop note answered "still working on this agent's last turn" (muserun.BUSY, now exported) is
  tried again up to 4 times, 500 ms apart. A second stop also counts a colleague's addressed message it drops.
- Review round 6: Escape during a busy retry's wait cancels the note (it is not run after all, and the pane says
  Stopped); the stop handle is cleared as each attempt returns, so nothing reads as running during the wait. A test
  pins musefront's spellings of muserun.BUSY and STOPPED.
- Known and accepted (round 3 NIT): a project name containing "]" makes a room-wide stop read as an ordinary
  message; it still goes first.

## Weakest premise
That Muse frees a killed turn's session within about two seconds (the busy retries); measured only against a fake
runTurn, as Muse is on no Mac this was built on. Also that the stop request reaches the front as its own typed
message while a turn runs. It does today (chat.js
types each message and presses Enter). Framing Kosmos adds that this code does not know about would make a stop
read as an ordinary message (it still goes first, so the agent sees it after its current turn).

## Tests (engine/musefront.test.js)
Priority order (control: colleague order kept); stop ends the turn and names what it dropped; a long
instruction, a colleague's "stop", and an idle stop are not stops (control: "you can pause" mid-turn is);
background digest (control: a single background post runs as itself). Rounds 1-4: stops with a reply quote or
reaction / catch-up notes around them (control: a quoted "stop" in a reply is not one); a second stop keeps the
first note; digest caps at 40 posts and 32 KB; Escape drops a waiting stop note and a later stop gets its own;
messages between two stops are named (control: none in between adds no note; "hold" is not a stop); an identical
second note waits once and stays ahead of the person's next message. Rounds 5-7: a stop note refused as busy
is retried and runs (control: an ordinary busy message is not retried); a second stop counts a colleague's dropped
message; Escape during a retry's wait cancels the note; a stop typed in that wait gets a fresh note that does not
claim a turn was ended.
