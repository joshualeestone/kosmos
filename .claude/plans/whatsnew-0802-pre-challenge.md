---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0802
diff_hash: b468b3c6f15f2154a3f80ee3820c228f379505f3f88598491aef07129fbc661d
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-11-10T04:01:34Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 1 BLOCKER, 5 WARNINGs, 0 CONVENTIONs, 10 NITs
**Fixed:** 4 | **Deferred:** 2 | **Asked (awaiting user):** 0

**Validation, stated exactly.** The full suite ran once, at convergence, on Mortals: entry status clean, hash b468b3c6f15f, 28357 tests, 27873 pass, 0 fail, 0 cancelled, 484 skipped. The change is data only. Each iteration that changed the data ran tools/whats-new-pool.js build and tools/whats-new-check.js for both platforms. 6.0 and 6g did not run the suite: it ran once at convergence, as the 0.8.01 pool did. The 6j helper skipped on the clean entry, rc 0.

**Convergence, stated exactly.** Round 4 raised one WARNING, on the Mac tag of the two-copies line. It is the same concern at the same place as round 2's NIT, the plan names it as its weakest premise, and the reviewer states the tag is right today. I treated it as a duplicate of an accepted item, not as new. That is my call and the weakest point of this convergence. Round 3 independently checked the same tag and found it right.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] release/whats-new-pool.json:1611 - title "Every agent's edits" false for Meta, which has no edit hook --> FIXED (922c15958a), later removed with #6
- [WARNING] release/whats-new-pool.json:1612 - Grok claim false on Windows --> FIXED (922c15958a), later removed with #6
- [NIT] release/whats-new-pool.json:1551 - "fold the column away" overstates a fold to avatars --> taken (922c15958a)
- [NIT] release/whats-new-pool.json:1559 - two copies covers only some agent families; reasoned --> left
- [NIT] release/whats-new-pool.json:1586 - "until the first answer" reads badly --> taken (922c15958a)
- [NIT] release/whats-new-pool.json:1639 - community counts line omitted the 2-hour limit --> taken (922c15958a)
- [NIT] release/whats-new-pool.json:1438 - keep account and model is not always true under a company list --> taken (922c15958a)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] release/whats-new-pool.json - nine items carry since 0.8.02 though already in the 0.8.01 staging build --> DEFERRED: by design, stated in the plan; the same call 0.8.01 made
- [NIT] release/whats-new-pool.json - Mac tag on two copies rests on reading twinSessions --> left, named in the plan
- [NIT] release/whats-new-pool.json - "daily sentence" slightly broader than the code --> left

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1 of the above (the BLOCKER: line 1612 was last touched by iteration 1's fix)
- [BLOCKER] release/whats-new-pool.json:1612 - the edits note is false on Windows for GPT and Antigravity --> FIXED (6b7e2fef92): the note is DELETED, per the rule for a claim the loop itself wrote. It had broken in two consecutive rounds, and nothing an agent does depends on it
- [WARNING] .claude/plans/whatsnew-0802.md:6 - #8326 had no row --> FIXED (6b7e2fef92)
- [NIT] release/whats-new-pool.json:1594 - kosmos room needs its project id --> taken (6b7e2fef92)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs new after deduplication, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 1 (the Mac tag on two copies, see Convergence above)
- [NIT] release/whats-new-pool.json - "tells who checked it" slightly loose; holds as written --> left
- [NIT] release/whats-new-pool.json - computer control line is for the two-computer case, which it says --> left
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | release/whats-new-pool.json:1611 | BRANCH | Title overclaims for Meta | FIXED | 922c15958a |
| 2 | 1 | WARNING | release/whats-new-pool.json:1612 | BRANCH | Grok false on Windows | FIXED | 922c15958a |
| 3 | 2 | WARNING | release/whats-new-pool.json | BRANCH | since 0.8.02 on items in the 0.8.01 build | DEFERRED | By design, in the plan |
| 4 | 3 | BLOCKER | release/whats-new-pool.json:1612 | SELF | Edits note false on Windows for GPT and Antigravity | FIXED | 6b7e2fef92, note deleted |
| 5 | 3 | WARNING | .claude/plans/whatsnew-0802.md:6 | BRANCH | #8326 had no row | FIXED | 6b7e2fef92 |
| 6 | 4 | WARNING | release/whats-new-pool.json | BRANCH | Mac tag on two copies | DEFERRED | Duplicate of round 2's item; plan's weakest premise; reviewer says right today |

### NITs (non-blocking, across all iterations)
- Five in iteration 1, four taken and the two-copies families note left.
- Two in iteration 2, both left.
- One in iteration 3, taken.
- Two in iteration 4, both left.

### Strengths (across all iterations)
- build 0.8.02 --offline reproduces web/whats-new.json byte for byte (iterations 1, 2, 3 and 4).
- The notesOnly flags and ranks behave as choose expects (iterations 1, 2 and 4).
- The since 0.8.02 premise was checked against the staging manifest: the nine PRs are ancestors of b32a67b7d9 (iteration 3).
- The plan accounts for each PR left out, with a reason (iterations 1, 2 and 4).
