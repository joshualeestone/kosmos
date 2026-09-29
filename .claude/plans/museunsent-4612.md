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

## Known limit
If more messages wait when the turn ends, the front does not report idle, so that turn's answer is not carried (the
next turn's is, if it is the last).

## Weakest premise
That "the latest report is idle and its turn began after the message" means that turn answered it. A turn that began
after the message but was about something else (a room post that ran first) would show its answer here. The person's
messages run first (#4604), which makes that rare.

## Tests
engine/musefront.test.js (answer on idle, control failed turn; reporter payload; bridge Stop only, agy unchanged),
engine/selfreport.waiting-4569.test.js (kept, cleaned, capped; working / blank / bad time / none not kept),
server.dm-owes-4340.test.js (shown only for a later turn; not while working; not once replied; control no report),
web.dm-unsent-4612.test.js (line and escaped text at once; control: the old line and grace unchanged).
