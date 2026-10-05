---
pre_challenge: true
method: challenge-loop
branch: importname-4962
diff_hash: 6bdabbb5cfbb99d09c20d35d19de90d00a6650b3211a3e26f3dac755b633a90f
validation: passed
subdir_audit: passed
timestamp: 2026-10-05T04:42:13Z
iterations: 12
converged: true
---

## [CHALLENGE-LOOP] Summary

This is the loop run after rebasing onto #5106 (the per-check SITE_COUNTS table); the branch's earlier loop (14
rounds, converged at 13) is recorded in .claude/plans/importname-4962.md.

**Iterations:** 12
**Converged:** Yes (at iteration 11; the full validation then failed, was fixed test-only, and iteration 12 found nothing new)
**Total findings:** 0 BLOCKERs, 21 WARNINGs, 4 CONVENTIONs, many NITs (actionable ones listed below)
**Fixed:** 12 | **Deferred:** 13 (most are repeats of one decided scope) | **Asked (awaiting user):** 0

**Validation:** the first full run on Mortals at 6c38ee52b FAILED 2 of 15,189 (two test sandboxes sliced
importAddsNewVisit without the importAddsDropStuck it now calls). Fixed test-only in c5449e3c0. The full validation
then PASSED on Mortals at c5449e3c0 (hash 6bdabbb5cfbb, ENTRY status clean, base 660788565): 15,189 tests, 14,965
pass, 0 fail, 224 skipped. Subdir audit rc 0. FULL browser checks: queued on Mortals for this head, before merge.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 5 NITs
**Self-generated:** 0
- [WARNING] web/index.html addImportedInPlace: a dropped add that succeeds late, with nothing newer, was not recorded, so the row offered Add again --> FIXED (e98db4617; test)
- [CONVENTION] plan heading said web/index.html only --> FIXED (e98db4617)
- [NIT] frEnterSubmit comments described the code wrongly --> FIXED (e98db4617, claims removed)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] first run's list never dropped a stuck add --> FIXED (e53ee7c80: importAddsDropStuck from frPaintScan; test)
- [WARNING] Enter on adopt rows widens the change --> DEFERRED: decided in the branch's review 1, stated in the PR body, tested

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 1 (the late-fail freeze was reachable because of iteration 2's fix)
- [WARNING] a dropped add that FAILS late froze its row on Adding... --> FIXED (5e34f21b8; test)
- [WARNING] adopt-row Enter --> DEFERRED (as decided)
- [CONVENTION] plan's rebase section stale --> FIXED (5e34f21b8)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0
- [WARNING] the attempt token could repeat within one millisecond --> FIXED (49de8d45d: strictly increasing; sandboxes declare it)
- [WARNING] adopt-row Enter --> DEFERRED (as decided)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] an empty Name field blocked a file the parse can name (a regression against main) --> FIXED (f4d164b06: read first; tests; browser check N2 waits for the answer)
- [WARNING] adopt-row Enter --> DEFERRED (as decided)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0
- [WARNING] importNamesKept read a row before checking it --> FIXED (236ef4a64)
- [WARNING] adopt-row Enter --> DEFERRED (as decided)
- [CONVENTION] a stale proof file committed --> DEFERRED: replaced by this file

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 (iteration 5's path blanked the shown name)
- [WARNING] a parse-named add blanked the pressed row's name and copies showed the slug --> FIXED (2da1af58d: one shown name everywhere; test)
- [NIT] README row's N2 condition --> FIXED (2da1af58d)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0
- [CONVENTION] review-round tags in 13 code comments --> FIXED (b25ac16f3)
- [WARNING] adopt-row Enter; in-flight bookkeeping complexity --> DEFERRED (decided; tested)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 (the defect was on main; this branch's Enter reached it)
- [WARNING] an adopt row refused by connect-agent left its Name field disabled --> FIXED (6c5d45870; pinned)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] a dropped stuck add plus a second press with a different name can make two agents --> DEFERRED: ACCEPTED residual, stated in the plan and PR body (the only guard is the frozen row the drop ends)
- [WARNING] adopt-row Enter --> DEFERRED (as decided)

#### Iteration 11
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
**Converged** (then 6j: the full validation failed 2 tests; fixed test-only in c5449e3c0)

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 actionable (2 WARNINGs and 1 CONVENTION, all repeats of decided items)
**Self-generated:** 0
**Converged:** every test sandbox checked against what its sliced code calls; none missing.

### Final Ledger (actionable)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html addImportedInPlace | BRANCH | late success not recorded | FIXED | e98db4617 |
| 2 | 1 | CONVENTION | plan heading | BRANCH | scope wording | FIXED | e98db4617 |
| 3 | 2 | WARNING | web/index.html frPaintScan | BRANCH | first run kept stuck adds | FIXED | e53ee7c80 |
| 4 | 2 | WARNING | web/index.html importNameEnter | BRANCH | adopt-row Enter scope | DEFERRED | decided, PR body |
| 5 | 3 | WARNING | web/index.html fail() | SELF | late fail froze row | FIXED | 5e34f21b8 |
| 6 | 3 | CONVENTION | plan | BRANCH | stale rebase section | FIXED | 5e34f21b8 |
| 7 | 4 | WARNING | web/index.html attempt token | BRANCH | same-ms tokens | FIXED | 49de8d45d |
| 8 | 5 | WARNING | web/index.html addImportedInPlace | BRANCH | empty field blocked a named parse | FIXED | f4d164b06 |
| 9 | 6 | WARNING | web/index.html importNamesKept | BRANCH | row read before check | FIXED | 236ef4a64 |
| 10 | 7 | WARNING | web/index.html success path | SELF | blank or slug shown name | FIXED | 2da1af58d |
| 11 | 8 | CONVENTION | web/index.html comments | BRANCH | review tags | FIXED | b25ac16f3 |
| 12 | 9 | WARNING | web/index.html adopt Add | BRANCH | field left disabled (main) | FIXED | 6c5d45870 |
| 13 | 10 | WARNING | web/index.html stuck drop | BRANCH | duplicate on a renamed re-press | DEFERRED | accepted residual |
| 14 | 6j | BLOCKER | web.import-name-4962.test.js | SELF | sandboxes missing importAddsDropStuck | FIXED | c5449e3c0 |

### NITs (non-blocking, left for the PR body)
- a new visit can bring back the previous visit's typed text and refusal (the list is not cleared between visits)
- the pressed button's aria-label uses the slug while copies use the shown name
- a contrived late fail after a newer success and a revisit repaints the old reason
- several test titles carry review numbers; some tests assert on page source
- the field is 13px, so iOS zooms on focus (the plan's stated premise)

### Strengths (across all iterations)
- every interpolated value goes through esc(); typed names reach the page only via value and textContent
- the two Enter handlers are kept apart from both sides and tested in listener order, with a control
- per-file add state with a strictly increasing token covers redraws, late success, late failure and a newer attempt
- the browser check blocks service workers (measured WebKit reason), records creates without making agents, and has a named-row control
