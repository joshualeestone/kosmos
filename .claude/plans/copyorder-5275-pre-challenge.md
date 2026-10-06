---
pre_challenge: true
method: challenge-loop
branch: copyorder-5275
diff_hash: ad0d318a6a0c0690f4ffadaf6fd7f12352d2076d568a2627b1313e7b3c9ba3bf
validation: not run locally (suite queue). Run instead: web.federation-3312.test.js 22/22 (from the worktree) after every round; page script parses (node --check) after every round. render-federation-invite-4649 (with S1-S5 per screen) queued in the light lane; CI's browser-checks runs it on the PR.
subdir_audit: not run (same queue)
timestamp: 2026-10-06T07:49:22Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4: no blocking issues; three low notes, kept)

#### Iteration 1 (opus)
- [MEDIUM] F1 focus taken 3 s after the press (field.focus on the timeout path) --> FIXED (copyFocusStillOn: only if focus is still on the button or nowhere)
- [MEDIUM] F2 the select-the-code fallback was untested --> FIXED (S2 asserts the whole code is selected; S1 is the control, nothing selected)
- [LOW] F3 busy flags not cleared on reset --> FIXED
- [LOW] F4 a refusal right after an earlier late write landed contradicts the clipboard --> DEFERRED (needs the sheet's clipboard record with copy/blur listeners; on the card)
- [LOW] F5 the order lives in two places (fedCopyText) --> KEPT SEPARATE (reasons on the card; both orders pinned by arms)
- [LOW] F6 S4 could pass without the limit firing --> FIXED (asserts nothing written at the limit)

#### Iteration 2 (sonnet)
- [MEDIUM] an old press's finally cleared the new press's busy flag after a reset --> FIXED (busy keyed on the code text)
- [LOW] a re-minted code ignored for up to 3 s --> FIXED (same change)
- [LOW] S2's focus branch unexercised on hidden fields --> KEPT (selection assertion works on hidden inputs; focus cannot move to a hidden field, noted)
- Found while adding S5: an old code's late write left a newer "Code copied." standing --> FIXED (COPY_LATE_OLDER, the sheet's rule)

#### Iteration 3 (opus)
- [HIGH] an old code's clipboard write landing INSIDE its limit was dropped silently, and S5 would fail every run --> FIXED (copyTextOrdered resolves 'exec' | 'clip' | false; 'clip' for an old code says COPY_LATE_OLDER; S4 covers after the limit, S5 inside it; untilLine reports a timeout)

#### Iteration 4 (sonnet)
- NO NEW ISSUES at blocking severity. Traced old press (exec / clip in time / clip late / refused) x newer press (exec / clip / held / none) x reset: the final line is true about the clipboard in every case. Low notes kept: COPY_LATE_OLDER says "late" for an in-time write that came after a newer copy (still true about the clipboard); a refusal after focus moved selects without focusing (review 1's choice); the unit harness stubs exec and the wording (the browser check covers both).
