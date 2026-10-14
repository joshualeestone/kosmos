# roomreadseen-4926: an agent's own room read clears the held posts it was shown (#4926)

Card: joshualeestone/kosmos#4926. New evidence (Josh's 0.7.46 model reports): a Grok seat was delivered a room thread
it had already read and answered. Findings and the call were posted on the card first (comments 6153630071, 6154591261).

## Mechanism (read from origin/main)
A room post sent while a member is busy or idle is HELD for it (engine/roomhold.js) and named on its next idle line.
Only take (that delivery), restore and forgetProject ever clear the held list. Reading the room never did, and R2's
"answered" rule (staleHeld) counts only a reply with replyTo, which 4 of 137 posts on this board carry (Claude agents
0). So a thread read with `kosmos room` and answered in plain words was told again.

## The call
- roomhold.dropShown(name, projectId, shownIds): removes the held ids for that member in that project whose post was
  shown; any other held id stays (held after the read, or older than the rows asked for).
- server.js, GET /api/project/<id>/room?as=text (the text arm `kosmos room` reads): when the reader is an identified
  agent (its own token, resolved by senderFromAgentToken), the post ids in the rows this read returned are dropped from
  ITS held list. Not the JSON arm (the person's page), not HEAD, not a read with no agent token. Best effort: a failure
  leaves them held, the old behaviour.

## Review 1
- The page's JSON-read control sent no token, so it passed whatever the JSON arm did; it now sends the agent's token
  (a mutation that drops on the JSON arm reds it).
- Said in the comment: a failed write and a read during an in-flight delivery both err toward telling again, and the
  drop reaches only agents running with their own token. Review 3: one case errs the other way, a read whose response
  never reaches the agent (a reset, a client timeout) has cleared the reminder unseen; the posts stay in the room.
  Said in the comment too; 'finish' would not fix it.
- The route's older comment ("a write side-effect on a room READ would be a real defect") is about incidental
  registry heals; amended so the two comments do not contradict. Kept the write: per reader, idempotent, only for an
  agent's own token, and tied to the bytes served (a separate "seen" POST would open a read-then-POST gap).
- Not changed: a non-member's read (only possible with the board token too) can call dropShown, which finds nothing,
  since held lists exist only for members and are cleared on removal.

## Rejected
- Counting any later post by the member as "answered": a post about something else would drop an addressed ask it
  never saw.
- Matching text: a guess.

## Proven
- server.roomread-seen-4926.test.js: an agent's own read clears the two posts it was shown (fixture controls: both were
  held, both appear in the read); a read with no token, the page's JSON read, and another room are untouched (control:
  the agent's read does clear); -n 1 keeps the older held post it did not show; another agent's read leaves this
  agent's held posts.
- Mutations: no call reds 3; dropping everything reds the -n test; clearing for any reader reds 2.
- 24 sibling files (room text reads, roomhold, limithold, typingbroke, stale-4926, fixture-discipline): 641 of 641.

## Weakest premise
That the Grok seat read the room through `kosmos room` with its agent token. A Mac agent reading with no token (a pane
caller) is not identified on a GET, so this does not reach it; nor a read through the web page. The seat notes are on
Josh's computer.
