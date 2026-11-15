---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0806
diff_hash: 59c27c13692658132b197eb3f8f448e4a3de27f870c48a64f8a7b2aa2137a6b3
validation: passed
subdir_audit: passed
timestamp: 2026-11-15T23:34:13Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (iteration 1 is 6.0's fix-and-validate pass; blind reviews at iterations 2 and 3)
**Converged:** Yes
**Total findings:** 6 (1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 5 NITs)
**Fixed:** 4 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation)
**Reviewer model:** none (validation helper)
**New findings:** 1 BLOCKER, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above (6.0's synthetic finding is BRANCH by instruction)
- [BLOCKER] initial-validation: tools.shell-shard-4317.test.js (#1720 web gate) failed: web/whats-new.json changed with no browser check and no `Browser-check:` commit trailer --> FIXED (85d68e5244: the trailer added to the data commit's message; the failing file alone then 24/24, the full suite then passed)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (the amend in iteration 1 made 85d68e5244 the blame owner of every pool line; the content predates the loop, and the fix removed a claim rather than writing a new one)
- [WARNING] release/whats-new-pool.json:2037 - the leftover-delete item (#8504) was tagged windows and said "On Windows", but engine/delete-leftover.js's plan fingerprint and its refusal have no platform check and the shared web/index.html sends it back --> FIXED (225e7ba47b: untagged, "On Windows" dropped, plan corrected)
- [NIT] release/whats-new-pool.json:1929 - "What your agents found" implied every call is tracked; only an unknown-tool refusal is recorded automatically --> FIXED (225e7ba47b: "lists what your agents found about a service's actions")
- [NIT] release/whats-new-pool.json:2018 - "up to five agents, or the person" read as five plus one; the cap is five confirmers in total --> FIXED (225e7ba47b)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | tools.shell-shard-4317.test.js | BRANCH | #1720 web gate: no Browser-check trailer | FIXED | 85d68e5244 |
| 2 | 2 | WARNING | release/whats-new-pool.json:2037 | SELF | delete item wrongly Windows-only | FIXED | 225e7ba47b |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- [NIT] release/whats-new-pool.json:1929 - Connections "found" line overstated automatic tracking (iteration 2; fixed in 225e7ba47b)
- [NIT] release/whats-new-pool.json:2018 - records line "five agents, or the person" (iteration 2; fixed in 225e7ba47b)
- [NIT] release/whats-new-pool.json:1920 - two lines sit at exactly 140 characters, so a later edit will trip the build's limit (iteration 3; left: the build refuses loudly, nothing ships wrong)
- [NIT] release/whats-new-pool.json:1940 - "without being marked built" sounds internal; suggested "without a code change" (iteration 3; left: that would be wrong, since "on a note" also closes without a code change, and the three words are the ones the task page itself shows, #8552)
- [NIT] web/whats-new.json - "A little more room between chat lines" and "The restart note says what was checked" leave the window (iteration 3; deliberate rank call, both stay pending, recorded in the plan)

### Strengths (across all iterations)
- The built web/whats-new.json is exactly the tool's output: an offline rebuild from a copy of the pool matched byte for byte (iteration 2).
- Each announced line was checked against its merged commit's code, and the plan accounts for every PR since the 0.8.05 freeze, with reasons for each omission (iteration 2).
- All 0.8.06 lines are within 140 characters, with no em dashes, and platform tags follow the schema (iteration 3).
