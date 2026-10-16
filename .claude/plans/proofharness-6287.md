# proofharness-6287: keep the two proof harnesses' shared helpers identical (kosmos#6287)

Taken by Angel on night shift on 2026-10-16 (claimed 02:51 CDT), once `familye2e-6239` merged as #6293.

**Finished looks like:** a fix to a shared helper in `tools/fed-own-e2e.js` or `tools/family-e2e-6239.js` cannot land in one file without the other. CI fails until the two copies match.

## Measured
I compared the two files' top-level helpers on main.
- **Identical code (23):** chk, info, sleep, waitFor, fedproofPortFreeOn, fedproofPortFree, start, fedproofReadLog, stripAnsi, serviceEnv, psTable, descendantsOf, alive, stopPids, isLive, ownedDescendants, ownedAlive (the orphan sweep, which differs only by a comment), fedproofCleanup, http, devCodes, nextCode, boardSignin, fedproofFinish.
- **The module state they use, also identical:** `stopping`, `started`, `taken`, `cleaned`, `cleanedDone`, `finishing`, `halted`, `results`, `T0`, `KEEP`, `LOGS`, `coord`, the `process.on('exit')` last-resort SIGTERM, and `SCREEN`.
- **Differ on purpose, NOT guarded:**
  - freePort (27000 vs 28000), boardEnv, startBoard and main;
  - BIN_DIR and BIN (fed-own falls back to a default, family exits without one) and SANDBOX (its temp prefix);
  - the uncaughtException, unhandledRejection and signal handlers (family labels each failure for its step table).

  Identical code is therefore not identical behaviour: `ownedAlive`'s orphan sweep matches command lines against each harness's own BIN and SANDBOX.

## The call: a guard, not an extraction
`tools.fedproof-helpers-in-sync-6287.test.js` cuts each shared helper and each shared state statement from both files and asserts their CODE is identical. Lines that are only a `//` comment are left out, so one copy may explain more. Each must be found exactly once in BOTH files, and no cut may run past 40 lines, so a rename, a removal or a wrong cut fails rather than shrinking what is compared. A control checks the extractor sees a one-character change, a changed exit handler, and an ignored comment. Each harness carries a one-line comment pointing at the guard.

**Rejected: extracting `tools/lib/fedproof-harness.js`, the card's proposal.**
- The helpers close over each harness's module state: `results`, `halted`, the process table, the sandbox, `RUN` and `KEEP`. Sharing them needs a factory that both proofs are rebuilt around.
- The card itself requires re-running both proofs against freshly built relay binaries. That means cargo builds on Mortals for each, plus the review loop such a change draws.
- For two files, a guard closes the actual risk (a fix reaching one copy only) with no behaviour change and nothing to re-prove.

**Weakest premise** (the card's own): only two harnesses of this shape. A third would tip the balance to extraction, and the guard's name list is then the starting point.

**What would change it:** a third harness copying these helpers, or a helper fix that needs to differ between the two. If one must differ, move it out of `SHARED`, with a reason.

## Evidence
- The guard passes on main's files.
- One-character code mutants in one copy turn it red with the named message: `stopPids`, `ownedAlive`, and the exit handler.
- Every cut has a sensible length (1 to 20 lines), ENFORCED by the 40-line cap.
- The harnesses change only by a comment, so no proof re-run is owed.

## Review notes
- **Review 1 (sonnet).** Two warnings, both fixed:
  - `ownedAlive`, the orphan sweep, differs only by a comment, so it is now guarded (comment-only lines are left out of the comparison);
  - the shared module state (`stopping`, `started`, `taken`, `cleaned`, `cleanedDone`, the exit handler, `SCREEN`) is now guarded too.
  - Nits taken: a 40-line cap on every cut (the old ">= 1" assert was always true); a time from `date`.
- **Review 2 (opus).** Four warnings, all fixed:
  - seven more one-line state statements are guarded (`finishing`, `KEEP`, `LOGS`, `T0`, `results`, `halted`, `coord`);
  - the inputs that differ on purpose are named in the test and this plan (BIN, BIN_DIR, SANDBOX, the error and signal handlers);
  - the decision is now on the card (the test pointed at it while the card said the opposite);
  - the cut-length range is corrected.
  - Nits taken: the harness comment says "whole-line `//` comments may differ"; notes on `code()` and the `statements()` terminator.
