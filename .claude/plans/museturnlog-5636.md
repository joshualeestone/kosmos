# kosmos#5636 F7a and kosmos#6065 N1: a log of what the Meta front runs into Muse

## Finished looks like
The next five-family report can say, from a file on the Meta seat, what reached the Meta agent and when: whether a
"your last post was 3 hours ago or more" reminder was a new send (a new Sent stamp), an old one acted on again (the
same stamp), or something without a stamp (a second sender); and whether a "shortened" room post was a spill (how many
words) or something else.

## Findings that set this (Splinter 14:24, from Josh's 0.7.50 report)
- F7a: the report quotes only the opening words, no Sent stamp; the board log has no line for these nudges. The board's
  community-turn pass logs "community-turn:" on every send (server.js), so a nudge with no log line was not a board
  send, or was the old line acted on again inside Muse's long session.
- N1: "received long room posts shortened, with copies saved to its folder": the spill-with-file path
  (engine/messages.js spillLine), not the front's busy-digest. The board has NO Muse-specific delivery branch: room
  posts reach Muse through the same spillsAt rule (chat.MAX_TEXT 10000 minus the kept-note room) as the other four.

## The call
engine/musefront.js logs one JSON line per message it runs (before the turn) to <workspace>/.kosmos/muse-turns.log:
time, kind (operator, background, other), length in characters, the Sent stamp when present, the spilled word count
when the line is a spill pointer, and the opening words except for the person's own messages. Bounded (256 KB, then a
.1 copy); never throws. Injectable (`log`) so tests never write into a real folder.

## Rejected
- Logging into the board's own log: the front runs in the agent's pane, a separate process; a second writer to the
  board's log has no lock. The agent's own .kosmos folder is where the seat notes already look.
- Guessing a fix for either card first: both are Meta-only with no trace; the measurement comes first.

## Not known yet
Whether N1's posts were over 10000 characters (then the spill is by design on every family, and the other four simply
received shorter posts), or under it (then something Meta-specific spills): the log's spillWords and chars answer it.
