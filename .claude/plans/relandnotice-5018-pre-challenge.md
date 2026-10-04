---
pre_challenge: true
method: challenge-loop
branch: relandnotice-5018
diff_hash: 52a97205a5524bac6b79b47cafd7b734a982c59865b7be916ba0d577a36fe297
validation: passed (focused node 506/506 after the rebase onto main; browser checks per the plan's Validation section and the commit trailers)
subdir_audit: passed
timestamp: 2026-10-03T02:58:25Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 found no BLOCKER or WARNING; NITs recorded below, none taken)
**Total findings:** 3 WARNINGs (iteration 1: 1, iteration 3: 2), all FIXED; NITs as listed
**Fixed:** 3 | **Deferred:** 0 | **Asked (awaiting user):** 0

Scope: re-land of #5063 (reverted from 0.7.19 by #5077 because render-gutter-return-4506 G3b's precondition went red).
Iterations 1 and 3 were opus reviewers, 2 and 4 sonnet, each a fresh blind agent on the branch head of the time.
Findings for iterations 1-3 are taken from the fix commits' own messages (4c87b38df, 03b6e0260 before the rebase).

## Iteration 1 (opus)
- [WARNING] The sticky Settings nav (#s-nav, #4979) is offset only by --apphead-h, so a floating notice covers its
  first pills. FIXED: #s-nav top adds var(--topnotes-h); snav-loose counts the stack; an observer on #topnotes keeps
  it current; a floating-notice arm in render-snav-head-4979 (its mutant, the term removed, fails both engines).
- [NIT] The gutter band comment stated an unmeasured cause. FIXED: it states only the measured scroll start.

## Iteration 2 (sonnet)
- No BLOCKER or WARNING.

## Iteration 3 (opus)
- [WARNING] The floating-notice arm was flaky: the 5s status poll empties #login-adv-slot. FIXED: own slot div.
- [WARNING] The Allow card (#askcard, a security decision) could be painted over by a floating notice. FIXED:
  margin-top calc(10px + var(--topnotes-h)), asserted in the arm; its mutant fails both engines (run 21:47 CDT).
- [NIT] README row and docblock stale. FIXED. (Severity of this one is my reading of the fix commit, not recorded at the time.)
- [NIT] Consolidated-view cover of the Settings panel top: ACCEPTED, the ruled design (notices float, X closes).

## Iteration 4 (sonnet)
- [STRENGTH] The float has no layout cost; --topnotes-h is kept current on show, dismiss, wrap and resize.
- [STRENGTH] Dismissal key, storage fallback and focus handling are sound; engine generation counter is correct.
- [STRENGTH] Each changed browser check can fail on the defect it guards.
- [NIT] Desktop scroll-padding base 132px can leave a focused element ~4px under the stack. Not taken (rescue only).
- [NIT] The z-index 10 rule does not cover the wide agent Talk view. Not taken; no defect observed.
- [NIT] The arm unhides #askcard by hand; a paintAsk run could flake the control. Not taken: it would fail loudly.
- [NIT] Without ResizeObserver --topnotes-h stays 0. Not taken.

## Final Ledger
| Iteration | Blockers | Warnings | Fixed |
|---|---|---|---|
| 1 | 0 | 1 | 1 |
| 2 | 0 | 0 | 0 |
| 3 | 0 | 2 | 3 |
| 4 | 0 | 0 | 0 |
