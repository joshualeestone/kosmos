---
pre_challenge: true
method: challenge-loop
branch: railnotice-6347
diff_hash: 876516636bb28ac0493a2170ae2363df39d55ee0476f06953d1446903da410e6
validation: passed
subdir_audit: passed
timestamp: 2026-10-17T08:23:24Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9
**Converged:** Yes
**Total findings:** 13 (0 BLOCKERs, 11 WARNINGs, 1 CONVENTION, 1 synthetic validation BLOCKER; plus about 20 NITs)
**Fixed:** 13 | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: the 6.0 run queued at 00:20 was killed by a restart and requeued, then stopped by me before iteration 1's
edits (it had not started). 6g after iteration 7 failed on one test (synthetic finding below), fixed in 4f94c880f6. 6j
passed on HEAD 4f94c880f6: hash 876516636bb2, 21409 tests, 21165 pass, 0 fail, 0 cancelled, 244 skipped
(environment-only arms, the same 244 as other runs on this Mac), audit rc 0. Browser checks run on this branch
(frozen 45554ebf18, 01:31 CDT): render-projects (new #6347 arm, light and dark, at the default window and at 560px),
render-project-done-4583, render-shell-noscroll-4872, render-allagents-4812, render-phone-offline-718, all PASS.

**Self-generated (all iterations):** not computed. The 6c-bis blame lookup was not run during this loop, so the
Origin column below is BRANCH for every finding (the fail-safe value) and no per-iteration SELF count is claimed.
Reasoned, not measured: from iteration 2 on, most findings cited lines of the browser-check arm this loop wrote, and
every one was a code finding fixed normally, not a prose claim deleted under 6e.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] web/index.html:5365 - `scrollbar-width: thin` turns off the #3443 win32 thumb --> FIXED (67f5deb902; unit test forbids any scrollbar-width, mutation-checked)
- [WARNING] web/index.html:5362 - comment "stays VISIBLE" false on macOS overlay scrollbars --> FIXED (claim deleted; the cue filed as #6349)
- [WARNING] web.project-notice-3923.test.js:453 - only CSS text is checked, never the layout --> FIXED (render-projects #6347 arm)
- [NIT] 40vh on short windows; [NIT] keyboard reach of clipped rows (rows carry buttons: not an issue)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] render-projects.js - the arm never ran and could fail on viewport --> FIXED (b6e4ba74d2: a control on the same box; run later at 01:31)
- [WARNING] render-projects.js - innerHTML restore drops focus, live region announces --> FIXED (b6e4ba74d2: only copies removed, aria-live off meanwhile)
- [WARNING] web.project-notice-3923.test.js:453 - regex ignores the html prefix and the 960px block --> FIXED (b6e4ba74d2: full selector, brace depth 1 with comments stripped; two mutants red on the right assertion)

#### Iteration 3
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Duplicates:** 1 (the arm has not run)
- [WARNING] web/index.html:5365 - a fixed 40vh can still run under the list on a short window --> FIXED (7ec62448ac: the arm also reads at 560px tall; passed there at 01:31)
- [NIT] aria-live restore writes "null" if absent --> acted on (7ec62448ac)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] render-projects.js - the 560px resize is not in a try/finally --> FIXED (5b8b2e0b80)

#### Iteration 5
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Duplicates:** 1 (the arm has not run)
- [WARNING] render-projects.js - control and cap fold into one FAIL line --> FIXED (0beaba71f6: separate lines)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] render-projects.js - viewportSize() can be null --> FIXED (b40ce3893b: fallback)
- [WARNING] render-projects.js - a fixed 12 copies can be too few --> FIXED (b40ce3893b: grow until the content outruns the window, at most 60)

#### Iteration 7
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 3 NITs
**Duplicates:** 1 (the arm has not run; resolved by the 01:31 run)
- [CONVENTION] commit trailers - no Browser-check record of a render-projects run --> FIXED (018ac88814: trailers for all five checks, after running them)
- [NIT] two comment/plan wraps --> acted on (45554ebf18)

#### 6g after iteration 7 (synthetic)
- [BLOCKER] initial-validation-equivalent: `browser-checks-reason-grep.test.js` SITE_COUNTS said render-projects has 7 finding-emit sites; the arm made it 9 --> FIXED (4f94c880f6). The 18-file static browser-check set (161 tests) then passed from the worktree.

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** on the tree before the SITE_COUNTS fix; that fix changed code, so iteration 9 reviewed it.

#### Iteration 9
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:5365 | BRANCH | scrollbar-width thin disables the win32 thumb | FIXED | 67f5deb902 |
| 2 | 1 | WARNING | web/index.html:5362 | BRANCH | "stays VISIBLE" false on macOS | FIXED | 67f5deb902 (cue: #6349) |
| 3 | 1 | WARNING | web.project-notice-3923.test.js:453 | BRANCH | layout never measured | FIXED | 67f5deb902 |
| 4 | 2 | WARNING | render-projects.js | BRANCH | arm unrun, viewport-dependent | FIXED | b6e4ba74d2 |
| 5 | 2 | WARNING | render-projects.js | BRANCH | innerHTML restore | FIXED | b6e4ba74d2 |
| 6 | 2 | WARNING | web.project-notice-3923.test.js:453 | BRANCH | regex scope | FIXED | b6e4ba74d2 |
| 7 | 3 | WARNING | web/index.html:5365 | BRANCH | fixed 40vh on short windows | FIXED | 7ec62448ac, measured 01:31 |
| 8 | 4 | WARNING | render-projects.js | BRANCH | viewport restore not in finally | FIXED | 5b8b2e0b80 |
| 9 | 5 | WARNING | render-projects.js | BRANCH | control and cap on one FAIL line | FIXED | 0beaba71f6 |
| 10 | 6 | WARNING | render-projects.js | BRANCH | viewportSize null | FIXED | b40ce3893b |
| 11 | 6 | WARNING | render-projects.js | BRANCH | fixed copy count | FIXED | b40ce3893b |
| 12 | 7 | CONVENTION | commit trailers | BRANCH | no recorded browser run | FIXED | 018ac88814 |
| 13 | 6g | BLOCKER | browser-checks-reason-grep.test.js | BRANCH | SITE_COUNTS 7 vs 9 | FIXED | 4f94c880f6 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- overflow-y: auto makes overflow-x auto too (iterations 2, 5, 6, 7; no case seen)
- a rewrite of the notice resets its scroll position (iteration 5; same as other repainted areas)
- the first commit message still says "visible (thin)" (iterations 2, 8, 9; the merge is a squash)
- copies, aria-live restore could sit in a try/finally (iteration 9; nothing in that span throws)
- windows under 560px tall unmeasured (iteration 9; stated in the plan)
- the FAIL line could name "fixture too short" (iteration 8)

### Strengths (across all iterations)
- one scoped rule inside the 960px consolidated block, :not(:empty), fold-a still wins (every iteration)
- the arm grows the notice from the page's own row, measures synchronously, removes only its copies, restores aria-live and the viewport, and has a control on the same box (iterations 4 to 9)
- the plan names its weakest premise and what would change the call, and corrects its own first citation (iterations 3 to 9)
