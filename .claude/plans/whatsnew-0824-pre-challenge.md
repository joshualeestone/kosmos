---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0824
diff_hash: 1c04c91e4049b2ea53e266263f1a6fab0f0df7ffad5780a7a4bd4511a2a8c5d7
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-11-25T19:41:07Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 4 (0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 9 NITs across the three rounds)
**Fixed:** 3 WARNINGs and 5 NITs | **Deferred:** 1 (a repeat of a fixed WARNING) | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] release/whats-new-pool.json ("A wait outlives a /clear"): one note covered four PRs but left out #9056 (Grok and Gemini keep the wait) --> FIXED (4b84cd5d7c)
- [NIT] .claude/plans/whatsnew-0824.md: say the check takes no --platform=linux --> FIXED (4b84cd5d7c)
- [NIT] release/whats-new-pool.json (#9044 line): "or something else" covers the other cases --> no change needed
- Also in 4b84cd5d7c, not a finding: Renet Tilley's lines for #9031 and #9038 (m6678), confirmed by her review (m6684, plan 1e30c17d30).

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the wait note's since, written in iteration 1)
- [WARNING] release/whats-new-pool.json ("A wait outlives a /clear"): since 0.8.23, but its two-reminder limit (#9058, PR #9073) merged after the 0.8.23 freeze --> FIXED (1ba71f3b22): split into a 0.8.23 note and a 0.8.24 note
- [WARNING] .claude/plans/whatsnew-0824.md:4: said 0.8.24 "carries" createdead-9031, which was not on main --> FIXED (1ba71f3b22): the cut requires its merge sha
- [NIT] #9044 line said the card shows it; it is the status pill's hover --> FIXED (1ba71f3b22): "Hovering an agent's status"
- [NIT] "reminded of its own wait twice" read as twice per /clear --> FIXED (1ba71f3b22, in the split)
- [NIT] #9038 line wider than the PR ("after you sign in again") --> FIXED (1ba71f3b22): "once it is signed in again elsewhere"
- [NIT] #9031 line: the card half is fullest on the Mac --> no change (acceptable as written, per the reviewer)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 1
- [WARNING] #9031 line true only once createdead-9031 is on main --> DEFERRED: duplicate of iteration 2's second WARNING, confirmed resolved (the plan gates the cut on that merge)
- [NIT] plan bullet order; [NIT] the 0.8.24 note's wording; [NIT] message ids a later reader cannot open --> not changed
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | release/whats-new-pool.json | BRANCH | wait note missing #9056 | FIXED | 4b84cd5d7c |
| 2 | 2 | WARNING | release/whats-new-pool.json | SELF | wait note since 0.8.23 for a 0.8.24 change | FIXED | 1ba71f3b22 |
| 3 | 2 | WARNING | .claude/plans/whatsnew-0824.md:4 | BRANCH | plan claimed the fix was carried | FIXED | 1ba71f3b22 |
| 4 | 3 | WARNING | release/whats-new-pool.json | BRANCH | #9031 line needs the fix merged | DEFERRED | duplicate of 3, resolved |

### NITs (non-blocking, across all iterations)
- Iteration 1: #9044's "or something else" (kept).
- Iteration 2: #9031's card half is fullest on the Mac (kept).
- Iteration 3: plan bullet order; the 0.8.24 note's wording; chat message ids in the plan (kept).

### Strengths (across all iterations)
- Every new line was checked against its PR; titles and lines are within the engine's limits; no em dash in any spelling (iterations 1 to 3).
- `since` stamps checked against the 0.8.23 pin by ancestry (iteration 3).
- Every PR merged since the 0.8.23 What's New is accounted for (iterations 2 and 3).

### Validation
Full validation on Mortals at 1ba71f3b22 (base fdac85902d): 31,278 tests, 0 failed; entry status clean, hash
1c04c91e4049, equal to this proof's diff hash.
