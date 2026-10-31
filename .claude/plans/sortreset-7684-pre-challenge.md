---
pre_challenge: true
method: challenge-loop
branch: sortreset-7684
diff_hash: a20f44901da2a17eb445123d6425e8f43c0b56c06ca8e42278d9678a23c77d63
validation: passed
subdir_audit: passed
timestamp: 2026-10-31T20:00:44Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1. **Converged:** yes, NITs only; one fixed (abb31c013d era).
Validation r1 went red only on 20 CLI timing tests at load 30.8 (iOS-only change); r2 passed (REAL_EXIT=0, AUDIT_EXIT=0, 14:56 CDT) on
the pre-rebase base. Rebased onto main 23 commits on, no conflicts; after it iOS LogicTests 1769/1769 and every ios/LogicTests run-*.sh
green. CI on the PR runs against current main and decides the merge.

## Review record

**Round 1 (fresh reviewer, before this proof).** No BLOCKER, no WARNING. NITs only.
- Fixed: the LogicTests used shared defaults; they now use fixed test suites, emptied before and after (0742ac763c after rebase).
- The other NITs were left. Their text was not kept in the handoff, so they are not itemised here.

## What the change rests on

- Once only: Board.resetOldAgentSort returns at once when kosmos.agentSortReset7684 is set, so a later choice is kept.
- Order: KosmosApp.init runs it before any view reads the @AppStorage in AgentsView.
- One key: Board.agentSortKey is read by both AgentsView and the reset.
- Nothing saved: the phone is only marked.

## Weakest premise

That nobody relies on a sort saved before this build. Choosing it again keeps it. Measured by LogicTests only; not run on a
phone that holds an older saved sort.
