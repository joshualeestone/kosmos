---
pre_challenge: true
method: challenge-loop
branch: pbrun-7404
diff_hash: 900e51843c6f8728ec2cf4e6cd03c0b0fa5f7deb5e1f418abfbb15ab757e91e3
validation: focused suites and engine.reachable on main after #7726, 127 pass; full suite carried by PR CI (Mortals is reserved for Cloud go-public)
subdir_audit: passed
timestamp: 2026-11-01T14:18:37Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at iteration 8 under the standing 8-round usage rule, with no BLOCKER open.
**Total findings:** 2 BLOCKERs, about 30 WARNINGs, 5 CONVENTIONs, about 20 NITs
**Fixed:** all but the deferrals below | **Deferred:** 6 | **Asked (awaiting user):** 0

The eight rounds were squashed onto main after #7726 merged, with one conflicted line in module.exports.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 10 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [BLOCKER] engine/personalrestore.js — on a named Kosmos the restored world landed off the list --> FIXED (the booted base)
- [WARNING] engine/personalrestore.js — member keys not zeroed on every path --> FIXED
- [WARNING] engine/personalrestore.js — sink failures, close in a finally, empty worlds left, wrong sentences --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 3 of the above
- [WARNING] engine/personalrestore.js — synchronous work on the board's loop --> DEFERRED: in the plan, for the route

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 7 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 5 of the above
- [BLOCKER] engine/personalrestore.js — unreachable exports red the suite --> FIXED (named excuses)
- [WARNING] engine/personalrestore.js — failed tries spent the day's names --> FIXED (the manifest is proved first)
- [WARNING] engine/personalrestore.js — raw tunnel text reached the person --> FIXED (wordsFor)
- [WARNING] engine/personalrestore.js — a fixed 400 keys --> FIXED (batchFor)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 4 of the above
- [WARNING] engine/personalrestore.js — a second grant for the manifest --> DEFERRED: one in 600, in the plan

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 7 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 5 of the above
- [WARNING] engine/restorefetch.js — the week-before rule rested on a false reason --> FIXED: measured, removed from both repos
- [WARNING] engine/personalrestore-7404.test.js — hide and record paths untested --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 3 of the above
- [WARNING] engine/personalrestore.js — key shape checked late, a cut list unsaid --> FIXED

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 8 NITs
**Self-generated:** 3 of the above
- [WARNING] engine/personalrestore.js — failed files not named, a missing key silent, originals not zeroed, gaps in tests --> FIXED

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 2 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/personalrestore.js — partial read from the run, not what landed --> FIXED
- [WARNING] engine/personalrestore.js — a chunk key longer than the manifest's --> DEFERRED: keyProblem fixes one shape
- [WARNING] engine/personalrestore.js — a key under two epochs --> DEFERRED: the key names its epoch
- [CONVENTION] engine.reachable.test.js — withdrawn by the reviewer: the sweep passes

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### Strengths (across all iterations)
- trust: 'member-proof' is set in one place, and the manifest is proved before anything is made.
- sink.close never sits over the run's answer.
