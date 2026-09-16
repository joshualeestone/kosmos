---
pre_challenge: true
method: challenge-loop
branch: fix-3134-createsave-nav
diff_hash: 3a9e47fd51167143324d8da12ad9779665ebc075b7a6550ef2f31ab8e4d02cdb
validation: passed
subdir_audit: passed
timestamp: 2026-09-16T02:28:58Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 10 (3 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs) plus 6 STRENGTHs
**Fixed:** 7 | **Deferred:** 3 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation fix-and-validate pass)
**Reviewer model:** opus (orchestrator's own 6.0 pass, no blind reviewer yet)
**New findings:** 2 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 (no loop fix had committed yet; both synthetic findings are BRANCH by instruction)
- [BLOCKER] browser-checks-reason-grep.test.js -- initial-validation: #1864 catch-site count stale (82 -> 83) for the new render-pjcreate-nav-3134.js single-line top-level .catch --> FIXED (cfc618d1)
- [BLOCKER] web.consolidated-980.test.js -- initial-validation: pjMarkOpen(null) close-path pin stale (6 -> 7) for #3134's create-returns-to-list --> FIXED (cfc618d1)

#### Iteration 2 (first blind review)
**Reviewer model:** sonnet (a different model from iteration 1, per 6a)
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 (all cited lines blame to 4c4a408a, the branch content under review, not a loop fix commit)
**Duplicates of prior findings:** 0
- [BLOCKER] web/index.html -- the save auto-advance timer (btn.__navTimer) was cleared only on the success path, so a second save click within the ~1s window (no-op, field/engine refusal, network error, read-back failure) returned early and left the prior timer armed; it then fired and yanked the person off the screen the second click just put them on --> FIXED (454af995): clear it unconditionally at the top of the handler.
- [WARNING] render-pjsettings.js -- the no-op-save assertion runs only after the prior save's navigation completed, so it cannot catch the interleaved-timer bug --> FIXED (454af995): added an interleaved-save guard (a no-op second save within the window cancels the advance and stays on settings).
- [WARNING] render-pjcreate-nav-3134.js -- the plan claimed coverage for the read-back-failure fallback but the check only drove the happy path --> FIXED (454af995): added a fallback arm (routes the POST to the read-back-failed shape; the openProject else branch lands on the list with the "could not read it back" notice).
- [NIT] web/index.html -- duplicate pjById lookup --> FIXED (454af995): named the boolean (const created).
- [NIT] render-pjcreate-nav-3134.js -- redundant child_process re-require --> FIXED (454af995): destructured execFileSync.

#### Iteration 3 (second blind review)
**Reviewer model:** opus (rotated back per 6a, so convergence is witnessed by two distinct models)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
**Converged** -- no new actionable findings; three NITs, all deferred with reasoning (below).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | browser-checks-reason-grep.test.js | BRANCH | #1864 catch-site count stale (82->83) for new check | FIXED | cfc618d1 |
| 2 | 1 | BLOCKER | web.consolidated-980.test.js | BRANCH | pjMarkOpen(null) pin stale (6->7) for create-returns-to-list | FIXED | cfc618d1 |
| 3 | 2 | BLOCKER | web/index.html:39017 | BRANCH | auto-advance timer cleared only on success path | FIXED | 454af995 |
| 4 | 2 | WARNING | render-pjsettings.js | BRANCH | no-op test cannot catch the interleaved-timer bug | FIXED | 454af995 |
| 5 | 2 | WARNING | render-pjcreate-nav-3134.js | BRANCH | read-back-failure fallback not covered | FIXED | 454af995 |
| 6 | 2 | NIT | web/index.html | BRANCH | duplicate pjById lookup | FIXED | 454af995 |
| 7 | 2 | NIT | render-pjcreate-nav-3134.js | BRANCH | redundant child_process require | FIXED | 454af995 |
| 8 | 3 | NIT | web/index.html:39117 | BRANCH | auto-advance does not move focus (focus drops to body) | DEFERRED | see below |
| 9 | 3 | NIT | web/index.html:39106 | BRANCH | auto-advance assumes done editing | DEFERRED | plan weakest-premise #2, Mona-approved |
| 10 | 3 | NIT | render-pjsettings.js:117 | BRANCH | dropped #pj-settings-backname assertion | DEFERRED | low-value; rename now confirmed on #pj-one-name |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, deferred with reasoning)
- [NIT] web/index.html:39117 (iteration 3) -- after the auto-advance timer navigates, focus is on the now-hidden #pjs-save so the browser resets focus to <body>, and a keyboard/screen-reader user loses their place. Real but minor a11y best-practice (not a hard AA failure: focus-to-body on a programmatic route change is a common SPA pattern). DEFERRED because the app does not manage focus on ANY project navigation (click-driven openProject does not either), so a focus-landing fix belongs as a consistent, browser-verified a11y pass across project navigation with the design owner's input, not a blind inconsistent special-case on the one timer path (this night-shift session has no browser to verify focus/SR behavior). Flagged for a follow-up.
- [NIT] web/index.html:39106 (iteration 3) -- auto-advancing ~1s after a save assumes the person is done editing. This is the plan's own documented weakest premise #2 (Mona, design owner, approved; timeout trivially tunable/removable). Noted for Josh's in-app eyeball.
- [NIT] render-pjsettings.js:117 (iteration 3) -- the rewrite dropped the old #pj-settings-backname label assertion. Low-value coverage reduction: the manual back link is still exercised and the rename is now confirmed on #pj-one-name (more meaningful).

### Strengths (across all iterations)
- The clearTimeout(btn.__navTimer) sits at the very top of the save handler, before every early-return path, so a second click in the ~1s window cancels a prior pending advance regardless of branch; the fired timer re-checks PJ_VIEW/PJ_CURRENT/pjById so a manual navigation, project switch or deleted project all no-op it; the button is disabled during the fetch so handlers are strictly sequential (no concurrent-timer race). (iterations 2, 3)
- live (#pjs-save-live) is captured before paintProjectSettings clears it and set after, so the confirmation lands on the visible element; the create path falls back to openProject only on read-back failure, preserving the "could not read it back" notice with no regression. (iteration 3)
- The browser-checks are non-vacuous with dangerous-answer controls in both tab and consolidated views, the interleaved-save guard fails on the pre-fix bug, and the count-pins are measured, not computed. (iterations 2, 3)
