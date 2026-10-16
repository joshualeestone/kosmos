# proofharness-6287: keep the two proof harnesses' shared helpers identical (kosmos#6287)

Taken by Angel on night shift at 02:5x CDT on 2026-10-16, once `familye2e-6239` merged as #6293.

**Finished looks like:** a fix to a shared helper in `tools/fed-own-e2e.js` or `tools/family-e2e-6239.js` cannot land in one file without the other. CI fails until the two copies match.

## Measured
I compared the two files' top-level helpers on main.
- **Byte-identical (22):** chk, info, sleep, waitFor, fedproofPortFreeOn, fedproofPortFree, start, fedproofReadLog, stripAnsi, serviceEnv, psTable, descendantsOf, alive, stopPids, isLive, ownedDescendants, fedproofCleanup, http, devCodes, nextCode, boardSignin, fedproofFinish.
- **Differ on purpose (each harness's own boards and ports):** freePort, ownedAlive, boardEnv, startBoard, main.

## The call: a guard, not an extraction
`tools.fedproof-helpers-in-sync-6287.test.js` cuts each shared helper from both files and asserts they are identical. Each name must be defined exactly once in BOTH files, so a rename or a removal fails rather than shrinking what is compared. A control checks that the extractor sees a one-character change. Each harness carries a one-line comment pointing at the guard.

**Rejected: extracting `tools/lib/fedproof-harness.js`, the card's proposal.**
- The helpers close over each harness's module state: `results`, `halted`, the process table, the sandbox, `RUN` and `KEEP`. Sharing them needs a factory that both proofs are rebuilt around.
- The card itself requires re-running both proofs against freshly built relay binaries. That means cargo builds on Mortals for each, plus the review loop such a change draws.
- For two files, a guard closes the actual risk (a fix reaching one copy only) with no behaviour change and nothing to re-prove.

**Weakest premise** (the card's own): only two harnesses of this shape. A third would tip the balance to extraction, and the guard's name list is then the starting point.

**What would change it:** a third harness copying these helpers, or a helper fix that needs to differ between the two. If one must differ, move it out of `SHARED`, with a reason.

## Evidence
- The guard passes on main's files.
- Changing one character in `stopPids` in one copy turns it red with the named message.
- Every cut has a sensible length (1 to 17 lines; none ran to the end of the file).
- The harnesses change only by a comment, so no proof re-run is owed.
