---
pre_challenge: true
method: challenge-loop
branch: openai-reveal-3321
diff_hash: 097d4b46eab190fec0d4d5fbd2a4e439cf419348c07b8040022b9293257c9e01
validation: passed
subdir_audit: passed
timestamp: 2026-09-19T22:12:50Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 6 (0 BLOCKERs, 1 WARNING, 3 CONVENTIONs, 2 NITs)
**Fixed:** 2 | **Deferred:** 1 (the no-plan-file CONVENTION, deduped across all 3 iterations) | **Asked (awaiting user):** 0

Change under review: a single cut-time-only browser-check, `docs/browser-checks/render-openai-install-refusal.js`. It timed out for 30s on ARM 4 (the Settings-screen click of `#acct-openai-install-go`), blocking the Mac 0.6.82 staging cut. Root cause is test sequencing, not a product race: first-run opens on boot on `file://`, its `.fr-back` overlay sits at z-index 60 and `frOpen` marks every `body > *:not(#firstrun)` element `inert`, so ARM 4 was exercising the Settings modal while first-run still covered it and held it inert. The button and handler are correct (a native click paints the refusal and re-enables the button; the modal renders as designed). The fix calls the app's real `frClose()` before ARM 4 to reproduce the real user flow (first-run dismissed, then Settings), and asserts the postcondition (overlay hidden, background no longer inert). No `web/index.html` change.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0 of the above (ITER_COMMITS empty on the first reviewer pass; 6.0 passed clean, so no loop fix commit existed yet)
- [CONVENTION] .claude/plans/ — No plan file for this branch --> DEFERRED (night-shift cut-blocker; branch created off origin/main from a handoff to unblock the Mac cut; single-file test-harness fix, no plan warranted)
- [NIT] render-openai-install-refusal.js — `typeof frClose` guard silently no-ops if frClose is renamed; failure would be a generic click timeout, not a clear diagnostic --> FIXED (commit 9cd936af4: added an explicit frClose-presence check)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION (dup), 1 NIT
**Self-generated:** 1 of the above (the WARNING is on the frClose-presence check that iteration 1 added; blame attributes it to loop commit 9cd936af4 — it is a code finding, fixed normally)
**Duplicates of prior findings:** 1 (the no-plan-file CONVENTION, already DEFERRED)
- [WARNING] render-openai-install-refusal.js:171 — The check name "first-run can be dismissed (frClose present)" overstates coverage: it only proves frClose exists and did not throw, never that `#firstrun` hid or `inert` cleared; a partial-frClose regression would pass this named check silently --> FIXED (commit f28c707f5: assert the postcondition overlayHidden && !backgroundInert)
- [NIT] render-openai-install-refusal.js:178 — failure-detail string largely restates the block comment --> FIXED (absorbed by f28c707f5: the detail is now the observed overlayHidden/backgroundInert values)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION (dup), 1 NIT
**Self-generated:** 0 acted on as SELF
**Duplicates of prior findings:** 1 (the no-plan-file CONVENTION, already DEFERRED)
**Converged** — no new actionable findings. The lone NIT is a latent-drift caution (the `backgroundInert` probe assumes `#acct-add-modal` stays a direct body child) which the reviewer explicitly marked "no change required"; guarding a hypothetical future refactor would over-couple the test, so it is recorded and not fixed.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/ | BRANCH | No plan file for this branch | DEFERRED | Night-shift cut-blocker off origin/main; test-harness-only fix |
| 2 | 1 | NIT | render-openai-install-refusal.js | BRANCH | frClose guard silently no-ops if renamed | FIXED | 9cd936af4 |
| 3 | 2 | WARNING | render-openai-install-refusal.js:171 | SELF | Check name overstates what it verifies (presence only, not postcondition) | FIXED | f28c707f5 |
| 4 | 2 | NIT | render-openai-install-refusal.js:178 | SELF | Failure-detail string restates the comment | FIXED | f28c707f5 (absorbed) |
| 5 | 2 | CONVENTION | .claude/plans/ | BRANCH | No plan file (dup of #1) | DEFERRED | Same as #1 |
| 6 | 3 | CONVENTION | .claude/plans/ | BRANCH | No plan file (dup of #1) | DEFERRED | Same as #1 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] render-openai-install-refusal.js — `backgroundInert` probe assumes `#acct-add-modal` remains a direct child of `<body>`; a future refactor nesting it could make the assertion vacuous (iteration 3). Recorded, no change: guarding it now over-couples the test to current DOM structure, and such a refactor would change the first-run inert mechanism this check depends on anyway.

### Strengths (across all iterations)
- Root-cause diagnosis verified against the actual markup/CSS: `.fr-back` z-index 60 vs `.rm-back` z-index 50, `frOpen`/`frClose` toggling `inert` on all body children, first-run auto-opening on the `file://` boot path (iterations 1, 2, 3).
- `frClose()` is synchronous, so no race with the subsequent reveal/stub-arm/click (iteration 2).
- The fix ENABLES ARM 4 rather than weakening it: the Settings refusal assertions still run and still fail if the handler regresses; arms 1-3 are untouched (iterations 1, 2, 3).
- Clear diagnostics on app drift ("window.frClose is gone: the app's first-run exit changed") and observed-value failure detail (iterations 1, 3).
