---
pre_challenge: true
method: challenge-loop
branch: openai-observed-overlay-2413
diff_hash: 36f49db41620681daa0a1385e7b6adf212c5fff6efa67f37d44aef6c4e1bbe0b
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T18:13:40Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (iteration 1 = the 6.0 initial validation + plan-file fix; iterations 2-4 = blind reviewer passes)
**Converged:** Yes -- iteration 4 (a different model from iteration 3) produced zero NEW BLOCKER/WARNING/CONVENTION findings.
**Total findings:** 5 actionable (0 BLOCKERs, 2 WARNINGs, 3 CONVENTIONs) + 3 NITs across all iterations
**Fixed:** 4 | **Deferred:** 1 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation + Step 4 plan check)
**Reviewer model:** n/a (validation + plan-file check, no blind reviewer)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION (no plan file for the branch)
**Self-generated:** 0
- [CONVENTION] .claude/plans/ -- no plan file for the branch --> FIXED (commit cf96918: wrote the design plan)
- Baseline validation: 6141 tests, 0 fail; subdir audit clean.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0 (ITER_COMMITS held only the plan-file commit; the finding was in the plan prose I wrote)
- [CONVENTION] .claude/plans/openai-observed-overlay-2413.md -- em dashes in the plan file (violates the no-em-dash rule) --> FIXED (commit 7017fed)
- [NIT] the badge shows green up to ~5 min after the last real turn (documented, intentional; same "recently observed working" semantics as the #1921 Claude overlay)
- 6 STRENGTHs (cross-provider isolation airtight; false-green property holds; no API-key downgrade; self-healing double-gated; all callers migrated to the provider-qualified signature; non-vacuous test controls).

#### Iteration 3
**Reviewer model:** sonnet (different model from iteration 2, per kosmos#2032)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 0 NITs
**Self-generated:** 0 (both WARNINGs blamed to the original branch commit b73deff4, not in ITER_COMMITS)
- [WARNING] engine/observed.js:73 -- saw() only checked provider was a non-empty string, not that it was one of the closed enum; the isolation the header comment calls "injective" rested on caller discipline, not the module --> FIXED (commit 83414e0f: PROVIDER_VALUES membership enforced in saw())
- [WARNING] engine/status.js -- codexLastCompletionAt and readCodexContext each independently did create.workerDir -> codexsession.read for the same codex pane in the same tick (codexsession.read walks the sessions tree), a duplicate derivation --> FIXED (commit 83414e0f: readCodexSession() reads once, codexCompletionAt(sess) is pure, readCodexContext(name, sess) takes the pre-read session; snapshot() threads one read into both; new perf test asserts reads === 1)
- [CONVENTION] .claude/plans/ -- plan filename has no timestamp suffix --> DEFERRED (pre-existing, widely-tolerated sibling pattern e.g. boardtoken-leaf-2509.md, kp-badge-surface-2518.md; the reviewer itself flagged it "for completeness only")
- 3 STRENGTHs (isolation defense-in-depth; false-green safety with vacuousness-guarded tests; additive/positive-only overlay).

#### Iteration 4
**Reviewer model:** opus (rotated back; convergence now witnessed by two models)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 actionable CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** -- no new actionable findings.
- [NIT] engine/status.js -- every test drives a state:'working' pane; a case pinning "a non-working codex pane with a fresh completion still records an ok" would make the state-decoupling explicit (correctness fine; coverage only) --> test ADDED post-convergence (commit 6d11d075)
- [NIT] engine/status.js -- the now-at>=0 future-skew guard is defensive redundancy with verdict()'s own future-guard (safe direction; not a defect)
- 4 STRENGTHs (three-layer cross-provider isolation; false-green safety positive-only; the shared-read refactor's null-sess path proven unreachable; no API-key regression).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/ | BRANCH | No plan file for the branch | FIXED | cf96918 |
| 2 | 2 | CONVENTION | plan.md:7 | SELF | Em dashes in the plan file | FIXED | 7017fed |
| 3 | 3 | WARNING | observed.js:73 | BRANCH | saw() did not enforce the closed provider set | FIXED | 83414e0f |
| 4 | 3 | WARNING | status.js | BRANCH | Rollout read twice per codex pane per tick | FIXED | 83414e0f |
| 5 | 3 | CONVENTION | plan.md filename | SELF | Plan filename has no timestamp suffix | DEFERRED | Pre-existing widely-tolerated sibling pattern; reviewer noted "completeness only" |

### Outstanding questions (ASKED, still unresolved)
None.

### NITs (non-blocking, across all iterations)
- [NIT] The badge shows green up to ~5 min after the last real turn (freshness window; documented, intentional) -- iteration 2.
- [NIT] engine/status.js -- state-decoupling of the codex ok arm was covered only for working panes -- iteration 4 -> a pinning test was added (commit 6d11d075).
- [NIT] engine/status.js -- the now-at>=0 record-time future-skew guard is redundant with verdict()'s render-time guard (safe direction) -- iteration 4.

### Strengths (across all iterations)
- Cross-provider isolation is defended in depth at three independent layers (provider-qualified store with enforced closed-enum membership, per-provider filter on both server-side join loops, and mutually-exclusive write arms in status.js). Pinned including the space-containing-name edge case.
- The load-bearing false-green safety property holds: the OpenAI ok is recorded ONLY from a witnessed rollout completion (a token_count with real last_token_usage), never from pane WORKING (a dead-credential 401 reconnect loop scrapes WORKING too). Positive-only, stamped at completion time, double-gated on freshness, self-healing.
- The overlay is genuinely additive: only a fresh ok upgrades a row to green, so a live API-key account's real /v1/models green render is never downgraded and the tailored chatgpt grey pill is preserved.
- The shared-read refactor is correct and the dangerous null-sess path is proven unreachable; the read-once invariant is directly asserted by a monkeypatch perf test.
