# museunsent-4612: when a Muse agent answers only in its own window, the DM says so and shows the answer

Card: joshualeestone/kosmos#4612 (split from #4569). Stacked on museqcard-4569 (#4611), which added the report
fields this reuses.

## Finished looks like
The person DMs a Muse agent; the agent's turn finishes with an answer but the agent never runs `kosmos reply`.
Instead of "Nothing back yet" (after two minutes), the DM shows at once: "It finished without replying here. What it
said in its own window:" and the answer, in a bounded, line-preserving block. Once the agent replies here, or starts
another turn, the block goes.

## Decisions
- Carried like #4611's count: musefront sends the turn's answer and start time with its idle report
  (`kosmosFinal` -> bridge -> `final` on POST /api/report -> selfreport keeps it on an idle report only, cleaned and
  capped at 4000 characters). The thread route attaches it as `owes.unsent` only when the thread owes a reply, the
  latest report is that idle one, and the turn began at or after the owed message arrived.
- Shown at once, without the two-minute grace: the turn is over, so there is nothing left to wait for.
- The answer is shown, not only "it did not reply": it is what the person asked for, and what the Muse front already
  prints in the agent's window. Escaped, never HTML.
- Muse only for now (the Muse front is the only reporter of `final`). Claude's Stop hook could do the same later.
- Wording is first-cut, for Mona to change.

- Review round 1 (BLOCKER fixed): the answer carried is the one to the person's latest DIRECT message (the
  "to answer, run: kosmos reply" envelope, alone or inside a stop note), kept across the room turns that run after it
  until the next idle report. Before, it was the last turn's answer, usually a room post the DM went ahead of, which
  could put a colleague's room text under the person's DM.

## Weakest premise
That the DM envelope marks the turn that answered the person. A DM whose turn failed or had no words clears it, so
an older answer is never shown for a newer message (the route also requires the turn to begin after the message).

## Tests
engine/musefront.test.js (answer on idle, control failed turn; reporter payload; bridge Stop only, agy unchanged),
engine/selfreport.waiting-4569.test.js (kept, cleaned, capped; working / blank / bad time / none not kept),
server.dm-owes-4340.test.js (shown only for a later turn; not while working; not once replied; control no report),
web.dm-unsent-4612.test.js (line and escaped text at once; control: the old line and grace unchanged).
