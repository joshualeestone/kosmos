---
pre_challenge: true
method: challenge-loop
branch: starter-8832
diff_hash: f0534a6c04ecdd5da81f4b37bf14df0c3228b55c82cce857bf703cbc6627940d
validation: passed (Mortals, 12:33 CST: hash f0534a6c04ec status clean; node 30,333 tests 0 failed 0 cancelled, shell 4 of 4 shards green)
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-11-20T17:39:44Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes (iteration 7 raised no BLOCKER, WARNING or CONVENTION)
**Total findings:** 6 WARNINGs, 0 BLOCKERs, 0 CONVENTIONs, 15 NITs
**Fixed:** 6 (5 warnings, 1 nit) | **Deferred:** 1 warning | **Asked (awaiting user):** 0

Related tests before review: 70 files, 2,611 tests, 0 failed. Mutations: 11, all red (the seed-mark arm `writer-moved`
is red partly because renaming the function also breaks other calls; `second-writer` is the arm that proves that guard).
Rebased onto origin/main 96ffb7ab42 after convergence with no overlap in the three changed files; the diff hash
is unchanged by the rebase.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/projects.js STARTER_PROJECT_LINE: "it has no work of its own" contradicts the task line once the person gives work --> FIXED (a9a622d095)
- [WARNING] engine/starter-8832.test.js: the title claims a real-project control through tick that only existed as a unit call --> FIXED (a9a622d095, a real tick run on a real project with the seeded words)
- [NIT] engine/projects.js: the subtask and --who lines still read as add-a-task invitations (kept: they say how, not whether)
- [NIT] engine/assigner.js: goalProject's skip list did not carry the gate --> FIXED (a9a622d095, the gate moved into goalProject)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/projects.js: the comment claimed only the seed writes made.via 'kosmos', unguarded --> FIXED (bbde6f546c, claim removed)
- [NIT] engine/projects.js: "add no tasks or posts" could read as do not answer the person --> FIXED (bbde6f546c)
- [NIT] engine/assigner.js: goalAskGaveUp not gated (a stored give-up clears within a day)
- [NIT] plan: mutations not in the repo

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/projects.js: with a goal the person wrote, the line said add nothing while the Assigner asks for tasks --> FIXED (2396956f2f, the line counts a goal they write as work they gave; the plan says why the line is fixed words)
- [NIT] subtask and --who lines (as iteration 1)
- [NIT] isStarterGoal re-normalises whitespace goalFrom already normalised
- [NIT] WELCOME_DESCRIPTION must stay under GOAL_MAX (the fixture assertion covers it)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] existing installs lose the goal ask at once but see the new line only on their next block rewrite --> DEFERRED: the plan records the rewrite timing as a choice; the mismatch runs the safe way (fewer asks, not more)
- [NIT] homeForFirstAgent duplicates the match (folding it in would change that function's test-project behaviour, outside this card)
- [NIT] an assertion message sits in the wrong block

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] the seeded brief already holds a goal, so "a goal they write in its brief" left the agent unable to tell Kosmos's from the person's --> FIXED (01f75a2c31, the line names the goal its brief came with as Kosmos's words; also gives the sentence a main verb)
- [NIT] goalAskGaveUp (as iteration 2)
- [NIT] tick still reads the starter brief each tick (negligible)
- [NIT] the line had no main verb --> FIXED (01f75a2c31)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** iteration 2's warning re-found; the fix had removed the claim but left the premise unguarded, so treated as new
- [WARNING] isStarter's trust in made.via 'kosmos' needs a pin --> FIXED (1c78abc8ad, a test fails if any other shipped source writes the mark; mutation second-writer red)
- [NIT] goalAskGaveUp (as iteration 2), GOAL_MAX (as iteration 3), brief and room-note wording still say "work with you" (not contradictory)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.
- [NIT] "answer them" fits a message better than a task
- [NIT] the seeded Done line is also Kosmos's words
- [NIT] the seed-mark guard reads one source spelling and needs git
- [NIT] isStarterGoal's re-normalisation could say why it exists

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/projects.js:3580 | BRANCH | starter line contradicts tasks once work exists | FIXED | a9a622d095 |
| 2 | 1 | WARNING | engine/starter-8832.test.js:84 | BRANCH | real-project control not through tick | FIXED | a9a622d095 |
| 3 | 2 | WARNING | engine/projects.js:3578 | BRANCH | unguarded claim about made.via writers | FIXED | bbde6f546c |
| 4 | 3 | WARNING | engine/projects.js:3580 | BRANCH | line vs goal ask on a person-written goal | FIXED | 2396956f2f |
| 5 | 4 | WARNING | engine/projects.js:4008 | BRANCH | rewrite timing vs immediate Assigner change | DEFERRED | plan records it; safe direction |
| 6 | 5 | WARNING | engine/projects.js:3580 | BRANCH | seeded goal indistinguishable to the agent | FIXED | 01f75a2c31 |
| 7 | 6 | WARNING | engine/projects.js:3584 | BRANCH | seed-mark premise unpinned | FIXED | 1c78abc8ad |

### NITs (non-blocking, across all iterations)
- subtask and --who lines under the starter project (1, 3)
- goalAskGaveUp not gated; a stored give-up clears within a day (2, 5, 6)
- mutations live outside the repo (2)
- isStarterGoal re-normalises whitespace (3, 7)
- WELCOME_DESCRIPTION under GOAL_MAX, covered by the fixture assertion (3, 6)
- homeForFirstAgent duplicates the match (4)
- assertion message placement (4)
- tick reads the starter brief each tick (5)
- "answer them" and the seeded Done line wording (7)
- the seed-mark guard reads one spelling (7)

### Strengths (across all iterations)
- The gate lives in goalProject, shared by tick, step and runOnce (5, 6, 7)
- Every test has a control that can come out the other way, and the goal test reads the real seeded brief (1-7)
- isStarter uses the same mark as homeForFirstAgent; a renamed or person-made project is the person's own (1, 3, 7)
- The rename and test-flag edits re-tell members, so the line follows the fields isStarter reads (7)
