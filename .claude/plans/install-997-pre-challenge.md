---
pre_challenge: true
method: challenge-loop
branch: install-997
diff_hash: 53ddac1013d6d956de7eb326bfd5807be226822b3c2a5c778798021f5babae07
validation: passed
subdir_audit: passed
timestamp: 2026-08-30T07:15:04Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes. Iteration 7 returned no BLOCKER and no NEW actionable
finding: its single WARNING deduplicated against a DEFERRED ledger entry
(kosmos#1569), and that reviewer independently verified the pre-existing
classification by reproducing the mutation on a clean `main` checkout.
**Fixed:** 27 | **Deferred (carded):** 2 | **Documented as unpinnable:** 2

**Completion criterion, agreed in advance and stated so someone else could
check it:** a blind round returning no BLOCKER and no WARNING that a mutation
can demonstrate, with a clean full suite and the mutation set still red. NITs
were fixed in-round and did not buy another round.

### Per-Iteration Breakdown

#### Iteration 1
**New:** 4 WARNINGs, 1 CONVENTION, 2 NITs
- [WARNING] connect.js - header documented two return shapes; there are three --> FIXED
- [WARNING] connect.js - hook list omitted `wantsProgress`, listed a non-hook --> FIXED
- [WARNING] connect.js - no hook validation; a TypeError in a `data` listener kills the process --> FIXED
- [WARNING] - the new export had zero direct tests --> FIXED (new contract file)
- [CONVENTION] .claude/plans/ - no plan file --> FIXED
- [NIT] dead `lastProgressWrite`; redundant duplicate driver guard --> FIXED

#### Iteration 2
**New:** 4 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] test - cancel fixture coupled to TCP CHUNK COUNT; reviewer reproduced it red with a splitting server --> FIXED (flag on `got >= total`, plus a 512KB multi-chunk arm)
- [WARNING] test - the sibling assertion was true of the FAILURE shape too, so it went GREEN on the wrong path --> FIXED
- [WARNING] test - the #458 arm could not distinguish the two predicates it named --> FIXED (cancels mid-download)
- [WARNING] test - a counter collected and never asserted --> FIXED
- [CONVENTION] test - raw `mkdtempSync` leaked; repo ships `mkTemp` (#1402) --> FIXED
- [NITs] entry-guard test's "AT ENTRY" was aspirational; two hooks uncovered; loose control --> FIXED

#### Iteration 3
**New:** 4 WARNINGs, 5 NITs
- [WARNING] test - the multi-chunk guard could not detect a single chunk (`cancelled()` fires per chunk PLUS once after, so 1 chunk = 2 calls) --> FIXED (count `onProgress`)
- [WARNING] connect.js - the throttle comment travelled with the code while the throttle moved to the caller --> FIXED
- [WARNING] connect.js - a new public export, not re-entrant, not documented as single-flight --> FIXED
- [WARNING] connect.js - the `accessSync` arm and the second cancel site were undriven --> FIXED (tests added)
- [NITs] off-by-one in the #458 arm; orphaned `badChecksum`; sweep gating unpinned; `setDryRun` inert --> FIXED

#### Iteration 4
**New:** 1 BLOCKER, 2 WARNINGs, 3 NITs
- [BLOCKER] test - disabling the post-download cancel left ALL 65 tests green while a cancelled flow emitted INSTALLING and EXECUTED THE INSTALLER; two paths satisfied the same assertions --> FIXED (assert side effects, not the result)
- [WARNING] connect.js - an undocumented FOURTH shape: a mid-download cancel returns the failure shape with no `cancelled` flag, and that is the common path --> FIXED (documented; not changed, which would break neutrality)
- [WARNING] connect.js - the cancel/wantsProgress ordering was load-bearing and unguarded --> FIXED
- [NITs] a vacuous loop iteration; a wrong plan figure --> FIXED

#### Iteration 5
**New:** 1 BLOCKER, 2 WARNINGs, 5 NITs
- [BLOCKER] test - my own comment claimed a cleanup assertion was impossible. It is not. My mutation had been anchored on the MESSAGE TEXT, which also appears in a comment ~30 lines from the call, so I was deleting a line the test never reaches --> FIXED (anchored on the call; retraction and the measured cause recorded)
- [WARNING] connect.js - three further cleanups equally unguarded --> FIXED (all five now pinned, each red under its own mutation)
- [WARNING] runFlow - 4 of 5 hooks can be wired wrongly with the suite green --> DEFERRED, carded as kosmos#1569 (reproduces on main)
- [NITs] stale counts, a cross-tree contrast, a dead helper, an orphaned option --> FIXED

#### Iteration 6
**New:** 2 WARNINGs, 6 NITs
- [WARNING] connect.js - the phase contract was half pinned: moving `onPhase(INSTALLING)` after the installer left the suite green, so the board would sit on DOWNLOADING for the whole install --> FIXED (one ordered log interleaving phases and runner calls)
- [WARNING] connect.js - `detail` is a documented contract field with nothing asserting it --> FIXED
- [NITs] four of my own measurement claims wrong; a superseded draft comment --> FIXED

#### Iteration 7
**New:** 0 actionable. 1 WARNING deduplicated against kosmos#1569 (verified pre-existing on clean main by this reviewer), 4 NITs fixed in-round.
**CONVERGED.**

### Final Ledger (open items only)

| # | Category | Location | Description | Status | Resolution |
|---|---|---|---|---|---|
| 1 | WARNING | runFlow hook object | 4 of 5 hooks can be wired wrongly with the suite green | DEFERRED | kosmos#1569; reproduces on main, so relocated not created |
| 2 | NIT | connect.js sequence | 5 further behaviours survive mutation (`myReq` vs `activeRequest`, HOME, X_OK, `cancellable`, the `.part` filter) | DEFERRED | all verbatim from main and reproduce there |
| 3 | - | connect.js `if (res.cancelled) return;` | cannot be pinned by ANY test | DOCUMENTED | `becomeStuck` already returns early on exactly `cancelled()`'s condition, so no observation point exists; kept for the second caller, with the reason in the code |
| 4 | - | connect.js microtask hop | early returns are now one microtask from the caller's reaction | DOCUMENTED | only a cancel can interleave, which makes `becomeStuck` no-op anyway |

### Mutations verified red (each independently)

post-download cancel disabled - post-install cancel - accessSync arm - success-path
cleanup - `!inst.ok` cleanup (via the pre-existing connect.test.js:216) - #458
predicate collapse - INSTALLING phase removed - INSTALLING moved after the
installer - `wantsProgress` gate removed - cancel moved behind the gate - entry
hook guard removed - cancelled-shape message stripped - sweep hook ignored -
`detail` dropped from the result.

Coverage is not vacuous: planting a throw at the top of `installClaudeCode`
turns 19 tests red.

### Strengths recorded across iterations

- The extraction is textually faithful: with comments stripped it is
  statement-for-statement the original, each inline predicate replaced by its
  named hook and each `becomeStuck`/bare return by a result.
- `maySweepDownloads` is deliberately not `!cancelled()`, and the tests
  discriminate: collapsing it goes red.
- The documented fourth outcome was verified by driving a mid-download cancel
  directly and getting the documented shape verbatim.
- The directory assertions are not vacuous: a sibling control asserts the same
  directory read NON-empty, proving the path resolution.
