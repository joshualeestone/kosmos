---
pre_challenge: true
method: challenge-loop
branch: brief-pending-2707
diff_hash: 0a713106b430c52d575dc86f4ebf0412da2e634e1eb10a2aeaeed1afca43c753
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T10:22:25Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (converged)
**Converged:** Yes
**Reviewer models:** Sonnet, Opus (convergence witnessed by two models, kosmos#2032)
**Total findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Fixed:** 1 BLOCKER + 2 WARNINGs | **Deferred:** 1 WARNING + 2 NITs | **Asked:** 0
**Self-generated (SELF):** 0 across all iterations (every finding on pre-existing / branch-original lines, never on a loop fix commit's lines)

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (ITER_COMMITS empty; nothing committed as a loop fix yet)
- [BLOCKER] engine/projects.js briefIsPending - the read-error fail-safe was INVERTED: the inner catch returned true (pending) for ANY read error, so a filled-but-unreadable BRIEF.md (EACCES/EISDIR) reported pending and the note would contradict a real brief - the exact harm the doc comment claimed to avoid. --> FIXED (bbd78017): only ENOENT (genuinely absent) is pending; every other read error fails toward NOT pending, and the comment now agrees.
- [WARNING] engine/projects.brief-pending-2707.test.js - the "FAIL-SAFE" test only exercised the absolute-path guard, never the readFileSync catch where the bug lived. --> FIXED (bbd78017): renamed that test to what it checks, and added a real read-error arm (BRIEF.md as a directory -> EISDIR -> NOT pending) that would have caught the BLOCKER.
- [WARNING] .claude/plans/ - the "repo-wide sweep" claim covered only node --test, not the docs/browser-checks Playwright fixtures that also POST staffed projects. --> FIXED (bbd78017): corrected to state the browser-checks are structurally unaffected (ROOM_NOT_SPEECH excludes kind:'note' from the thread/speech views they read) and CI runs them as the gate; also corrected a "three files touched" vs "two" wording.
- [NIT] plan - "three test files" conflated sweep-match count with files-touched. --> FIXED (bbd78017) as part of the plan correction above.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
**Converged** - no new actionable findings (both deferred). The reviewer independently verified the fail-safe is correct on every error code, swept all 21 browser-checks (render-projects/render-thread structurally unaffected: the note is excluded from thread/speech by ROOM_NOT_SPEECH AND by from !== dmSession), and confirmed a server.test.js failure it saw (#1304 seam) was its own cwd artifact, not this diff (266/0 from the worktree root).
- [WARNING] engine/projects.js / server.js - the "first asks, rest hold" coordination is advisory (the note instructs it), not mechanically enforced, so a simultaneous-boot race can still let more than one agent ask. --> DEFERRED: the reviewer states this is "not a defect in the code as written"; it is the shared-state the card literally describes, fixes the common case, and is named honestly as the plan's weakest premise with a per-project mechanical claim scoped as a josh-review follow-up.
- [NIT] the comment names EACCES as handled but only EISDIR is tested. --> DEFERRED: the catch keys solely on err.code === 'ENOENT', so every non-ENOENT code (EACCES, EISDIR, ...) takes the identical branch; the EISDIR test exercises that exact branch and is representative. A separate EACCES test would drive the same path via a flakier chmod, and the reviewer confirms coverage is adequate.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/projects.js briefIsPending | BRANCH | read-error fail-safe inverted | FIXED | bbd78017 |
| 2 | 1 | WARNING | engine/projects.brief-pending-2707.test.js | BRANCH | read-error branch untested | FIXED | bbd78017 |
| 3 | 1 | WARNING | .claude/plans/ | BRANCH | overstated "repo-wide" sweep | FIXED | bbd78017 |
| 4 | 1 | NIT | .claude/plans/ | BRANCH | "three files" wording | FIXED | bbd78017 |
| 5 | 2 | WARNING | engine/projects.js, server.js | BRANCH | coordination is advisory, not mechanical | DEFERRED | plan weakest premise; josh-review follow-up |
| 6 | 2 | NIT | engine/projects.js:1752 / test:84 | BRANCH | EACCES reasoned not measured | DEFERRED | same catch branch as tested EISDIR; representative |

### Outstanding questions (ASKED)
None.

### NITs (non-blocking, across all iterations)
- Fixed: plan "three files" wording (iteration 1).
- Deferred: EACCES reasoned not measured - the EISDIR test covers the identical non-ENOENT branch (iteration 2).

### Strengths (across all iterations)
- briefIsPending's fail-safe is correct in the dangerous direction on every error code: only ENOENT is pending; EACCES/EISDIR/any other error return NOT pending, so the note can never contradict a real-but-unreadable brief.
- BRIEF_GOAL_PLACEHOLDER is a single shared constant the writer emits and the detector looks for, with a CONTROL test tying them - directly closing the repo's #1 "two derivations of one fact drift" defect class.
- Gating (agents present AND briefIsPending) cannot misfire: posted after told, double-protected best-effort like WELCOME_ROOM_NOTE; the three route tests discriminate the dangerous arm (fires for staffed+pending, silent for described and no-agents).
- Regression risk cleared by both reviewers: the note is kind:'note', excluded from thread/speech by ROOM_NOT_SPEECH; the two touched fixtures were neutralised with a description and no withThread consumer asserts on the description; all node --test and browser-check surfaces confirmed clear.
