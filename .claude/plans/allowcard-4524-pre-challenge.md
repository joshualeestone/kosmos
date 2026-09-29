---
pre_challenge: true
method: challenge-loop
branch: allowcard-4524
diff_hash: c3198169b6921b64f4002fe880ae8839f05d345609b6a5d51c5e3b9e78742eb6
validation: partial (the gated mobile-shots run 16/16 and the focused unit tests; the full suite is left to CI)
subdir_audit: passed
timestamp: 2026-09-29T14:23:34Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 1 actionable (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs), 2 NITs
**Fixed:** 1 | **Deferred:** 0 | **Asked (awaiting user):** 0

**Validation, stated exactly.** The change is one SCREENS entry in `docs/browser-checks/mobile-shots.js`, a README row and the plan. The run that proves it is the screen itself:
- `mobile-shots.js --screens allow-card`, run on Liu Kang's turn ("Johnny go", m3332) through `heavy-gate --twice` (CLEAR), 14:22:14 to 14:22:54Z. It took 16 shots (4 sizes x light / dark x Chromium / WebKit): 0 errors, 0 overflow, exit 0.
- The iPhone 15 dark WebKit shot was looked at: it shows the full request card, with the code and Allow / Deny.
- The red, before the fix, was measured gated at 11:30Z at se / light / Chromium: main's file gave `allow-card ERROR`, exit 2.
- Focused unit tests over the changed files pass: browser-checks-pr-select-4119 (25), browser-checks-reason-grep (5), tools.mobile-shots-desktop (2), tools.mobile-shots-leak-718 (8), render-talk-goldencard-2519 (35, which reads the browser-checks README).
- The full kosmos suite was not run locally: the box is shared turn by turn, and CI runs the suite on the PR.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] docs/browser-checks/mobile-shots.js:171: the fix had been run at one size, theme and engine only; WebKit, where this screen's stub has broken before, was unmeasured --> FIXED by measurement: the full 16-shot sweep above, 0 errors, and the WebKit shot looked at.
- [NIT] docs/browser-checks/mobile-shots.js:166: the comment said "fails if the Allow button is not on screen", but the wait checks rendered-visible, not the viewport --> FIXED (44907970b)
- [NIT] docs/browser-checks/README.md:495: the mobile-shots row did not say the screen opens Settings > Kosmos Plus --> FIXED (44907970b)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above
**Converged:** the reviewer traced `paintAsk` / `plusOnScreen` in web/index.html and confirmed that the new view is necessary and sufficient for the full card.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | docs/browser-checks/mobile-shots.js:171 | BRANCH | full sweep unmeasured (WebKit especially) | FIXED | gated run 16/16, 0 errors, 14:22Z |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- The comment claimed more than the wait checks (iteration 1, fixed)
- The README row (iteration 1, fixed)

### Strengths (across all iterations)
- The two-part selector covers both render sites (the top card with Plus off, and above the connected panel), and neither matches the compact "Review" line, so a wrong screen cannot be photographed silently (iteration 1)
- The route stub is installed before navigation, so the first poll hits it; the WebKit service-worker block is kept (iteration 1)
- The change is confined to test tooling and its documentation; no product code is touched (iteration 2)
