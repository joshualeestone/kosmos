# memdash-6511: a dash, not "Unknown", for an unknown memory on the Agents list

Card: #6511 (Mona Lisa's 0.7.56 noise pass, item 1).

## Plan
1. In lrow (web/index.html), the unknown-memory cell's visible, aria-hidden half becomes a dash. The .vh sentence (memUnknown's aria) stays. The agent page keeps the word.
2. Rewrite the comments above the cell, which recorded "the word, not a glyph" (Mona Lisa's earlier ruling, which she reversed on #6511).
3. Test: web.memory-words.test.js slices lrow and asserts the sentence, then the dash. It must fail on main.
4. Shots for Mona (agents-list), blind review to convergence, validation, proof, PR.

## Not in scope
Hiding the dotted track beside the dash: that is #6515, on its own branch.
