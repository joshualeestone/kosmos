---
pre_challenge: true
method: challenge-loop
branch: pjsave-spinner-2923
diff_hash: 6c4b2e35cb86a02587c719d0af63a2bf62524dc645c08dedee3c36535beff216
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T17:03:57Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 5 (1 BLOCKER, 2 WARNINGs, 1 CONVENTION, 1 NIT)
**Fixed:** 4 | **Deferred:** 1 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0 of the above (ITER_COMMITS empty at this point; 6.0 passed with no commit, so the first reviewer ran against the branch's own work)
- [BLOCKER] web/index.html:36438 (paintProjectSettings) - `#pjs-save-live` not cleared on settings paint, so a prior project's "Saved." survives Back-and-into another project's settings panel --> FIXED (commit 1709fc8d): added an unconditional clear beside the sibling `pjs-members-msg` clear.
- [WARNING] docs/browser-checks/render-pjsettings.js:82 - the check never asserts the Sweep spinner renders while the PUT is in flight, so a dropped-injection regression would still pass --> FIXED (commit 1709fc8d): delay the PUT 500ms (PUT-only) and assert `#pjs-save-live .spin-sweep` is attached in-flight.
- [WARNING] docs/browser-checks/render-pjsettings.js:82 - the check never reopens a second project, so it cannot see the cross-project staleness --> FIXED (commit 1709fc8d): fixture seeds a second project; after a real save the check opens that project's settings and asserts `#pjs-save-live` is cleared (non-vacuous: a waitForFunction proves "Saved." was set first).
- [CONVENTION] .claude/plans/pjsave-spinner-2923.md - em dashes in the plan author's own prose --> FIXED (commit 1709fc8d): replaced with hyphens. No shipped file was affected.
- [NIT] web/index.html:36663 - the Sweep spinner markup is a fourth inline literal --> DEFERRED: the file's own convention (per the existing call-site comments) is an inline literal, not a helper, for eval-extractability in the isolation test harnesses. A shared helper is warranted only if a fifth call site appears.

#### Iteration 2
**Reviewer model:** opus (different model from iteration 1, per 6a)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings. The reviewer independently traced every spinner return path (no path leaves it spinning; no-op shows no spinner), confirmed poll safety (the poll calls only `paintSettingsFacts`, never `paintProjectSettings`, so "Saved." persists and the new clear respects the editable-half/poll split), confirmed no em dashes, and confirmed the new render-pjsettings assertions can each genuinely fail.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html:36438 | BRANCH | prior project's "Saved." leaks into next project's settings (#pjs-save-live not cleared on paint) | FIXED | 1709fc8d |
| 2 | 1 | WARNING | docs/browser-checks/render-pjsettings.js:82 | BRANCH | in-flight spinner not asserted (dropped-injection would pass) | FIXED | 1709fc8d |
| 3 | 1 | WARNING | docs/browser-checks/render-pjsettings.js:82 | BRANCH | no cross-project staleness test | FIXED | 1709fc8d |
| 4 | 1 | CONVENTION | .claude/plans/pjsave-spinner-2923.md | BRANCH | em dashes in plan prose | FIXED | 1709fc8d |
| 5 | 1 | NIT | web/index.html:36663 | BRANCH | fourth inline Sweep-spinner literal | DEFERRED | file convention is inline literal for test eval-extractability |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] web/index.html:36663 - fourth inline Sweep-spinner literal (iteration 1) - deferred per the file's inline-literal convention.

### Strengths (across all iterations)
- Every spinner-injecting return path clears or replaces the spinner; the spinner is injected only past the no-op early return, so "Nothing has changed." shows no spinner (iterations 1 and 2, independently).
- Accessibility split: decorative spinner is aria-hidden, only the "Saved." text change in the aria-live region is announced; refusals announce once via the separate #pjs-msg region (iterations 1 and 2).
- The test-window widen in web.desc-error-1303g.test.js is not vacuous: the target regex sits at offset 4387 and the next listener at ~6886, so the 5000 window includes the branch and stays within the one handler (iterations 1 and 2).
- The injected spinner markup is byte-identical to the two canonical call sites, keeping the inline-loader pattern consistent (iteration 2).
