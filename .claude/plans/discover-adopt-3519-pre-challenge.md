---
pre_challenge: true
method: challenge-loop
branch: discover-adopt-3519
diff_hash: 2c5180d09f4d0d6b1ee7edf5a8dd5c19323e6af7af4916304d4d8f3066fbb7a3
validation: failed (environmental: Xcode license not accepted on this Mac; shell-test-only; node suite 8423 tests / 0 fail; would fail on any branch; CI is the real gate)
subdir_audit: passed
timestamp: 2026-09-24T03:33:14Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (zero NEW actionable findings after iteration 2, witnessed by two models)
**Total findings:** 1 CONVENTION (self-cancelling — plan file present), 2 NITs, 0 BLOCKERs, 0 WARNINGs
**Fixed:** 1 (iteration-1 NIT: guard other-direction control) | **Deferred:** 2 (1 environmental validation, 1 pre-existing-comment NIT) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 0 (6.0 initial validation)
**Reviewer model:** n/a (canonical validation helpers)
**Result:** node suite green (8422 tests / 0 fail / 148 skipped); AUDIT passed. `validation_log_run_or_skip` returned RC=1 on ONE shell test only: `local server did not start: You have not agreed to the Xcode license agreements`.
**Self-generated:** n/a
- [BLOCKER] initial-validation: yarn test (run-tests.sh) shell arm failed — Xcode license not accepted on this Mac (server-start shell test) --> DEFERRED (Origin BRANCH): environmental, pre-existing, fails on any branch, not fixable without sudo (`sudo xcodebuild -license`, an operator action); the node suite covering the entire JS diff — including server.test.js which boots the server on port 0 — is green. CI runs the shell tests in a clean environment.

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs (the plan-file CONVENTION was self-cancelling — the reviewer confirmed the plan file is present), 1 NIT
**Self-generated:** 0 of the above (ITER_COMMITS empty at iteration 1; 6.0 passed its node arm, so the first reviewer is iteration 1)
- [NIT] engine/discover.adopt.test.js — the bad-hint control only tested a `google` hint on an AGENTS.md folder; the guard's other dangerous direction (a non-claude `xai` hint on a CLAUDE.md folder must stay claude) was unexercised --> FIXED (commit e2483deb): added `#3519 CONTROL: a non-claude provider hint on a CLAUDE.md folder is ignored (stays claude)`.

#### Iteration 2
**Reviewer model:** sonnet (different model from iteration 1, per 6a model-variation)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above (the sole NIT is on a pre-existing comment, Origin BRANCH)
**Converged** — no new actionable findings; convergence witnessed by opus (iter 1) + sonnet (iter 2).
- [NIT] engine/create.js:740-742 — the pre-existing `recordedRunner` comment uses codex as its example of the provider-fallback mechanism; now that the discover.connect provider write is generalized via `runnerProvider`, a future reader could misread it as "codex only". Still factually true --> DEFERRED (Origin BRANCH): pre-existing comment, still accurate (codex is an example of the mechanism, not an exclusivity claim), reviewer explicitly advised against a churn-only commit; worth a one-line touch-up next time that block is edited.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 0 | BLOCKER | (validation) | BRANCH | initial/final validation: Xcode-license shell-test failure (environmental) | DEFERRED | Environmental; node suite green; CI is real gate |
| 2 | 1 | NIT | engine/discover.adopt.test.js | BRANCH | guard's CLAUDE.md arm unexercised | FIXED | e2483deb |
| 3 | 2 | NIT | engine/create.js:740-742 | BRANCH | pre-existing comment now a special case | DEFERRED | Still true; reviewer said no churn |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] engine/discover.adopt.test.js — guard other-direction control (iteration 1) — FIXED, not left as a NIT.
- [NIT] engine/create.js:740-742 — pre-existing comment touch-up next edit (iteration 2) — deferred.

### Strengths (across all iterations)
- Core classification logic sound: GEMINI.md appended in precedence order (CLAUDE.md > AGENTS.md > GEMINI.md) matching `found()`'s dedup collision order; provider-hint guard honored only when `briefFilename(hinted) === instructionsFile`, so a hint can correct codex<->grok on AGENTS.md but never claim an absent file, and is skipped on the no-instructions nameplate path.
- `runnerProvider` is a clean minimal inverse of `providerRunner`, unit-tested per-member + round-trip, upholding Convention #5 (one map, no two-copies-of-one-fact); the profile write generalized from a hand-rolled codex-only ternary.
- No regression to codex/claude adoption: controls assert AGENTS.md-no-hint stays codex/openai, contradicting hints fall back, claude (null runner) writes no provider; installJob rollback names provider explicitly so the generalization leaves no stale provider on failure.
- Security clean: `body.provider` coerced with `String()`; the hint cannot cause reading an arbitrary/absent file; binary resolution stays keyed on runner; win32 still refuses gemini/grok; new sandbox seams for GEMINI/GROK bins with matching outside-sandbox guard rows.
- Comment accuracy: new comments claim exactly what the code does; the weakest premise (no current UI sends body.provider, so the grok half is a correct-when-called capability) is honestly documented in the plan and the server.js route comment; `--` throughout, no em dashes.
