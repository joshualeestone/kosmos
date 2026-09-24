---
pre_challenge: true
method: challenge-loop
branch: observed-machine-banner-1959
diff_hash: 97df39458135321c20b7c0ece63d52eff64984c76b2c139e98ca218ef017c30a
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T07:40:54Z
iterations: 3
models: [opus, sonnet, opus]
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 returned zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 2 actionable (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs) + 1 CONVENTION + several NITs
**Fixed:** 1 CONVENTION + 2 WARNINGs + 3 NITs | **Deferred:** 2 NITs (efficiency + sub-tick race) | **Asked:** 0

#1959's last live residual: computeMachine (the #2130 machine banner) read only the raw
credential-exists check(), so an expired-401 token still on disk kept the banner on "connected".
#3136's dir-keyed observed store (sawDir/readDir, merged after the original deferral) lets
computeMachine read the per-dir verdict headlessly, dissolving the server->engine plumbing the
deferral was based on. Reviewer models rotated opus / sonnet / opus; the two WARNINGs (iter2) were
accuracy issues about the banner surfacing the state, not the wording -- not the functional fix,
which is correct -- and iter3 confirmed the change sound with zero actionable findings.

### Validation

Full suite (tools/run-tests.sh, DEVELOPER_DIR=/Library/Developer/CommandLineTools): 8516 tests,
8368 pass, 0 fail, 148 skipped, RC=0, 16 shell suites ALL PASS (final run b01k602vt). An earlier run
showed 2 failures (server.supervisor-refresh "board start" and tools.release-gate "stranded bump");
both confirmed HOST CONTENTION (the box runs CI + concurrent review agents), passing 30/30 together
in isolation. Neither touches any file in this diff.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 (reviewed the committed BRANCH diff)
- [CONVENTION] engine/subscription.js machineStatKey - the freshness predicate re-derived verdict()'s fresh/stale decision (two copies of one fact); a future change to verdict() would silently drift the memo key. --> FIXED (724971ca: extracted observed.isFresh as the single owner; verdict() and the memo key both call it)
- [NIT] engine/subscription.js observedReachable - dead `obs` local declared/assigned but never read. --> FIXED (724971ca: removed)
- [NIT] sub-tick race: machineStatKey and observedReachable read Date.now() independently, so at the exact fresh->stale ms the key and verdict can momentarily disagree; self-heals next tick. --> DEFERRED (vanishingly rare, no correctness impact)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [WARNING] engine/subscription.js:563-566 - computeMachine's fallback returns the default's verdict, so a fresh-rejected NON-DEFAULT account's corrected wording is discarded. --> RESOLVED: the state (NONE) is correct, and the `because` is not surfaced by the banner anyway (see next), so this is invisible; documented, no functional gap.
- [WARNING] web/index.html:16375 - the fresh-rejected `because` is NOT surfaced: renderConnection shows only its headline for STATE.NONE and discards `because` (guarding a documented double-statement bug). The plan overclaimed the wording shows. --> FIXED (b051f529: corrected the plan, the observedReachable comment, and the test to name STATE.NONE as the user-visible effect and `because` as the verdict contract; the functional fix -- banner stops falsely reading connected -- is correct and reaches the user)
- [NIT] engine/observed.js - the isFresh "MUST call" comment overclaimed while status.js write-gates still inline the test. --> FIXED (b051f529: scoped the comment to read-time readers; status.js write-gates called out as a separate change)
- [NIT] engine/subscription.js early return `return base` vs `baseRes.verdict` - provably identical when reachable, but an implicit invariant. --> FIXED (b051f529: early return now yields baseRes.verdict too)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** - "The change is sound." No actionable findings; verified isFresh preserves verdict() byte-for-byte, the no-op-when-empty invariant holds, the memo fold is complete and correctly-timed, and the default-dir key is consistent with the server check-now write.
- [NIT] engine/subscription.js machineStatKey - folds every dir's observation, but a non-default's is only consulted when base is unreachable, so a non-default change forces a cheap spurious recompute returning the identical base verdict. --> DEFERRED (correct; covers the case where base later becomes unreachable; narrowing would couple the key to the short-circuit order for no gain; documented in the plan)
- [NIT] plan said the new test is "7/7" but the file has 8 cases. --> FIXED (aff8543d: plan now says 8/8)

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | subscription.js machineStatKey | BRANCH | re-derived verdict's freshness (two copies) | FIXED | 724971ca (observed.isFresh) |
| 2 | 1 | NIT | subscription.js observedReachable | BRANCH | dead `obs` local | FIXED | 724971ca |
| 3 | 1 | NIT | subscription.js/observed.js | BRANCH | sub-tick freshness race | DEFERRED | self-heals next tick |
| 4 | 2 | WARNING | web/index.html:16375 | BRANCH | `because` not surfaced; plan overclaimed | FIXED | b051f529 (honest plan/comment/test) |
| 5 | 2 | WARNING | subscription.js computeMachine | BRANCH | non-default corrected verdict discarded | RESOLVED | invisible (because not surfaced); state correct |
| 6 | 2 | NIT | observed.js isFresh comment | BRANCH | "MUST call" overclaim | FIXED | b051f529 |
| 7 | 2 | NIT | subscription.js early return | BRANCH | `return base` vs baseRes.verdict invariant | FIXED | b051f529 |
| 8 | 3 | NIT | subscription.js machineStatKey | BRANCH | non-default fold -> cheap spurious recompute | DEFERRED | correct; documented |
| 9 | 3 | NIT | plan | BRANCH | test count 7 vs 8 | FIXED | aff8543d |

**Convergence:** iteration 3 (opus) returned zero BLOCKER/WARNING/CONVENTION across a change witnessed
by two models. All actionable findings fixed; remaining NITs deferred with reasons. 6d CONVERGED.
