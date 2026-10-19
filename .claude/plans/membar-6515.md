# membar-6515: hide the empty dotted track beside an unknown memory on the Agents list

Card: #6515 (from Mona Lisa's review of #6511).

## Plan
1. One CSS rule scoped to the list cell: `.lmem .bar.unknown { visibility: hidden; }`. The dash (#6511) says the memory is unknown, so the track is a second mark. Hidden, not removed: the column keeps its width, and the `bar unknown` markup that server.test.js's "never a guessed bar" guards read is unchanged.
2. The agent page's memory box draws the same track and keeps it.
3. web.membar-6515.test.js: the rule is present (red on main); no hide rule reaches beyond .lmem (mutation-checked); memoryBox is not inside .lmem.
4. render-projects reads the unknown track for its theme-flip probe: run it sandboxed.
5. Merge main after #6511 lands so the shots show the dash. Shots for Mona, blind review to convergence, validation, proof, PR.
