# heldnudge-6593: an agent told of posts it already answered is told it need do nothing (kosmos#6593 item 3)

**Card.** #6593 (Josh's five-model reports, 0.7.59 and 0.7.60), item 3, "N7": answered room posts are delivered again to
long-lived sessions (Meta, Grok); fresh sessions do not see it. Part 2 of my split of #6593 (Splinter 00:27: "make the
calls yourself"). Part 1 is handoffage-6593 (the handoff self-report age).

**What the code says (read-only investigation, scratchpad 6593-findings.md).** Nothing types a post twice. A held post
comes back as one line naming its id (roomhold.clauseFor, via flushOnIdle). It counts as answered only when the agent
replied with --in-reply-to or read the room first (messages.staleHeld, roomhold.dropShown). Two causes fit the report:
(A) the agent answered without citing the post, so the board told it again; (B) the long-lived session acted on the post
again from its own history (Muse resumes one session; Grok runs one long one). The run's board log decides between them
(a "room-hold: ... told of ..." line before the repeat means A), and that log is not on this machine.

**The call.** Ship the one change that helps under both causes now: the addressed held-post line ends "If you already
answered them, nothing more is needed." Defer the board-side change for (A) (count an uncited post made after reading
the room as answering the held one) until the next five-model run's board log shows A, because it changes what counts as
answered for every agent and could drop a real reminder.

**Done when.** The addressed line ends with that sentence; the neutral (nothing asked) line is unchanged.

## Change
- engine/roomhold.js clauseFor, addressed branch only: the sentence appended before the closing bracket.

## Tests (engine/roomhold-agyhold-4588.test.js)
- The addressed line ends with the sentence; CONTROL: the neutral line has no such sentence (its byte-exact test above
  still passes). Whole room-hold and messages room-hold test files run: 28, 2, 5, 12, 14 and 21 pass.

**Weakest premise.** That a sentence in the reminder changes the model's behaviour. If the next run still shows repeats
with a "told of" line before them, cause A is confirmed and the board-side change is the fix.
