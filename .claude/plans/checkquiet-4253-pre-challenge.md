---
pre_challenge: true
method: challenge-loop
branch: checkquiet-4253
diff_hash: 14db9a563602ac93210d4f38f82624247003f89054eaa1e7bef908903b05ca81
validation: passed
subdir_audit: passed
timestamp: 2026-10-06T13:16:50Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (the original 10-02 branch's review, then the reconciliation with #5350 on 10-05)
**Converged:** Yes
**Fixed:** all findings | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: full validation on Mortals at 67c063984 (post-cut): 15696 tests, 0 fail, 0 cancelled, ENTRY status clean.
Tooling and tests only (tools/fed-own-e2e.js, tools.browser-checks-quiet-4253.test.js, plan): no browser run needed.
Merge-tree onto current main: 0 conflicts; no file overlaps with main's changes since the merge base.

### Per-Iteration Breakdown

#### Iteration 1 (10-02, as recorded in .claude/plans/checkquiet-4253.md)
- [WARNING] fixture boards run directly phoned home (fresh install ids) --> FIXED by the lib block, since superseded by #5350
- [WARNING] tools/fed-own-e2e.js builds its boards' env from nothing, so the lib never reached them --> FIXED: all three
  dead addresses set in boardEnv

#### Iteration 2 (10-05 reconciliation with #5350)
- [WARNING] this branch duplicated #5350's lib change, with a weaker rule (kept any caller address) --> FIXED: its lib
  block dropped; main's #5350 version stands
- [NIT] its five guard tests overlap #5350's in part --> accepted: they add a control that the exposure is real, the
  runner/lib address agreement, and the federation proof's boards
- Checked: all five pass on main's lib, with #5350's guard, browser-checks-home-3675 and no-phone-home-4253.
- Checked: the not-covered case (a board a person starts by hand from a header recipe) is stated in #5350's comment.
