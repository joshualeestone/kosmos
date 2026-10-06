---
pre_challenge: true
method: challenge-loop
branch: gutter-5379
diff_hash: b2d9a685613293059e599c0ce2331830be635d2df6aa8cac1a50dff360418426
validation: passed (Mortals full suite at 15b24b89c, hash b2d9a6856132, EXIT=0 16:59; the full browser run on GitHub, run 37480015468 at 4e02ae993, passed every check; 15b24b89c adds only commit trailers)
subdir_audit: passed
timestamp: 2026-10-06T19:42:25Z
iterations: 18
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 18 (1 to 16 a forked, NOT blind self-review loop, disclosed; 17 a blind opus review that trimmed the diff to its table; 18 a blind opus review of the trimmed head)
**Converged:** Yes, at iteration 18 (no BLOCKER or WARNING)
**Fixed:** every BLOCKER and WARNING | **Deferred:** NITs below | **Asked (awaiting user):** 0
**Design:** Mona Lisa chose "no jump" and approved the padding approach (09:26)

### Per-Iteration Breakdown

#### Iterations 1 to 16 (forked self-review, not blind)
- grew the change from 9 lines to 237 lines, mostly fixing its own additions; stopped, and judged by a blind review

#### Iteration 17 (opus, blind)
- approved the padding fix; about half the diff was scope creep --> TRIMMED to its keep/cut table (144 lines; the scrollbar measurer is main's again)

#### Iteration 18 (opus, blind): CONVERGED
- three one-line mutations each red the 2624 check (the whole-page selector, the bar's padding in kplusBarFit, the consolidated header selector)
- overlay-scrollbar Macs unchanged (width 0); phones untouched (desktop-only rules); no padding counted twice
- [NIT] the measurer's early-return comment predates #5379's use of the width in consolidated --> NOT TAKEN now (a code change would void the queued validation); recorded
- [NIT] the plan's Evidence still says the CI pair is pending --> answered here: control run 37470242516 (base) failed 2624 with 9 problems; fix run 37480015468 (4e02ae993) passed 2624 and the whole full browser run; the nightly on main (#5410, run 37492682694) fails 2624 the same way
- [NIT] 56rem to 960px with consolidated chosen: already listed under Not measured

### Weakest premise
That GitHub's macOS runner's Chromium stands for Windows WebView2, the product's classic-scrollbar platform; Windows itself is not measured.
