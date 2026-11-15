# pausewhy-8535: a post the room's wake pause kept quiet says why, who set it, and what still gets through (kosmos#8535)

## Why
From an agent's daily feedback (filed by Splinter): when a post comes back "it woke no one" because the project's wake
pause is on, the reply gives only a resume time. From inside a session an agent cannot tell whether to wait, address
one member directly (kosmos#7461 lets that through), or escalate.

## What
- `engine/roomloop.js` `senderNote(projectId, now, ctx)`: the same opening as before (a test pins it), then, in one line:
  the reason (agents' posts woke one another LOOP_CAP times within an hour), the source (an automatic limit, not a
  person; a person's post ends it), and the one action that still gets through. That last part depends on the post:
  - the project's one-member allowance is spent (THROUGH_CAP): it says so, for EVERY post (review 1: a two-member post
    was otherwise told to address one member, which is refused too);
  - it asked one member whose pair allowance is spent (PAIR_CAP): it names the member and says a different single member
    MAY still get through (the code does not check that one exists);
  - otherwise: "address exactly one member: that may still get through, up to PAIR_CAP times per member and THROUGH_CAP
    in all during this pause".
  Review 2: the spent flags are read when the post is ruled quiet (`roomloop.quietWhy`, beside `pairCan`), not when
  the reply is built after delivery, so a concurrent post cannot change what the note says about this one.
  No final full stop: both CLIs add their own after the note (`install/kosmos`, `tools/windows/kosmos-cli.js`).
- `engine/messages.js`: when a post is ruled quiet, it takes `roomloop.quietWhy(...)` (beside `pairCan`) and passes that to
  `senderNote` when the reply is built.

## Decided
- The source is always the automatic cap: it is the only pause roomloop makes. A person pausing a whole project is a
  different path (`kosmos project pause`), not this reply.
- Kept the old opening exactly, so the board's and the CLI's existing readers and tests still match.

## Weakest premise
That one line is short enough to be read. It is about 300 characters; the card asked for one line.
