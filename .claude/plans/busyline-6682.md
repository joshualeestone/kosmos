# busyline-6682: "Kosmos is busy, retrying" only when the board really was slow (kosmos#6682)

**Card.** Agent feedback, 10-13: the CLI prints "Kosmos is busy, retrying..." on most commands before they succeed, so
the agent reads steady contention. Ask: find whether the board is really slow or the probe budget too tight; if it is
a quick retry that succeeds, do not print on the first retry. Done means: on an ordinary loaded board a typical command
does not print the line, and when it prints, the board really was slow. Splinter gave it to me 05:12.

**What the code says.** install/kosmos `healthy()` probes with a 2 s budget, then 4, 8, 8... within 20 s. The first
busy reading printed the line, so any board answering in 2 to 4 s (a moment of load) printed it, then the retry
succeeded at once. That matches the report: a threshold that trips too early, not necessarily a slow board.

**The call.** Say the line from the SECOND busy reading on: two probes in a row with no answer (about 6 s) is a board that
really is slow. Probe budgets unchanged (they decide what counts as busy for start/status, and #4466 tuned them).
Rejected: a longer first probe (it would slow the honest "not running" answer and the hook's 15 s budget).
The card's ask 1 (is that install genuinely slow?) cannot be measured from here; noted on the card.
Windows: tools/windows/kosmos-cli.js has no such line, so no parity change.

**Done when.** A single slow answer that the retry catches prints nothing; two misses still print the line.

## Change
- install/kosmos healthy(): a `_busy` count; the line is said when it reaches 2.

## Tests (cli.busy-health-4466.test.js, whole file 54/54)
- The 2.5 s single-miss arm (an --auto report end to end) now asserts the line is NOT said; the 5 s slow-board status
  arm (two misses) still asserts it IS (CONTROL).
- Mutation: the threshold back to 1 reds the single-miss arm.

**Weakest premise.** That a second miss is the right line between a moment and a slow board. A board that answers in
just over 6 s every time now says busy on each command, which is honest.
