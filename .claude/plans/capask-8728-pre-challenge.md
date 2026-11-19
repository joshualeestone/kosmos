---
pre_challenge: true
method: challenge-loop
branch: capask-8728
diff_hash: 73ffd5cab70d7b4936f1aca91dc23c6d236a16d9a357e60b5e13318848a48d95
validation: passed
subdir_audit: passed
timestamp: 2026-11-19T16:52:22Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 37 (0 BLOCKERs, 15 WARNINGs, 1 CONVENTION, 21 NITs; plus 1 synthetic validation finding)
**Fixed:** 27 | **Deferred:** 8 | **Asked (awaiting user):** 0

The usage rule on this host (8 rounds, one reviewer at a time) was not reached.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (no loop commit existed yet)
- [WARNING] engine/remote.js connectorCapabilitiesPending - an earlier board's tunnel being ended still gave "update Kosmos" --> FIXED (2f84fd2db, foreignHolding)
- [WARNING] server.capask-8728.test.js generation test - could not fail on any single mutation --> FIXED (2f84fd2db, in-timer checks removed, test uses ask:false)
- [WARNING] server.capask-8728.test.js test (a) - load-sensitive retry limit --> FIXED (2f84fd2db, retryAskMs 15000)
- [NIT] engine/remote.js logCapabilityAsk - an answered line from an older generation did not say it was dropped --> FIXED
- [NIT] engine/remote.js - pending true before this board starts a tunnel promises a recovery --> DEFERRED: no remote request reaches such a board through Kosmos+; plan, Known and left
- [NIT] engine/remote.js - comments listing warmConnectorCapabilities callers --> FIXED
- [NIT] server.js REMOTE_STEP_UP_STARTING - unused starting field --> FIXED (removed)

#### Iteration 1 validation (6g)
- [BLOCKER] validation: tools/test-ssh-keychain-note-2600.sh timing arm ("a hung probe held the start for 7 s") red at load 21.5 --> DEFERRED: file untouched by this diff; green alone at 09:41; contention. Every later validation re-ran it.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/remote.js connectorCapabilitiesPending - "still starting" forever for a connector that can never answer --> FIXED (ddedf9d99, stillSelfRetrying)
- [NIT] engine/remote.js scheduleSelfRetry - unused generation parameter --> FIXED
- [NIT] engine/remote.js logCapabilityAsk - "asked 20 times" after 21 asks --> FIXED
- [NIT] engine/remote.js - two copies of the retry condition --> FIXED (one predicate)
- [NIT] engine/remote.js - retry limit comment narrower than the code --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/remote.js forgetConnectorCapabilities - the 1 + 20 cap reset on every tunnel restart --> FIXED (6a6dcff80 per-binary count; 36f0ae578 the log count per binary, caught by the new control)
- [WARNING] server.capask-8728.test.js - three pending arms untested --> FIXED (test; two arms removed as redundant, 5b7637410)
- [NIT] engine/remote.js logCapabilityAsk - constant count after the budget --> FIXED
- [NIT] engine/remote.js - "about ten minutes" undercounted --> FIXED
- [NIT] engine/remote.js runningCapabilities - foreignHolding left stale by early returns --> FIXED
- [NIT] engine/remote.js stopChild - timer survived a deliberate stop --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/remote.js stopChild - an ask in flight at a stop re-armed the timer --> FIXED (d15f8e447, retireCapabilityAsks)
- [WARNING] engine/remote.js connectorCapabilitiesPending - unbounded "still starting" on non-ask arms --> DEFERRED: wording only, never the refusal; no such state seen; plan, Known and left
- [WARNING] engine/remote.js noteRunning - a first status with no capabilities is kept for the child's life --> DEFERRED: older than this branch; plan, Known and left
- [NIT] engine/remote.js - retry limit comment --> FIXED
- [NIT] server.capask-8728.test.js - tests assert the seam's "0 s", not "30 s" --> DEFERRED: plan, Known and left
- [NIT] server.capask-8728.test.js - dead regex alternative --> FIXED
- [NIT] engine/remote.js - odd comment wrap --> FIXED

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 1 of the above (the plan's claim that the stop wiring could not be pinned, written by the iteration 4 fix; deleted, not reworded)
- [WARNING] .claude/plans/capask-8728.md - false claim that stopChild's call cannot be pinned --> FIXED (c133471f7, claim deleted; test through resetForTests)
- [WARNING] engine/remote.js connectorCapabilitiesPending - foreignHolding read order undocumented --> FIXED (documented at the function)
- [WARNING] engine/remote.js connectorCapabilitiesPending/noteCapabilities - an answered no read as pending; a timed-out recheck forgot it --> FIXED (c133471f7)
- [CONVENTION] engine/remote.js - comment said the count is per generation --> FIXED
- [NIT] engine/remote.js - comments on the timer's clears and the 20-ask end --> FIXED
- [NIT] engine/remote.js logCapabilityAsk - "none" while an earlier yes is kept --> FIXED
- [NIT] server.capask-8728.test.js - pending test without try/finally --> FIXED
- [NIT] server.js - comment named only two of the starting states --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs after deduplication
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 1 (unbounded "still starting" on non-ask arms: the iteration 4 deferral stands)
- [WARNING] engine/remote.js warmConnectorCapabilities - a hanging connector holds a child 15 s per ask; the 10 to 15 minute estimate covers only the self-retries --> DEFERRED: asks are one at a time (askingCapabilities), and the estimate is stated for the self-retries only
- [NIT] engine/remote.js binaryCapabilities - the request-driven recheck reads the constant, not the seam
- [NIT] comments carry review labels and a name - the file's existing convention
- [NIT] tests assert "0 s" - duplicate of iteration 4
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/remote.js pending | BRANCH | earlier board's tunnel gave update sentence | FIXED | 2f84fd2db |
| 2 | 1 | WARNING | server.capask-8728.test.js | BRANCH | generation test could not fail | FIXED | 2f84fd2db |
| 3 | 1 | WARNING | server.capask-8728.test.js | BRANCH | load-sensitive test (a) | FIXED | 2f84fd2db |
| 4 | 1 | BLOCKER | validation | BRANCH | keychain-note timing arm under load | DEFERRED | untouched file, green alone |
| 5 | 2 | WARNING | engine/remote.js pending | BRANCH | still starting forever | FIXED | ddedf9d99 |
| 6 | 3 | WARNING | engine/remote.js forget | BRANCH | cap reset per generation | FIXED | 6a6dcff80, 36f0ae578 |
| 7 | 3 | WARNING | server.capask-8728.test.js | BRANCH | pending arms untested | FIXED | 6a6dcff80, 5b7637410 |
| 8 | 4 | WARNING | engine/remote.js stopChild | BRANCH | in-flight ask re-armed after stop | FIXED | d15f8e447 |
| 9 | 4 | WARNING | engine/remote.js pending | BRANCH | unbounded non-ask arms | DEFERRED | wording only; plan |
| 10 | 4 | WARNING | engine/remote.js noteRunning | BRANCH | empty first status kept (older) | DEFERRED | pre-existing; plan |
| 11 | 5 | WARNING | .claude/plans/capask-8728.md | SELF | false untestable claim | FIXED | c133471f7 (deleted) |
| 12 | 5 | WARNING | engine/remote.js pending | BRANCH | read order undocumented | FIXED | c133471f7 |
| 13 | 5 | WARNING | engine/remote.js pending/note | BRANCH | answered no read as pending | FIXED | c133471f7 |
| 14 | 6 | WARNING | engine/remote.js warm | BRANCH | 15 s per hanging ask | DEFERRED | one at a time; claim scoped |

### NITs (non-blocking, across all iterations)
- [NIT] engine/remote.js binaryCapabilities - request-driven recheck reads the constant, not the seam (iteration 6)
- [NIT] tests assert the seam's "0 s" (iterations 4, 6)

### Strengths (across all iterations)
- The refusal decision is unchanged and keeps its code; only the sentence differs (every iteration)
- One predicate drives the retry, the log line and the sentence (iterations 3 to 6)
- Every behaviour test has a control, and the mutations are recorded in the plan (iterations 4 to 6)
