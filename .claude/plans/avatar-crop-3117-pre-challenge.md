---
pre_challenge: true
method: challenge-loop
branch: avatar-crop-3117
diff_hash: 35f7452a9c5320a5d7fcabb438c8a737b55c31692d3a803e30585a0fa747a577
validation: passed
subdir_audit: passed
timestamp: 2026-09-16T00:41:31Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 1 BLOCKER, 1 WARNING, 1 CONVENTION, 1 synthetic-validation, 4 NITs (plus 9 STRENGTHs)
**Fixed:** 3 | **Deferred:** 2 | **Asked (awaiting user):** 0

This loop earned its keep: the iteration-2 blind review caught a real BLOCKER
(a card-listed surface, `.onode`, wrongly excluded on an unmeasured premise) and
a WARNING that measurement resolved (`.lav.youav` already square, correctly left
out). Two models witnessed convergence (opus iter2/iter4, sonnet iter3).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** n/a (6.0 initial validation + audit pass)
**New findings:** 0
**Self-generated:** 0 (nothing committed yet by the loop)
- Baseline validation PASSED (7580 tests pass / 0 fail) and subdir audit PASSED.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 1 CONVENTION, 2 NITs (+ 1 synthetic validation finding raised at 6g)
**Self-generated:** 0 of the above (the reviewer's findings were about pre-existing / branch code, not loop output)
- [BLOCKER] web/index.html:1487 - `.onode` exclusion rested on a false premise; the real org-chart avatar is an HTML <img> (paintOrg) governed by `.onode .face img`, not the SVG face() gauge --> FIXED (commit 8e0b8bca): applied the one-liner, re-measured 44x161 -> 44x44 (control bites)
- [WARNING] web/index.html:532 - `.lav.youav img` still pins height:100% --> DEFERRED: measured 56x56 both arms (no bug); also a .lav surface out of this card's scope. Reverted the edit I briefly made.
- [CONVENTION] .claude/plans/avatar-crop-3117.md - filename omits -timestamp --> DEFERRED: pre-challenge-gate hook hard-requires the bare <branch>.md form
- [BLOCKER] initial-validation (6g, synthetic) - #2518 surface gate red: `.onode` change touched a surface render-dm-badges-2863.js maps --> FIXED (commit 8e0b8bca): added `Browser-check-surface: render-dm-badges-2863.js` trailer (the change resizes the org-node avatar img only; cannot move/zero the DM badge)
- [NIT] test positive-match regexes are whitespace/order brittle (mirrors existing avatar-crop test) --> recorded
- [NIT] plan filename convention --> same as the CONVENTION above

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs (re-raised the deferred plan-filename one), 1 NIT
**Self-generated:** 1 of the below (the youav exclusion COMMENT was loop-authored prose)
**Duplicates of prior findings:** 1 (plan filename, already DEFERRED)
- [NIT] the stated MECHANISM for excluding `.lav.youav` was "only half right" --> FIXED (commit 21085bf4): replaced the unverified mechanism in the plan and test comment with the two-arm measurement only, asserting no mechanism (kosmos#120-safe: do not ship a confident behavior claim a check cannot back)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.
- [NIT] test positive-match brittleness (duplicate of iter-2 NIT; consistent with repo pattern) --> recorded
- [NIT] `.att-pic img` still has height:100% - reviewer CONFIRMS it is correctly out of scope (a rectangular attachment thumbnail, not a circular avatar) --> no action; useful confirmation the class scope was right

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 2 | BLOCKER | web/index.html:1487 | BRANCH | .onode wrongly excluded; org avatar is HTML img | FIXED | 8e0b8bca |
| 2 | 2 | WARNING | web/index.html:532 | BRANCH | .lav.youav still height:100% | DEFERRED | measured 56x56 both arms (no bug); .lav, out of scope |
| 3 | 2 | CONVENTION | .claude/plans/avatar-crop-3117.md | BRANCH | filename omits -timestamp | DEFERRED | pre-challenge-gate requires bare <branch>.md |
| 4 | 2 | BLOCKER (synthetic) | 6g #2518 surface gate | BRANCH | onode surface change staled render-dm-badges-2863.js | FIXED | 8e0b8bca (per-check trailer) |
| 5 | 3 | NIT->prose | web.avatar-crop-surfaces-3117.test.js | SELF | youav exclusion mechanism half-right | FIXED | 21085bf4 (stated as measured, dropped mechanism) |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] test positive-match regexes are whitespace/property-order brittle (iter 2, 4) - accepted; mirrors web.consolidated-avatar-crop.test.js, and the negative-control block is the robust guard
- [NIT] `.att-pic img` retains height:100% (iter 4) - correctly out of scope (rectangular thumbnail)

### Strengths (across all iterations)
- The .onode exclusion correction was traced and re-measured (44x161 -> 44x44), not assumed (iter 2, 3, 4)
- All 6 changed selectors trace to distinct real containers sharing the exact grid-auto-row mechanism; pre-fix heights reproduce as width*(44/12) (iter 3)
- Each of the 6 rules appears exactly once - no duplicate/override re-pins height:100% (iter 3, 4)
- Negative control provably fails: 0-pass against pre-fix origin/main, 7-pass on the branch (iter 3, 4)
- .lav.youav exclusion states the two-arm measurement as evidence rather than an unpinned mechanism (iter 4)
- Browser-check + Browser-check-surface trailers present for the #1720 and #2518 gates (iter 4)
