---
pre_challenge: true
method: challenge-loop
branch: anim-3421
diff_hash: af0783a1197e20e6a52024d4c20857ecb1eb727885f724920c9cb5beb7360e81
validation: passed
subdir_audit: passed
timestamp: 2026-09-22T23:39:35Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (3 pre-rebase + 1 post-rebase re-review)
**Converged:** Yes (the post-rebase blind pass returned zero new BLOCKER/WARNING/CONVENTION)
**Total actionable findings:** 1 BLOCKER, 1 WARNING, 1 CONVENTION (+ NITs)
**Fixed:** 3 | **Deferred (reasoned):** 1 (plan filename timestamp, matches mixed repo practice) | **Asked:** 0

Model rotation: opus / sonnet / opus (pre-rebase 1-3), opus (post-rebase re-review). Convergence witnessed by both models.

⚠️ PROCESS NOTE (kept for the record): pre-rebase iterations 1-2 ran on a baseline a trailing
`echo` had MASKED as green (the run_in_background wrapper's exit was the echo's, so the
task-notification said "exit 0" while the suite actually failed). Iteration 2's blind reviewer
surfaced the underlying regression; reading the validation OUTPUT exposed the mask. From then on
the real rc was captured and re-raised, and the true verdict confirmed from the output. This branch
was then rebased onto current origin/main (which merged PR #3410); the only rebase change was
merging #3410's entry into the tools/browser-checks.sh self-serve list. The re-review confirmed the
rebase clean and the code unchanged; the final HEAD is genuinely green (validation PASSED, fail 0).

### Per-Iteration Breakdown

#### Iteration 1 (pre-rebase)
**Reviewer model:** opus
**New findings:** 1 WARNING, 2 NITs
**Self-generated:** 0
- [WARNING] busyKey omitted `stateEvidence`, which busyRow's auth_failed branch renders --> FIXED (include stateEvidence ONLY for auth_failed; add fresh.name fallback; +2 red-capable arms).

#### Iteration 2 (pre-rebase)
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 NITs
**Self-generated:** 0
- [BLOCKER] paintBusy reads el.dataset.busyKey, but web.typing-order-1150.test.js's runDm lifts the real paintBusy against a hand-built `el` with no `dataset` -> TypeError. VERIFIED by running the test. --> FIXED (`dataset: {}` in the mock, matching real DOM). Re-validated green.
- [NIT] check missing surface annotation --> FIXED; [NIT] separator rationale --> FIXED (comment).

#### Iteration 3 (pre-rebase)
**Reviewer model:** opus
**New findings:** 0 actionable ("No issues found"). Swept every other paintBusy consumer -- none breaks on el.dataset. Converged pre-rebase.

#### Iteration 4 (post-rebase re-review)
**Reviewer model:** opus
**New findings:** 0 actionable. One CONVENTION (plan filename timestamp) is a DUPLICATE of the iter-2 deferred entry (skipped per 6c); one NIT (plan Files omits the test file). Verified the rebase clean: browser-checks.sh has both render-start-agent-3410 and render-busy-anim-3421 exactly once, well-formed; no stray markers. **Converged.**

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status |
|---|------|----------|------|--------|-------------|--------|
| 1 | 1 | WARNING | web/index.html | BRANCH | busyKey omitted auth_failed stateEvidence | FIXED |
| 2 | 2 | BLOCKER | web.typing-order-1150.test.js | BRANCH | lifted paintBusy mock lacked el.dataset -> TypeError | FIXED |
| 3 | 2 | CONVENTION | .claude/plans/anim-3421.md | BRANCH | plan filename lacks timestamp | DEFERRED (mixed repo practice) |

### NITs (non-blocking)
- fresh.name fallback in key (fixed); surface annotation (fixed); separator comment (fixed); plan "## Files" omits web.typing-order-1150.test.js (recorded; the mock change is fully documented here in the ledger + summary).

### Strengths (across iterations)
- Correct root cause: DOM-node recreation restarting the CSS `work` loop, not the keyframes.
- Key-on-inputs (not paintRoomBusy's innerHTML compare) is correct: busyRow's initials branch inline style does not round-trip; paintRoomBusy stays safe with its compare because it renders no faces.
- auth_failed-only evidence conditional keeps the working animation continuous while the auth_failed "last seen" line refreshes; both directions red-capable.
- Lifted-fn test mock fix mirrors the real DOM contract; swept every other paintBusy consumer.
- Clean rebase (both checks present once, well-formed); full browser-check wiring; conventions clean (no em dashes, product voice, light/dark).
