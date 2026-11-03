---
pre_challenge: true
method: challenge-loop
branch: tasknudge-7869
diff_hash: e3eb4cf85326292116cccaa6bae9c9f8ab05c86b8956344435c07957db1bc48d
validation: passed
subdir_audit: passed
timestamp: 2026-11-03T20:14:30Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (opus and sonnet alternating)
**Converged:** No. Stopped at the standing 8-round review cap (Splinter 2026-10-22: "Past 8, continue ONLY while a
BLOCKER is open; file nits and warnings as a follow-up card and ship"). No BLOCKER is open after round 8; its warnings
describe intended behaviour and are now written in the plan.
**Total findings:** 2 BLOCKERs, 19 WARNINGs, 1 CONVENTION, 22 NITs (as raised)
**Asked (awaiting user):** 0
**Self-generated (6c-bis):** not computed; every Origin is BRANCH by the fail-safe default. Rounds 3 and 5 each
corrected a claim an earlier round of this loop wrote (the meaning of `queued`, and "adding the rest reopens the task").

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] tasks.js: the built refusal held double quotes, which the Mac CLI's sed reader cuts at, so agents saw the sentence end before the command --> FIXED (3c14d7e; tests pin no double quote; the real sed line checked)
- [BLOCKER] messages.js: the same for the react refusal --> FIXED (3c14d7e)
- [WARNING] built check ran before the not-on-this-project check --> FIXED (3c14d7e)
- [WARNING] no test of what the CLI receives --> FIXED in part (no-quote assertions); route test DEFERRED (no agent in the harness)
- [NIT] held note shown to its recipient --> FIXED (3c14d7e); claim wording; self-take wording --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] other undelivered states revealed to the recipient --> FIXED (4801007, an allowlist)
- [NIT] multi-word placeholder; comment placement; plan test count; test order --> FIXED (4801007)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] the allowlist missed a held note typed later (held-delivered row) and misread `queued` --> FIXED (f817ca1)
- [WARNING] a test pinned the wrong meaning of queued; a comment claimed it --> FIXED (f817ca1)
- [WARNING] no route-level test --> DEFERRED (harness)
- [NIT] stored project id; trailing full stop after the command; plan quote style --> FIXED (f817ca1)

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] self-take refused --> DEFERRED: intended (re-giving one's own part is not a move); plan says so (7ace8c6)
- [WARNING] names in the command could break it --> DEFERRED: agent names are [a-z0-9_-] (create.js NAME_RE)
- [NIT] sender arm comment --> FIXED (7ace8c6)

#### Iteration 5
**Reviewer model:** opus
- [WARNING] the sentence and plan claimed `task add --parent` reopens the task; it makes a separate open task --> FIXED (b4cbebf, the claim deleted, a test pins what the command does)
- [WARNING] a person's CLI give was refused too --> FIXED (b4cbebf, named agents only)
- [NIT] shadowed name; webhook ordering note; re-give test --> FIXED (b4cbebf)

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] the older part/:id/who route passed no `by`, so agents bypassed the refusal there --> FIXED (e62a511)
- [WARNING] the guard depends on identifying the caller --> FIXED in the plan (e62a511)

#### Iteration 7
**Reviewer model:** opus
- [WARNING] part/:id/who read a refused token as the person --> FIXED (f9b1dd5, answered 403/503 as task/assign)
- [WARNING] recipient matched by exact name --> DEFERRED: fails safe; the room listing matches the same way; in the plan
- [NIT] one roster read; test name --> FIXED (f9b1dd5)

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] the part route's 403/503 and movedBy are undocumented --> FIXED in the plan (688ca68)
- [WARNING] a name longer than WHO_MAX --> DEFERRED: impossible (names are at most 32, WHO_MAX is 80)
- [NIT] CLI form of the suggested command --> it takes the project id, as the instructions show
**Stopped** at the 8-round cap with no open BLOCKER.

### Validation
Final full validation (6j) on 688ca68, run detached through detached-validate.sh: unit 26,842 tests, 0 failed; every
shell shard green; validation PASSED (hash e3eb4cf85326), subdir audit clean. Mutants were run on every fix.

### Strengths
- The refusal is narrow: a named agent's give of an open part on a built task. The person's give, taking off, re-giving
  one's own part, and an unbuilt give are unchanged, each with a control test.
- A private note's existence is never shown to anyone but its two parties, and to the recipient only once it reached them.
- Both sentences reach the agent whole through the CLI's sed reader.
