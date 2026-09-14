---
pre_challenge: true
method: challenge-loop
branch: project-brief-stub-2706
diff_hash: 17b721e1ae29a0952c8cea63a0724188edecce802b71c69052173117d41ea86e
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T09:39:03Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (converged)
**Converged:** Yes
**Reviewer models:** Sonnet, Opus (convergence witnessed by two models, kosmos#2032)
**Total findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Fixed:** 1 BLOCKER + 1 WARNING + 1 CONVENTION + 1 NIT | **Deferred:** 1 WARNING + 1 NIT | **Asked:** 0
**Self-generated (SELF):** 0 across all iterations (every finding sat on pre-existing / branch-original lines, never on a loop fix commit's lines)

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING, 1 CONVENTION, 1 NIT
**Self-generated:** 0 (ITER_COMMITS empty; nothing committed as a loop fix yet)
- [BLOCKER] engine/projects.test.js:851 - the "nothing is ever written into the user's project folder" invariant is exactly what #2706 overturns; the test was left unmodified. It passed in the FULL suite only by accident (an earlier test at line 181 seeds a BRIEF.md into the shared 'untouched' folder first, so no-clobber hid the write); in isolation it FAILED. --> FIXED (108f5bab): rewritten to the surviving, narrower invariant (Kosmos writes ONLY its brief stub and touches nothing of the person's) on a UNIQUE folder so it is order-independent; verified failing-before / passing-after in isolation.
- [WARNING] engine/projects.js seedBriefStub/briefStubContent - both are exported "for tests" but neither documents nor enforces that callers must pass already-neutralised name/description; a future direct caller passing raw text would produce un-sanitised markdown. --> FIXED (108f5bab): added a doc-comment note that the one caller passes cleanName/cleanDescription output and a future direct caller must clean its own.
- [CONVENTION] .claude/plans/ - the plan's Verification section wrongly claimed the existing projects suite stays green with no test change. --> FIXED (108f5bab): corrected to state the one invariant test was rewritten and why.
- [NIT] briefStubContent uses +-concatenation where the file leans on template literals. --> FIXED (108f5bab): the interpolated segments now use template literals.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
**Converged** - no new actionable findings (both findings deferred with reasoning). The reviewer independently confirmed no-clobber is atomic AND symlink-safe (wx = O_EXCL), best-effort is correctly scoped, the neutralisation boundary comment is accurate, the rewritten test discriminates and is order-independent, and its own repo-wide sweep found no other affected folder-listing test.
- [WARNING] engine/projects.js membershipLine - the brief is written but the agent is never explicitly pointed at BRIEF.md; the card's root cause is agents landing with "nothing to read". --> DEFERRED: the membership message already tells the agent "Its folder is `<folder>`", and #2707 is the dedicated already-filed card for the brief-discovery / "brief pending" coordination behavior. #2706's explicit ask (the file) is done; a louder pointer belongs with #2707's pending-state logic (which knows whether a brief exists) and would otherwise risk a dead pointer in the rare best-effort-failure case. The reviewer itself called this "a scoped, defensible gap rather than a defect"; josh-review can pull it forward.
- [NIT] engine/projects.js:1709 - a description like "## Overview" or "---" renders as markdown in the Goal. --> DEFERRED: it is the user's own single-line text in their own editable local brief, no cross-user surface; rendering their markdown as markdown is acceptable.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/projects.test.js:851 | BRANCH | invariant test overturned by #2706, passed only by shared-state fluke | FIXED | 108f5bab |
| 2 | 1 | WARNING | engine/projects.js seedBriefStub | BRANCH | neutralisation contract undocumented on exported helpers | FIXED | 108f5bab |
| 3 | 1 | CONVENTION | .claude/plans/ | BRANCH | plan Verification claim was incorrect | FIXED | 108f5bab |
| 4 | 1 | NIT | engine/projects.js briefStubContent | BRANCH | +-concat where file uses template literals | FIXED | 108f5bab |
| 5 | 2 | WARNING | engine/projects.js membershipLine | BRANCH | agent not explicitly pointed at BRIEF.md | DEFERRED | #2707's scope; folder already pointed at; josh-review |
| 6 | 2 | NIT | engine/projects.js:1709 | BRANCH | markdown passthrough in the Goal | DEFERRED | user's own local text, acceptable |

### Outstanding questions (ASKED)
None.

### NITs (non-blocking, across all iterations)
- Fixed: +-concat -> template literals in briefStubContent (iteration 1).
- Deferred: markdown passthrough in the Goal from the user's own description (iteration 2).

### Strengths (across all iterations)
- No-clobber is atomic AND symlink-safe: the wx flag (O_EXCL) collapses the existence check and write into one syscall and refuses to follow a terminal symlink at BRIEF.md, so a pre-planted symlink cannot redirect the write. The filename is a constant and the folder is validated absolute upstream, so no path-injection surface.
- Best-effort is correctly scoped (wraps the whole write, after writeAll, returns the same project), mirroring markWelcomeSeeded; the BEST-EFFORT test exercises a real failure mode (BRIEF.md pre-existing as a directory).
- The rewritten projects.test.js invariant test is order-independent (unique folder) and genuinely discriminates: it fails if the stub is missing, if any extra file is added, or if a user file is modified.
- Regression sweep (both reviewers, independently, plus the orchestrator): the only production create() callers are POST /api/projects and seedWelcomeHome, and seedBriefStub cannot throw, so neither is affected; no other repo test asserts a project-folder listing after create (all 8 project-touching test files pass in isolation).
