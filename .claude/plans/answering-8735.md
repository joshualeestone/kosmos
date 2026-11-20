# answering-8735: #8735 slice 3, item 1 (the three answering sections)

## Call
How to answer is stated once, in the colleagues block (engine/messages.js "Talking to your colleagues > Answering").
The working rules (engine/defaults.js) keep the room rule, the two send verbs, the stdin pointer, reactions and the
claim protocol, and point to the colleagues block for the rest. "Answering the person who messaged you" loses its two
repeats, one of which said the command sits at the FRONT of the bracket (it is at the end).

## Rejected
- The card's design table put the one home in the working rules. Rejected: the colleagues block is re-spliced into
  every existing agent (tellAgent), while the working rules are written once at creation. Moving the rules out of the
  colleagues block would remove them from every running agent whose working rules predate them.
- Moving the claim protocol to a `kosmos claim --how` guide in this slice: a new guide and CLI verb in both CLIs plus
  moved-lines handling; it is its own slice.

## Measured
- pm brief 47,070 (approx, main) -> 46,686 (darwin). Ratchet 47,600 -> 46,700.
- 52 test files that read defaults/messages/doctrine/instructionreread: 1,618 pass, 0 fail.
- New engine/answering-once-8735.test.js perturbed both arms (colleagues story removed: 1 fail; "at the front" back in
  the working rules: 3 fail, one per platform).

## Weakest premise
That one statement of "answer by command" holds as well as three did. The repeats were added after real misses.

## Not handled
A running agent's re-read notice will show the removed working-rules lines as no longer applying; the rules they carried
are still in the colleagues block in the same file, so the notice is accurate, not misleading. No moved-lines entry.
