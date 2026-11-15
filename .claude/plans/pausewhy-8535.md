# pausewhy-8535: a post the room's wake pause kept quiet says why, who set it, and what still gets through (kosmos#8535)

## Why
From an agent's daily feedback (filed by Splinter): when a post comes back "it woke no one" because the project's wake
pause is on, the reply gives only a resume time. From inside a session an agent cannot tell whether to wait, address
one member directly (kosmos#7461 lets that through), or escalate.

## What
- `engine/roomloop.js` `senderNote(projectId, now, ctx)`: the same opening as before (a test pins it), then, in one line:
  the reason (agents' posts woke one another LOOP_CAP times in the last hour), the source (an automatic limit, not a
  person; a person's post ends it), and the one action that still gets through. That last part depends on the post:
  - it asked several members, or none: "address exactly one member: that still gets through";
  - it asked one member whose pair allowance is spent (PAIR_CAP): it names the member and says another member still works;
  - the project's one-member allowance is spent (THROUGH_CAP): it says so.
- `engine/messages.js`: the one caller passes the sender, how many members were asked, and the one asked.

## Decided
- The source is always the automatic cap: it is the only pause roomloop makes. A person pausing a whole project is a
  different path (`kosmos project pause`), not this reply.
- Kept the old opening exactly, so the board's and the CLI's existing readers and tests still match.

## Weakest premise
That one line is short enough to be read. It is about 300 characters; the card asked for one line.
