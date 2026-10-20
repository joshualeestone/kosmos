---
pre_challenge: true
method: challenge-loop
branch: wn-0761
diff_hash: 5dccd9d33218b229b31c58f05471cab2df84416dbd00e018c313d049c0be7db6
validation: passed (Mortals, 22476 tests, 0 failed)
subdir_audit: passed
timestamp: 2026-10-20T12:45:53Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 2 (1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 4 NITs)
**Fixed:** 2 | **Deferred:** 0 | **Asked (awaiting user):** 0

Initial validation ran on Mortals in parallel with iteration 1 (the local queue had 6+ runs ahead). The first run, on
dc4496bb38, was stopped by me once iteration 1 showed it could only end red (no Browser-check trailer); the run on
c973827e84 is the one recorded: status clean, not skipped.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (no loop commit existed yet)
- [BLOCKER] web/whats-new.json (commit dc4496bb38): web/ changed with no docs/browser-checks/ change and no
  Browser-check trailer, so tools/lib/browser-check-gate.sh (run-tests.sh:640) refuses the branch (reviewer measured
  gate rc=1) --> FIXED (c973827e84: render-whatsnew-title-6299 run on this branch, all pass in Chromium and WebKit,
  title "Kosmos has been updated to 0.7.61"; trailer added; the gate now passes, the reviewer's run being the red arm)
- [WARNING] .claude/plans/wn-0761.md:3-6: the plan did not say whether any of 0.7.55 to 0.7.59 reached Mac prod,
  which the tool asks about when lastProd skips versions --> FIXED (c973827e84: stated, with its evidence)
- [NIT] release/whats-new-pool.json:760-768: key order of a marked-shown item differs from its siblings (markShown
  appends keys)
- [NIT] .claude/plans/wn-0761.md:12-15: the fixes named in "no new pool item" carry no card numbers

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [NIT] .claude/plans/wn-0761.md: the 0.7.55 to 0.7.59 premise could not be checked from latest.json alone
- [NIT] web/whats-new.json: "after a minute with no code" is a product claim carried from the pool, not re-checked
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/whats-new.json | BRANCH | No Browser-check trailer; gate refuses | FIXED | c973827e84 |
| 2 | 1 | WARNING | .claude/plans/wn-0761.md:3 | BRANCH | Prod history 0.7.55 to 0.7.59 not stated | FIXED | c973827e84 |

### NITs (non-blocking, across all iterations)
- [NIT] release/whats-new-pool.json:760 - key order after markShown (iteration 1)
- [NIT] .claude/plans/wn-0761.md:12 - no card numbers for the listed fixes (iteration 1)
- [NIT] .claude/plans/wn-0761.md - prod-history premise rests on notes and the pool (iteration 2)
- [NIT] web/whats-new.json - a pool line's timing claim not re-checked (iteration 2)

### Strengths (across all iterations)
- The built list equals choose(readPool(pool), 5) on the committed pool; the cut-off at rank 3 vs 4 is clear (iteration 1)
- The five 0.7.60 titles marked shown are exactly main's 0.7.60 file; lastProd 0.7.54 -> 0.7.60 (iterations 1, 2)
- whats-new-check passes for mac (5) and windows (4); 66 What's New tests pass; no em dash in any spelling (1, 2)
