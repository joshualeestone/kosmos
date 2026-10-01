---
pre_challenge: true
method: challenge-loop
branch: gutter-4506
diff_hash: 40aac7ca42250251d81a13680c41b56b7ade5fb0835a1493590b41c741bdb8a4
validation: passed
subdir_audit: passed
timestamp: 2026-09-30T11:40:53Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (converged at 6; a final-validation gate finding, then rounds 7 and 8)
**Converged:** Yes
**Total findings acted on:** 2 BLOCKERs, 12 WARNINGs, 6 CONVENTIONs, many NITs
**Fixed:** all BLOCKERs and CONVENTIONs, all WARNINGs but one duplicate-deferred residual | **Deferred:** 1 (dialog over the tour's dim, or two stacked dialogs: the page is dimmed twice beside a once-dimmed gutter) | **Asked:** 0

Final validation (6j): 11,915 tests, 11,750 pass, 0 fail; both browser-check gates pass; subdir audit clean; hash 1a35955b7d02.
Main was merged in twice (the second after #4512/#4494 landed; reason-grep counts re-measured 208->211, 126->128). A scratch
merge with current main passes reason-grep and fixture-discipline.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [BLOCKER] web/index.html dialog rule - a short page showed a band of canvas under the body, dimmed twice --> FIXED (9d9e71fe): the body fills the window while a dialog is up, the tour's own approach
- [WARNING] docs/browser-checks/render-dialog-gutter-4506.js - no short-page arm --> FIXED (9d9e71fe)
- [WARNING] web/index.html - dialog rules not limited to classic-scrollbar machines --> FIXED (9d9e71fe)
- [WARNING] tour plus dialog, or stacked dialogs: page dimmed twice beside a once-dimmed gutter --> DEFERRED: rare, closer than the bright strip, CSS cannot count stacked layers
- [NIT] a dialog inside a hidden section --> FIXED (9d9e71fe) with `:not([hidden] *)`

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (plus 1 duplicate), 1 CONVENTION, 3 NITs
**Self-generated:** 0
- [WARNING] WebKit acceptance of the selector --> CHECKED: Playwright WebKit 26.5 accepts and applies it; the Mac floor reasoned from support dates
- [CONVENTION] stale pass count in the plan --> FIXED (1c59f686)
- [NIT] README row; arms for a dialog in a hidden section and for no classic mark --> FIXED (1c59f686)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 1 (the header pointed at a note my iteration-1 edit removed)
- [WARNING] the harness scrollbar shows canvas on a scrolling page --> FIXED (bfbaf8c4) by scoping the claims
- [WARNING] the hidden-section control could not fail --> FIXED (bfbaf8c4)
- [CONVENTION] header pointed at a removed note --> FIXED (bfbaf8c4): now #4542
- [NIT] surface token plus-lost-modal --> FIXED (bfbaf8c4)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [WARNING] Talk view at phone width: no exemption like the tour's --> FIXED (88e43aaf)
- [WARNING] the dialog rule overrode the tour's canvas --> FIXED (88e43aaf): `:not(.tip-dimming)`

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 (the Talk comment from iteration 4)
- [WARNING] the Talk exclusion covered 40 to 56rem where Talk keeps a gutter; its comment was false --> FIXED (6ab03200): only the min-height skips Talk
- [WARNING] Talk and tour exclusions had no arm --> FIXED (6ab03200): arms added, each red when its exclusion is removed
- [NIT] dark arms weak; #4494 references --> FIXED (6ab03200)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
**Converged** (first time). Final validation then refused on the browser-check surface gate (8 checks sharing tokens).

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 0 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 1 (my first per-check trailers)
- [BLOCKER] commit trailers - named the checks without `.js`, so the surface gate matched none --> FIXED (98617c8f): trailers with `.js`; the gate then passes (all 8 checks run on this branch and pass)
- [CONVENTION] the scope note was false for Windows (the win32 scrollbar has a transparent track) --> FIXED (98617c8f)
- [NIT] plan counts; the Talk arm pins the selector only --> FIXED (98617c8f)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html dialog rule | BRANCH | short page double-dim band | FIXED | 9d9e71fe |
| 2 | 1 | WARNING | render-dialog-gutter-4506.js | BRANCH | no short-page arm | FIXED | 9d9e71fe |
| 3 | 1 | WARNING | web/index.html | BRANCH | not limited to classic scrollbars | FIXED | 9d9e71fe |
| 4 | 1 | WARNING | web/index.html | BRANCH | tour or stacked dialogs double-dim | DEFERRED | rare; closer than the strip |
| 5 | 3 | WARNING | render-dialog-gutter-4506.js | BRANCH | claims wider than the harness | FIXED | bfbaf8c4 |
| 6 | 3 | WARNING | render-dialog-gutter-4506.js | BRANCH | hidden-section control could not fail | FIXED | bfbaf8c4 |
| 7 | 3 | CONVENTION | render-dialog-gutter-4506.js | SELF | pointed at a removed note | FIXED | bfbaf8c4 |
| 8 | 4 | WARNING | web/index.html | BRANCH | Talk phone height | FIXED | 88e43aaf |
| 9 | 4 | WARNING | web/index.html | BRANCH | overrode the tour canvas | FIXED | 88e43aaf |
| 10 | 5 | WARNING | web/index.html | SELF | Talk exclusion too wide, false comment | FIXED | 6ab03200 |
| 11 | 5 | WARNING | render-dialog-gutter-4506.js | BRANCH | exclusions untested | FIXED | 6ab03200 |
| 12 | 7 | BLOCKER | commit trailers | SELF | surface trailers lacked .js | FIXED | 98617c8f |
| 13 | 7 | CONVENTION | render-dialog-gutter-4506.js | BRANCH | scope false for Windows | FIXED | 98617c8f |

### NITs (non-blocking, across all iterations)
- comment block maps three rules in one run of sentences; an awkward header sentence (iteration 8)
- the harness sets data-scrollbar-classic itself (named as the weakest premise) (iterations 2, 8)

### Strengths (across all iterations)
- the check reads real gutter pixels against a real 15px scrollbar, every arm with a control that can fail (iterations 5 to 8)
- every rule perturbed on a scratch copy reds its own arms; a dead mask was removed rather than shipped (iterations 1, 5)
- the eight surface-mapped checks run on this branch and pass, render-boot-no-flash against a sandboxed board (iteration 7)
