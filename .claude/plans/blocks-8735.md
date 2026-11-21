# blocks-8735: slice 6 of #8735, the generated blocks

Proposals: issuecomment-7051310861. Mona Lisa's read: the comment after it (21:43Z).

## Built
- K1, trimmed further than her change-to: only the eleven-minutes anecdote leaves the colleagues block. "Can you
  check X?" stays as the picture of the failure; answering-once-8735.test.js now pins that line instead.

## Decided against, measured against the pins
- K1's "reaches nobody" paragraph (her change-to): messages.test.js (#122/#145) pins it as the whole defect, and
  answering-once-8735.test.js says the colleagues block must state how to answer on its own (not every agent has
  the working rules). Kept.
- K2: nearly every word of the bracket-line warning is pinned (messages.test.js, #145 and #4631); the cut left ~70.
- C1, C2: SAFETY and IDENTIFYING are Josh's words (#3485, #4349), each pinned as its own line; UNTRUSTED_RULE is
  the only line naming comments and the three things an injection asks for (#5211). None is a pure restatement.
- F1: the top line exists to reach agents whose plain-text rules Kosmos may not rewrite (#4420). Skipping it for
  agents with managed rules is possible but a behaviour change for a 431-character saving; not in this slice.
- F2: the two paragraphs are Josh's rulings (#3759) and differ in their endings; a merge saved ~60.

## Numbers
pm 45,054 (main) -> 44,928 when branched; on main after #8853 (43,474) it is 43,348, ratchet 43,500 -> 43,400. No doctrine change (the colleagues block is re-rendered).

Weakest premise: that "Can you check X?" alone carries what the anecdote did. What would change it: an agent
again answering a question-shaped room message in its own session.

## Round 1 (opus, blind): one should-fix (size-test history line) and one nit (messages.test.js note), both taken. Round 2 (sonnet, whole branch, blind): nothing above nit. Converged.
