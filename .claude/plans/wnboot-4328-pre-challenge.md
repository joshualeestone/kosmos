---
pre_challenge: true
method: challenge-loop
branch: wnboot-4328
diff_hash: 358e2f5719aa32902f33637364e3cc8f0cedf1e779443bf3e35afc0c36e663bc
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T12:29:19Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (6.0's initial validation passed at be00e0d62, hash fdfc2ba916fa, so both iterations are blind reviews)
**Converged:** Yes
**Total findings:** 6 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs)
**Fixed:** 1 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (no loop fix commit existed yet)
- [WARNING] docs/browser-checks/render-boot-no-flash.js:134 — arm C's fixed 2 s wait starts at domcontentloaded, but the 3 s fallback starts earlier, while the page script runs, leaving under a second of margin; a slow runner could lift the cover first and false-red correct code --> FIXED (commit 29dded7d8): arm C reads 700 ms after /api/whats-new is answered. Re-measured: fix passes all four arms; main fails arm C on both counts (opened under the cover; recorded as seen while it was up). The plan now states both race directions.
- [NIT] the PASS line described two arms --> FIXED (29dded7d8): it names A, B, C and D.
- [NIT] the tips route glob would miss a query string --> FIXED (29dded7d8): tips and What's New routes match on pathname.
- [NIT] the first-run-not-done-after-the-fallback path is not covered --> recorded in the plan as not covered and unreachable today (a fresh install has no `seen` and returns before any window).
- [NIT] the unit test's fake document matches the exact selector string — fails in the safe direction (red on a rewrite); noted, not changed.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.
- [NIT] render-boot-no-flash.js:142 — the 700 ms wait could be a named constant like DELAY_MS — not changed.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | docs/browser-checks/render-boot-no-flash.js:134 | BRANCH | arm C's fixed wait races the 3 s fallback | FIXED | 29dded7d8 |

### Final validation (6j)
- HEAD 29dded7d8: yarn type-check, lint-fix, test (11186 tests, 11021 pass, 0 fail, 165 skipped), build: PASSED, hash 358e2f5719aa. Subdir CLAUDE.md audit: passed. Browser-check surface gate and coarse gate: pass (render-boot-no-flash.js updated on the branch).

### Evidence beyond the suite
- Unit test: the #4328 cover test FAILS against main's page ("the window opened under the boot cover"); control passes on both.
- Browser check, sandboxed boards started by hand from each checkout: fix passes A, B, C, D; main fails C twice and passes A, B, D.

### NITs (non-blocking, across all iterations)
- fake-document selector coupling (iteration 1)
- first-run-after-fallback path not covered, unreachable today (iteration 1)
- 700 ms could be a named constant (iteration 2)

### Strengths (across all iterations)
- One clause in held(), not wnCovered(), so key and focus ownership are unchanged, with the reason in the comment (iterations 1, 2).
- The typeof document guard matches its siblings, so the lifted-function tests that pass no document are unaffected (iterations 1, 2).
- Layered pins with controls that can fail: a deterministic unit test plus a real-browser arm; the seen POST never reaches the shared board (iterations 1, 2).
- The plan corrects the card's 35 s claim against the real 3 s fallback and names its weakest part (iterations 1, 2).
