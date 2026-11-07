---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0797
diff_hash: 88ce64463f673262bdbbcc064f45cc22cc99a770082686ea55b0b2f04587607a
validation: passed (Mortals, 27938 tests, 0 fail, 0 cancelled, entry status clean 2026-11-07T21:08:35Z)
subdir_audit: passed
timestamp: 2026-11-07T21:09:15Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 13 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 12 NITs)
**Fixed:** 1 WARNING and 5 NITs | **Deferred:** 7 NITs | **Asked (awaiting user):** 0

Iteration 1 found NITs only. Three were fixed, and that changed the bytes, so iteration 2 reviewed the changed diff.
Its WARNING was in iteration 1's own fix. Iteration 3 found NITs only, none false: converged.

Validation ran once on Mortals (mortals-validate, a real run, not a skip). The 6j helper was called once, and its exit
code was read from that call.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [NIT] release/whats-new-pool.json - task show placeholders differ from the CLI's own --> FIXED (15d2d108c5)
- [NIT] release/whats-new-pool.json - "stays as a badge on it" could read as permanent --> FIXED (15d2d108c5)
- [NIT] .claude/plans/whatsnew-0797.md - #8177's reason misstated --> FIXED (15d2d108c5)
- [NIT] release/whats-new-pool.json - streak ranked above Always Allow --> DEFERRED: both Josh-asked; the streak design was drawn for him

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (the streak line, rewritten at 15d2d108c5)
- [WARNING] release/whats-new-pool.json - the streak line said the note stays on the mark all day; the note leaves after about 6 s and a count badge stays --> FIXED (a7e8067a60)
- [NIT] release/whats-new-pool.json - task show title awkward --> FIXED (a7e8067a60)
- [NIT] plan - counts not explained per platform --> DEFERRED: the counts are right

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [NIT] pool - the badge is also new on narrow screens --> DEFERRED: the line says less than the change, nothing false
- [NIT] pool - "that day" holds per browser --> DEFERRED: fine for a one-line summary
- [NIT] pool - "wide screen" means a window over 600px --> DEFERRED: a reader gets it right
- [NIT] plan - the versions entry is not in this repo --> DEFERRED: it lives on the cut box (~/.release-entry-0797.html) and names #8177
- [NIT] plan - "14:2x" is loose --> DEFERRED: the exact comment is on #1050
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 2 | WARNING | release/whats-new-pool.json | SELF | streak line names the note, not the badge | FIXED | a7e8067a60 |

### NITs (non-blocking, across all iterations)
- The streak badge is also new on narrow screens (iteration 3).
- "that day" is per browser, and a tab left open past midnight keeps the badge until the next paint (iteration 3).
- "wide screen" is a window over 600px (iteration 3).

### Strengths (across all iterations)
- web/whats-new.json is byte-identical to `choose(pool, 5)`, and problems() is empty (every round).
- prod-check passes: lastProd 0.7.94 = prod (every round).
- Before-and-after reading against the 0.7.96 bump d61c5fc25f confirmed both items (every round).
- The Browser-check trailer is present on every branch commit (iterations 2, 3).
