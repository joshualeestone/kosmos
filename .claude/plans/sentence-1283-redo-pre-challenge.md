---
pre_challenge: true
method: challenge-loop
branch: sentence-1283-redo
diff_hash: 0ee99059d6c442fb8de90befeb19e895f6e4621d57c2588b48a38ac74fe67a80
validation: passed
subdir_audit: passed
timestamp: 2026-09-09T07:46:25Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (the second blind review produced zero BLOCKER/WARNING/CONVENTION; one NIT, fixed)
**Total findings:** 2 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs), plus one synthetic validation finding
**Fixed:** all | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial-validation fail path)
**Reviewer model:** n/a (the initial validation failed before the first blind review, per 6.0)
The initial approach delegated seven inline sentence-dressers to the shared `asSentence()` helper. 6.0 validation FAILED for two distinct reasons, both addressed:
- **[BLOCKER] initial-validation (Origin BRANCH):** 14 term-composer tests failed. web.term-compose-967.test.js LIFTS individual functions out of web/index.html and evals them in an isolated `new Function` scope (e.g. `lift(SCRIPT,'placedWords')`); a function that now calls `asSentence` throws ReferenceError there because the helper is outside the lifted region. FIXED by reverting to SELF-CONTAINED inline stop-guards at the three bug sites (memWhy, the tunnel status line, placedWords) and leaving the other five sites as main has them, so no cross-function dependency is introduced and the lifting harness is untouched. Confirmed against main: those 12 tests pass 12/12 on main and now pass on this branch.
- **[BLOCKER] initial-validation (Origin BRANCH):** the #1720 browser-check gate red the web/ change ("touches web/ but updates no docs/browser-checks assertion"). FIXED by adding a `Browser-check:` commit trailer: this is a behavior-only stop-guard with no rendered/layout change beyond removing a doubled full stop in an edge case, covered by the web.term-compose-967 unit tests, and this session has no Playwright.

#### Iteration 2 (first blind review, inline version)
**Reviewer model:** sonnet (general-purpose subagent)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (the reviewer read the current inline code; the classifier found no loop-authored prose claim)
The blind reviewer verified all three inline guards per-site: correct guard for terminated vs unterminated input; memWhy preserves the trailing space in both branches; testing the pre-capitalization variable is sound (capitalizing charAt(0) cannot change the final char); balanced parens/valid JS; self-contained (no external helper); byte-identical output for the common no-terminal-punctuation case; the role/TITLE capitalizer left unchanged; no em dashes.
- [NIT] .claude/plans/sentence-1283-redo.md: the "Done when" line still described the rejected asSentence approach ("seven sites call asSentence, 7 insertions/8 deletions") --> FIXED (corrected to the shipped inline approach, 3 insertions/3 deletions).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html (7 sites) | BRANCH | asSentence delegation throws in the isolation-test lift scope (14 tests) | FIXED | reverted to inline self-contained stop-guards |
| 2 | 1 | BLOCKER | (branch, web/ gate) | BRANCH | #1720 browser-check gate red on the web/ change | FIXED | Browser-check trailer (behavior-only, covered by unit tests) |
| 3 | 2 | NIT | .claude/plans/sentence-1283-redo.md | BRANCH | plan Done-when described the rejected approach | FIXED | corrected to inline |

### NITs (non-blocking)
- Plan Done-when wording (iteration 2) - fixed.

### Strengths (across iterations)
- All three inline guards are correct and behavior-preserving, matching the pattern the other five dressers already use; the doubled-stop bug (`..`) is fixed with no other behavior change (iteration 2).
- Self-contained: no cross-function dependency, so the string-lifting test harness is untouched (iteration 2).
- The role/TITLE capitalizer is correctly left unconverted (iteration 2).

### Validation
- Node suite: 5360 pass, 0 fail. Browser-check gate: passed (via the trailer). Subdir audit: passed (no CLAUDE.md changed). Final hash 0ee99059d6c4.
