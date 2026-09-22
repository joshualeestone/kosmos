---
pre_challenge: true
method: challenge-loop
branch: anim-3421
diff_hash: 9a83b3fe988a6a05869b02c9c5202eedea1b493652f6b2ce69931c33d70ba33b
validation: passed
subdir_audit: passed
timestamp: 2026-09-22T23:28:11Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 returned zero new BLOCKER/WARNING/CONVENTION; "No issues found")
**Total actionable findings:** 1 BLOCKER, 1 WARNING, 1 CONVENTION, plus NITs
**Fixed:** 3 | **Deferred (reasoned):** 1 (plan filename, matches repo practice) | **Asked:** 0

Model rotation: opus (1) / sonnet (2) / opus (3), so convergence is witnessed by both models.

⚠️ PROCESS NOTE: iterations 1-2 ran on a baseline that a trailing `echo` had MASKED as
green (the run_in_background wrapper's exit was the echo's, so the task-notification
said "exit 0" while the suite actually failed, rc=1). The iteration-2 blind reviewer
surfaced the underlying regression; reading the validation OUTPUT (not the notification)
exposed the mask. From iteration 2's re-validation on, the real rc was captured and
re-raised, and the true verdict was confirmed from the output. The final HEAD is
genuinely green (fail 0, validation PASSED).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 0
- [WARNING] busyKey omitted `stateEvidence`, which busyRow's auth_failed branch renders ("last seen: ..."), so the guard would freeze that line on evidence change --> FIXED: include stateEvidence in the key ONLY for auth_failed (a working agent's evidence churns every poll and keying on it there would reintroduce the animation reset). Added the `fresh.name` fallback (NIT) in the same edit. Added red-capable arms: working-ignores-evidence + auth_failed-refreshes.
- [CONVENTION] plan filename lacks a timestamp --> DEFERRED (matches widely-established repo practice for branch-named plans; iter-3 confirmed).
- [NIT] control only perturbs state --> addressed by the two new evidence arms.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 NITs
**Self-generated:** 0
- [BLOCKER] paintBusy now reads/writes `el.dataset.busyKey`, but `web.typing-order-1150.test.js`'s `runDm` lifts the real paintBusy against a hand-built `el = { hidden, innerHTML }` with no `dataset`, so every runDm arm threw `TypeError: reading 'busyKey'`. VERIFIED by running the test directly (throws) and by reading the 6.0 output (the mask). --> FIXED: added `dataset: {}` to the lifted-fn mock (matches the real DOM contract; the repo's documented lifted-fn hazard). Re-validated: fail 0, PASSED.
- [NIT] check missing `// Browser-check-surface: d-busy` annotation --> FIXED.
- [NIT] `\u0001` separator rationale not stated inline --> FIXED (comment).

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 actionable ("No issues found")
**Self-generated:** 0
- Swept every other paintBusy reference (web.reply-where.test.js regex-only; server.test.js unrelated alias; both browser-checks use real DOM) -- no other site breaks on el.dataset. **Converged.**

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status |
|---|------|----------|------|--------|-------------|--------|
| 1 | 1 | WARNING | web/index.html | BRANCH | busyKey omitted auth_failed stateEvidence | FIXED |
| 2 | 2 | BLOCKER | web.typing-order-1150.test.js | BRANCH | lifted paintBusy mock lacked el.dataset -> TypeError | FIXED |
| 3 | 2 | CONVENTION | .claude/plans/anim-3421.md | BRANCH | plan filename lacks timestamp | DEFERRED (repo practice) |

### NITs (non-blocking, all fixed unless noted)
- fresh.name fallback in key (fixed); Browser-check-surface annotation (fixed); separator comment (fixed).

### Strengths (across iterations)
- Correct root cause: DOM-node recreation restarting the CSS `work` loop, not the keyframes.
- Correct decision to key on inputs rather than copy paintRoomBusy's innerHTML compare (busyRow's initials branch inline style does not round-trip).
- auth_failed-only evidence conditional keeps the working animation continuous while the auth_failed "last seen" line still refreshes; both directions red-capable.
- Full browser-check wiring (surface annotation + runner + README); node-identity probe is the right instrument for a temporal defect.
- Conventions clean (no em dashes, product voice, light/dark).
