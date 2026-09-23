---
pre_challenge: true
method: challenge-loop
branch: needsyou-question-3419
diff_hash: 3fff64edafe0b24e7a16c62ad24f279907672a47e5764e77c1b1a39b0ca1bee3
validation: passed
subdir_audit: passed
timestamp: 2026-09-23T11:26:32Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (re-run on top of PR #3455 after adding, then reverting, the needs_you delivery-note strip)
**Converged:** Yes (iteration 4 found zero new findings)
**Total findings:** 5 actionable (2 BLOCKERs, 0 WARNINGs, 3 CONVENTIONs) + NITs
**Fixed:** 5 | **Deferred:** 3 NITs (by design) | **Asked:** 0

Two-model rotation (kosmos#2032): opus / sonnet / opus / sonnet. The two BLOCKERs
were both caught by a sonnet pass (iteration 2) after two opus-inclusive passes and
the original 3-round loop had all missed them - direct evidence for varying the
reviewer model.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 2 CONVENTIONs
**Self-generated:** 0 of the above (ITER_COMMITS empty at iteration 1)
- [CONVENTION] engine/chat.js — withQuestionRow docstring carried by-name behavioural assertions about web/index.html internals (dmRow/midOf/DM_SPOKE_AT/pjWhen), a repo convention #5 stale-risk since Mona's step-2 reworks that path --> FIXED (93020157d): trimmed to the engine contract + a plan pointer; render mechanics moved to the plan.
- [CONVENTION] .claude/plans/needsyou-question-3419.md — plan framed the delivery-note strip as deferred while the code had already stripped it --> FIXED (93020157d): plan updated (later superseded by the iteration-2 revert).

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 2 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above (both cited lines predate this loop's fix commits: BRANCH)
**Duplicates of prior findings:** 0
- [BLOCKER] server.js:10810 — a HARD thread-read failure (UNREADABLE/UNPARSEABLE -> messages=null) was masked: withQuestionRow coerced null to [] and appended a row, hiding the failure on the client (its "cannot read" notice gates on !allRows.length) and flipping Array.isArray(messages) true, which DM_SPOKE seeding reads as "the read answered" --> FIXED (0650d7717): gate injection on Array.isArray(messages); null passes through unchanged; BAD_THREAD's [] still injects. Regression test added.
- [BLOCKER] engine/chat.js:765 — the needs_you waitingNote strip (returning null) had cross-surface blast radius: waitingNote is shared by every chat.deliver caller, and the Compact/Clear route's memoryCommand reader substitutes "between tasks" on a null note (false for a waiting agent) --> FIXED (0650d7717): REVERTED the strip; deferred to step 3 scoped to the message route, after auditing all deliver callers.
- [NIT] docstring/test claimed the row "matches keepAgentReply's delivery: null" but keepAgentReply omits the field --> tightened (0650d7717).

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION
**Self-generated:** 1 of the above (SELF) — the cited line was written by this loop's own iteration-2 fix commit 0650d7717
- [CONVENTION] engine/chat.js:1846 — the iteration-2 NIT fix RE-INTRODUCED a by-name web-render claim ("the renderer's 'theirs' branch keys on from and never reads delivery"), the exact kosmos#120 "a corrected comment regenerates the finding" pattern --> FIXED (e499dc628) by DELETING the render claim (not rewriting it), leaving only the engine-local invariants + a plan pointer. That is what breaks the regeneration cycle.
- [NIT] dedup compares only the trailing row by exact text (documented accepted transient); [NIT] the failed-read test monkeypatches readThread rather than using a seam (works, restored in finally, self-verifying - the assertion fails loudly if the patch stops taking); [NIT] two em dashes in #3455's original comments (house style, 78+ pre-existing in chat.js, non-Josh-facing) --> all left by design.

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 — CONVERGED. Reviewer independently re-verified every cross-module claim against the real web consumers and ran the full canonical suite clean (8100 tests, 7952 pass, 0 fail, 148 skipped, exit 0).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | engine/chat.js docstring | BRANCH | by-name web-render assertions (conv #5 stale-risk) | FIXED | 93020157d |
| 2 | 1 | CONVENTION | plan.md | BRANCH | plan/code drift on the note strip | FIXED | 93020157d |
| 3 | 2 | BLOCKER | server.js:10810 | BRANCH | hard read failure masked by null->[] coercion | FIXED | 0650d7717 |
| 4 | 2 | BLOCKER | engine/chat.js:765 | BRANCH | shared waitingNote strip -> false Compact/Clear note | FIXED (reverted) | 0650d7717 |
| 5 | 3 | CONVENTION | engine/chat.js:1846 | SELF | iter-2 comment fix re-added a by-name web claim (kosmos#120) | FIXED (deleted) | e499dc628 |

### NITs (non-blocking)
- [NIT] engine/chat.js dedup: trailing-row text-equality only (documented accepted transient, co-lands away).
- [NIT] server.test.js failed-read test monkeypatches readThread (self-verifying; a broken patch fails the assertion, not silently passes).
- [NIT] two em dashes in #3455's original code comments (matches pervasive house style; non-Josh-facing).

### Strengths (across iterations)
- The failed-read guard (Array.isArray) is the right fix with a dangerous-answer-capable regression test.
- The mis-cased-URL test pins the canonical card.sessionName choice against dmWho.
- The waitingNote change is a comment-only retraction record of a reverted in-flight decision.
- Full canonical suite green at HEAD (8100/7952 pass/0 fail/exit 0).
