---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0830
diff_hash: 83556c698d385e1fce19e6a0792c87fdca226ed7c1c606b41a778fe7adbaeac2
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-11-28T02:47:56Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 8 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 7 NITs, plus strengths)
**Fixed:** 3 | **Deferred:** 5 | **Asked (awaiting user):** 0

Validation: full validation on Mortals at 8f3c574f3a, rc 0, entry clean, hash 83556c698d38 equal on both sides;
31,862 node tests, 0 failed; test:shell 4 shards all green. An earlier run of the same head was red on 1 test
(server.phonenotify-718 "a hung tunnel times out", 400 !== 200) and the file alone was 52/52 five times; filed as
kosmos#9251 (the test keeps its 500 ms request timeout for its second call). What's New tests by name: 74 pass, 0 fail.
The line was checked against the merged code by its feature's author, PigeonPete.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] .claude/plans/whatsnew-0830.md:20 - "What's New tests by name: see the commit" pointed at evidence the commit does not carry --> FIXED (8f3c574f3a): the plan lists the six test files and 74 pass
- [NIT] .claude/plans/whatsnew-0830.md:22-24 - #9237 and #9222 are in the window and neither noted nor rejected --> FIXED (8f3c574f3a): both rejected with reasons
- [NIT] release/whats-new-pool.json:3037 - "removes agents that have not run for the days you pick" does not list the agents it keeps --> FIXED (8f3c574f3a): the plan records why (the 140 limit; the Settings section states them all); line unchanged, and PigeonPete confirmed it as written
- [NIT] release/whats-new-pool.json:3055 - "unanswered messages" is the person's messages specifically --> FIXED (8f3c574f3a): "the person's messages it has not answered"

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [NIT] release/whats-new-pool.json (kosmos post --file) - the file must be in the agent's Files folder or a project's --> DEFERRED: notes-only, "one of their own files" is true; kosmos post --how says where
- [NIT] release/whats-new-pool.json (restart greeting) - Windows `kosmos away` not traced --> DEFERRED: iteration 1 traced it (the Windows hook calls /api/away, which builds the open-work text board-side)
- [NIT] .claude/plans/whatsnew-0830.md - the 142/138 character note --> no change: consistent, as the reviewer says
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | .claude/plans/whatsnew-0830.md:20 | BRANCH | plan pointed at a test list the commit lacks | FIXED | 8f3c574f3a |

### NITs (non-blocking, across all iterations)
- [NIT] plan: #9237 and #9222 not addressed (iteration 1, fixed)
- [NIT] pool: idle-retire line does not list what it keeps (iteration 1, recorded in the plan)
- [NIT] pool: "unanswered messages" scope (iteration 1, fixed)
- [NIT] pool: kosmos post --file scope (iteration 2, deferred)
- [NIT] pool: Windows kosmos away not traced (iteration 2, deferred; traced in iteration 1)
- [NIT] plan: character counts (iteration 2, no change)

### Strengths (across all iterations)
- The highlight is true on every platform shown: the Idle agents section sits in Settings > Automation with no platform hide; off by default; DAY_CHOICES 14/30/60/90; Restore via the board's own Remove, which has win32 paths (iterations 1, 2)
- The two notes-only lines describe code on both CLIs (iteration 1)
- build recorded prod 0.8.29 and Windows prod 0.8.29 itself and marked the heavy-job line shown (iterations 1, 2)
- The Browser-check trailer is true: data only, no markup change (iterations 1, 2)
