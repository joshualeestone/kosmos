---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0805b
diff_hash: 76386e26635eecf348d838bdfa837c50fbafc53574828da17931e3562c871a1b
validation: passed
subdir_audit: passed
timestamp: 2026-11-13T04:22:23Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 10 NITs
**Fixed:** 3 WARNINGs and 5 NITs | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: full run-tests passed on 6da500307e (hash fce85795f047) and on b287df3df1 (hash 76386e26635e); 6j skipped on that clean entry. A run on 60859063 was stopped part way because its diff was about to change; it records nothing.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [WARNING] .claude/plans/whatsnew-0805b.md:27 - the weakest premise omitted the two lines not yet seen working (Fable 5.2, which leads the window; Linux Settings) --> FIXED (60859063)
- [NIT] rank 103 skipped --> left (no effect)
- [NIT] the Fable item sat after the notesOnly items --> FIXED (60859063, window unchanged byte for byte)
- [NIT] the untagged Linux line will show in Mac and Windows notes beside the 0.8.03 one --> left (by design, precedent 0.8.03)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] release/whats-new-pool.json (#8472 line) - "no longer names the model from before the change" overclaims; the card shows the job's planned model and can still be wrong while a session runs another model --> FIXED (b287df3d)
- [WARNING] release/whats-new-pool.json (#8467 title) - "show their limits" overclaims; the fix stops the old limits showing --> FIXED (b287df3d)
- [NIT] #8485 line: name the same words and place --> FIXED (b287df3d)
- [NIT] #8481 line: the command to paste is the restart row's --> FIXED (b287df3d)
- [NIT] plan: give the iPhone reason --> FIXED (b287df3d)
- [NIT] plan: the leftover-task lines are one story --> left

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** the #8467 and #8472 lines
- [NIT] #8482 line: listed only for a name whose settings were kept
- [NIT] #8481 line: the command shows only when restart needs fixing
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | .claude/plans/whatsnew-0805b.md:27 | BRANCH | weakest premise omits unseen lines | FIXED | 60859063 |
| 2 | 2 | WARNING | release/whats-new-pool.json (#8472) | BRANCH | card model line overclaims | FIXED | b287df3d |
| 3 | 2 | WARNING | release/whats-new-pool.json (#8467) | BRANCH | moved-agent title overclaims | FIXED | b287df3d |

### NITs (non-blocking, across all iterations)
- [NIT] rank 103 unused (iteration 1)
- [NIT] untagged Linux line shows in every platform's notes (iteration 1)
- [NIT] the three leftover-task lines are one story (iteration 2)
- [NIT] #8482 line: settings-kept case only (iteration 3)
- [NIT] #8481 line: command only when restart needs fixing (iteration 3)

### Strengths (across all iterations)
- The committed web/whats-new.json is byte-identical to a fresh build from the pool, and the notes build for mac, linux and windows (iterations 1, 2, 3).
- The plan accounts for all 25 PRs merged after #8444 (iterations 1, 2, 3).
- The Fable line claims only what the menu and the price table show (iterations 1, 3).
