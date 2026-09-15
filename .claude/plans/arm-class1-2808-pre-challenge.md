---
pre_challenge: true
method: challenge-loop
branch: arm-class1-2808
diff_hash: e33faf46b91f07f35f5cbd0b909d08c57453078ac10d871b16a3fe08843936e2
validation: passed
subdir_audit: passed
timestamp: 2026-09-15T03:29:50Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes
**Total findings:** 1 BLOCKER, 6 WARNINGs, 1 CONVENTION, 5 NITs, + 1 validation failure
**Fixed:** most | **Deferred:** 1 NIT (escalate log noise) | **Asked:** 0

This branch ARMS a production auto-restart, so the review was the point. Reviewer models
rotated opus / sonnet / opus / sonnet / opus.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 3 NITs
- [BLOCKER] sweepOnce keyed the executor on the DISPLAY name; create.trustAgentFolder / remove.restart resolve by the SESSION key. For the named fleet (session angel -> display Angel) it would REFUSE (silently never fire, then escalate) or restart the WRONG agent --> FIXED (cda9e78): key on agent.sessionName; +BLOCKER regression test with a real display!=session card.
- [WARNING] the by:'auto'-only trigger MISSED the actual #2808 folder-trust case: that dialog is not a PermissionRequest, so it has no by:'auto' self-report and is only scrape-detected (stateReportedBy null) --> FIXED (cda9e78): also fire on a live trust-dialog scrape (isTrustDialogEvidence), injected from status.
- [WARNING] overstated "a working scrape wins" safety claim (reconcileReport rule 6 does not decay a reported needs_you) --> FIXED (cda9e78): corrected; plan names the real bounds (#2456 self-clear + loop-guard).
- [NIT] pruneAttempts (Map bounded by live names); escalate now logged; "doubly protected" corrected --> FIXED (cda9e78).

#### Validation (after iter 1)
- fixture-discipline gate FAILED: the sweepOnce tests hand-built cards (a `sessionName` literal) --> FIXED (a1a91d9): moved sweepOnce tests to a fleet-based file driving REAL reconciled cards; the pure-logic tests use no card literal.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 2 BLOCKERs (transient), 1 WARNING, 1 CONVENTION, 1 NIT
- [BLOCKER x2] were about the UNCOMMITTED working-tree the reviewer observed mid-edit (deleted sweepOnce tests + a failing display==session fixture) - both already resolved as committed; the reviewer confirmed "as committed at HEAD the coverage is present and red-capable". (Lesson: do not spawn a reviewer against a dirty tree.)
- [WARNING] create.trustAgentFolder does a real config write with NO self-gate (unlike remove.restart) --> FIXED (a4986bb): flagged on trustAgentFolder + marked the server-side liveExecutionAllowed gate LOAD-BEARING.
- [CONVENTION] colocate the fleet test in engine/ --> FIXED (a4986bb): engine/class1-autohandle-sweep-2808.test.js.
- [NIT] unused sweepOnce import removed --> FIXED (a4986bb).
- Note: 3 tools.release-gate.test.js reds in a prior full-suite run were machine CONTENTION (green standalone on origin/main AND this worktree, green paired with the sweep file, this branch touches no release-gate code); confirmed by two subsequent clean full-suite runs.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 2 NITs
- [WARNING] defense-in-depth: standingFromAgent promoted a trust scrape to 'auto' even with a conflicting self-report provenance --> FIXED (4be993a): promote a trust scrape ONLY when rawBy is null; a self-reported by:'agent'/'operator' is never overridden. +tests.
- [WARNING] by:'auto' covers ANY tool-permission prompt (wider blast radius, discards a stuck agent's turn) --> DOCUMENTED (4be993a): kept per Josh's LOCKED class-1 ruling (fires only on a STUCK agent; matches the manual /trust-and-restart action; #3087 makes the relaunch clean); named the reversal path.
- [NIT] recordAttempt(prune, drops non-finite) vs planClass1Handle(counts non-finite as recent) asymmetry --> commented as intentional (storage vs decision). [NIT] escalate log noise --> DEFERRED (documented; rare, bounded, informative).

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 1 NIT
- [WARNING] the iter-3 defense-in-depth tested an UNREACHABLE shape (by:'agent' + trust evidence, which status.js never emits). The REACHABLE case - a standing by:'agent' question + a live trust-dialog screen -> card by:null + evidence -> handled - was untested; and it IS correct (a trust scrape means the agent is at STARTUP, so the prior question is orphaned) --> FIXED (e9717ff): rewrote the comment to the real (narrower, accurate) guarantee; ADDED a fleet test for the reachable sequence.
- [NIT] create.js comment "reachable only on a running board" too absolute (the route's test protection is env sandboxing) --> FIXED (e9717ff).

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0. Both WARNINGs raised were confirmed-resolved DUPLICATES (the trustAgentFolder gate - "acknowledged and defended in-code, not a blocker"; the by:'auto' scope - "correctly documented and reversible"). 4 STRENGTHs verified: class-2-never-restarted is airtight end-to-end (incl. the reachable trust-scrape case), fixture discipline exemplary (real reconciled cards), loop-guard correct, no require cycle, 49 tests pass.
**Converged.**

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/class1-autohandle.js | SELF | executor keyed on display name not sessionName | FIXED | cda9e78 |
| 2 | 1 | WARNING | engine/class1-autohandle.js | SELF | by:auto-only missed the scrape-detected folder-trust dialog | FIXED | cda9e78 |
| 3 | 1 | WARNING | engine/class1-autohandle.js | SELF | overstated "working scrape wins" | FIXED | cda9e78 |
| 4 | 1 | NIT | engine/class1-autohandle.js | SELF | Map unbounded / escalate unlogged / doubly-protected overclaim | FIXED | cda9e78 |
| 5 | val | BLOCKER | engine/class1-autohandle.test.js | SELF | hand-built card fails fixture-discipline | FIXED | a1a91d9 |
| 6 | 2 | WARNING | engine/create.js | BRANCH | trustAgentFolder config write single-gated | FIXED | a4986bb |
| 7 | 2 | CONVENTION | engine/class1-autohandle-sweep-2808.test.js | SELF | test file placement | FIXED | a4986bb |
| 8 | 2 | NIT | engine/class1-autohandle.test.js | SELF | unused sweepOnce import | FIXED | a4986bb |
| 9 | 3 | WARNING | engine/class1-autohandle.js | SELF | trust scrape overrode a self-report provenance | FIXED | 4be993a |
| 10 | 3 | WARNING | .claude/plans/arm-class1-2808.md | SELF | by:auto scope (tool-permission restart) | DOCUMENTED | 4be993a |
| 11 | 3 | NIT | engine/class1-autohandle.js | SELF | prune-vs-count asymmetry | FIXED (comment) | 4be993a |
| 12 | 3 | NIT | server.js | SELF | escalate log noise | DEFERRED | rare/bounded; transition-log a follow-up |
| 13 | 4 | WARNING | engine/class1-autohandle.js | SELF | defense-in-depth tested an unreachable shape; reachable case untested | FIXED | e9717ff |
| 14 | 4 | NIT | engine/create.js | SELF | comment too absolute | FIXED | e9717ff |
| - | 5 | WARNING x2 | - | - | duplicates of #6 and #10, confirmed resolved | DUP | - |

### Outstanding questions (ASKED)
None.

### NITs deferred
- Escalate log noise (~1 line/min for a persistently-divergent agent): left as-is - a divergent agent is a genuine signal a person should see, it is rare, and the line is bounded; a transition-only log is a cheap follow-up.

### Strengths (across all iterations)
- The class-2-never-restarted safety property is airtight, verified end-to-end against the real reconcile pipeline: a by:'agent' question is refused; the one reachable trust-scrape-with-stale-question path is correctly a startup wedge (orphaned question), handled with an honest tested rationale.
- The two-signal trigger is exactly class-1 (self-reported by:'auto' OR a live trust-dialog scrape) and nothing more; the folder-trust dialog (Josh's on-box "constantly" case) is now actually covered, which by:'auto' alone missed.
- The executor is keyed on sessionName everywhere (verified against remove.js's resolution), with a red-capable regression test on a real display!=session card.
- Loop-guarded across ticks by an in-memory attempts Map (heartbeat-style), bounded by pruneAttempts; every corrupt-input shape biases to escalate, never to an extra restart.
- Doubly test-inert: the server sweep gates on liveExecutionAllowed() (false under node --test, and allowLiveExecution() runs only under require.main === module), and remove.restart independently self-gates; the tests inject fakes and sandbox the config dir.
- Fixture discipline exemplary: sweepOnce is driven against REAL reconciled cards (test-support/fleet), not hand-built literals.
