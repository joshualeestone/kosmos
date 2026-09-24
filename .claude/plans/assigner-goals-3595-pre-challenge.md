---
pre_challenge: true
method: challenge-loop
branch: assigner-goals-3595
diff_hash: a85666e001f563f49cf4e42f21f6af896c6e503430e2d9335d09c155a3c0d782
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T20:44:40Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (blind reviews in iterations 1 to 4; 6.0 validation seeded one synthetic finding, fixed in iteration 2)
**Converged:** Yes. Iteration 4 returned one NIT and no BLOCKER, WARNING or CONVENTION. 6j passed on HEAD ce544f60 (clean validation record for diff hash a85666e0: 8638 pass, 0 fail, shell tests clean).
**Total findings:** 13 actionable (3 BLOCKERs, 10 WARNINGs, 0 CONVENTIONs) plus 9 NITs
**Fixed:** 11 | **Deferred:** 2 | **Asked (awaiting user):** 0

Validation notes: timing reds during the loop (#1760 scrub in engine/feedbacksend.test.js; #2909 msg stdin in cli.msg-stdin-2909.test.js) were green alone (52/52, 12/12, then 64/64 together), in files this branch does not touch. A 15:09 run hung with six unrelated test files asleep at 0% CPU and a 15:09 rerun red on #! exec tests: both were the Agent1 syspolicyd stall (#3634, recovered 15:13, per Splinter). The run started after recovery is fully clean and is the record 6j skipped on.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 4 WARNINGs, 4 NITs
**Self-generated:** 0 of the above
- [BLOCKER] engine/assigner.js askText: double quotes in the goal could close its quotation and continue in Kosmos's voice --> FIXED (bd70425d): quotes become single quotes; adversarial test
- [WARNING] askText labelled the goal "the person's words" though BRIEF.md is editable by any project member --> FIXED (bd70425d): labelled as text written in BRIEF.md
- [WARNING] a COULD_NOT ask was retried every minute, uncapped --> FIXED (bd70425d): retried after 10 minutes, keeps its hourly charge
- [WARNING] no per-agent ask cap --> FIXED (bd70425d): one per agent per hour
- [WARNING] no adversarial test of the quoting --> FIXED (bd70425d)
- [NIT] hint said "no tasks" (fixed: "no open tasks"); code-unit trim (fixed: by code point); repeated memory literal (fixed: emptyMemory); fenced code in the Goal section (left)

#### 6.0 validation (synthetic)
- [BLOCKER] initial-validation: #1732 Windows lint flagged engine/brief.js fs.constants O_NOFOLLOW / O_NONBLOCK --> FIXED (b7bcfcb0): named locals ORed undefined-safe as securewrite.js, two classified INVENTORY rows; lint passes

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING, 2 NITs
**Self-generated:** 0 of the above
- [BLOCKER] engine/assigner.js step: the assignment caps ran before the ask branch, so a busy fleet never got goal asks --> FIXED (b7bcfcb0): assignment caps gate assignments only; regression test proven by restoring the old order
- [WARNING] natural-language instructions inside a goal can still influence the reading agent --> DEFERRED: quoting and labelling stop it reading as Kosmos; the agent can already read its own project's BRIEF.md, so the ask adds reach, not capability; recorded in the sub-plan with what would change it
- [NIT] control characters in a goal make an undeliverable ask (fixed: stripped); grapheme-cluster trim (left)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 4 NITs
**Self-generated:** 1 of the above (the C0-only strip was written in b7bcfcb0; fixed in code)
- [WARNING] engine/brief.js stripped C0 only; the pane also refuses C1 (e.g. U+0085), so the endless retry remained --> FIXED (ce544f60): C1 stripped, and goalProject checks the finished ask with chat.messageProblem (the pane's own rule) before asking
- [WARNING] one undeliverable project could hold the fleet's ask budget and starve every other project --> FIXED (ce544f60): after MAX_ASK_FAILS (3) undelivered asks a project is left for the day; test shows the other project is then asked
- [WARNING] the once-a-day ask memory does not survive a restart --> DEFERRED: accepted and recorded, as the Recommender's in-process memory; persisting it is more surface than a repeated question is worth
- [NIT] ask promised "you will get the first task" (fixed: Kosmos hands new tasks to idle agents on the project); relative folder (fixed: refused); DELIVERY default (fixed); fenced code (left)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
**Converged** -- no new actionable findings; 6j passed.
- [NIT] tick reads a project's BRIEF.md every tick during its ask cooldown (left: capped, best-effort)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/assigner.js askText | BRANCH | goal quotes escape | FIXED | bd70425d |
| 2 | 1 | WARNING | engine/assigner.js askText | BRANCH | "person's words" overclaims | FIXED | bd70425d |
| 3 | 1 | WARNING | engine/assigner.js runOnce | BRANCH | COULD_NOT retried every minute | FIXED | bd70425d |
| 4 | 1 | WARNING | engine/assigner.js step | BRANCH | no per-agent ask cap | FIXED | bd70425d |
| 5 | 1 | WARNING | engine/assigner.test.js | BRANCH | no adversarial quoting test | FIXED | bd70425d |
| 6 | 1 | BLOCKER | engine/brief.js (lint #1732) | BRANCH | Windows-hostile fs.constants flags | FIXED | b7bcfcb0 |
| 7 | 2 | BLOCKER | engine/assigner.js step | BRANCH | assignment caps gated asks | FIXED | b7bcfcb0 |
| 8 | 2 | WARNING | engine/assigner.js askText | BRANCH | natural-language injection via goal | DEFERRED | accepted residual, recorded in sub-plan |
| 9 | 3 | WARNING | engine/brief.js goalFrom | SELF | C1 characters still refused by the pane | FIXED | ce544f60 |
| 10 | 3 | WARNING | engine/assigner.js goalProject | BRANCH | undeliverable project starves others | FIXED | ce544f60 |
| 11 | 3 | WARNING | engine/assigner.js memory | BRANCH | once-a-day memory in process | DEFERRED | accepted, recorded in sub-plan |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- "no tasks" wording (iteration 1; fixed)
- code-unit trim (iteration 1; fixed by code point)
- repeated memory literal (iteration 1; fixed with emptyMemory)
- fenced code inside the Goal section ends it early (iterations 1, 3; left, fails toward a shorter goal)
- control characters (iteration 2; fixed)
- grapheme-cluster trim (iteration 2; left)
- "you will get the first task" wording (iteration 3; fixed)
- relative folder accepted (iteration 3; fixed)
- DELIVERY default (iteration 3; fixed)
- goal reads during cooldown (iteration 4; left)

### Strengths (across all iterations)
- readGoal: lstat before open, O_NOFOLLOW / O_NONBLOCK undefined-safe, fstat size and type re-checked on the same descriptor, every failure is "no goal" (iterations 1 to 4)
- Ask memory and caps separate from the assignment budget, with a full-flow test (ask, agent adds a task, it is handed out) (iterations 1 to 4)
- The pane's own rule (chat.messageProblem) gates the ask rather than a copy of it (iteration 4)
- Every guard proven load-bearing by removing it; one redundant guard deleted instead of kept (iterations 1 to 3)
