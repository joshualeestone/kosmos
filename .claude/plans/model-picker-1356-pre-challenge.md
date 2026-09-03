---
pre_challenge: true
method: challenge-loop
branch: model-picker-1356
diff_hash: 262bbc651223d0d1c4f054261e182c076c3d700b9cd77c30e643d39dccb7f952
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T21:08:59Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (zero NEW findings requiring a code fix on the first blind pass)
**Total findings:** 2 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT)
**Fixed:** 0 | **Deferred:** 1 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Converged** — no new finding required a code change.
- [WARNING] engine/create.js:120 — `claude-fable-5-1` has no in-repo corroboration and the
  `arg` is passed straight to `claude --model`, so a wrong id would silently fail to start an
  agent. --> DEFERRED (verified): the id is confirmed against the harness's authoritative
  model-id list (this session's own environment block declares "Model IDs — Fable 5.1:
  'claude-fable-5-1'", and correctly names this session's running model `claude-opus-4-8`, so
  the list is current). It also matches the `claude-fable-5` -> `claude-fable-5-1`
  point-release pattern. The reviewer itself rated it "not a blocker, confirm before merge";
  confirmed. The absence of an `arg`-allowlist is pre-existing (every existing row runs the
  same way) and out of scope for "add two models".
- [NIT] engine/create.test.js:3796 — the new #1356 test re-asserts the arg->label round-trip
  the whole-list test at create.test.js:1947 already covers. Kept: the #1356 test also pins
  each new row's existence/provider/label/non-default/why, documenting the requirement
  explicitly and failing (find -> undefined) if a row is dropped or mis-keyed.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/create.js:120 | claude-fable-5-1 id uncorroborated in-repo | DEFERRED | id confirmed against the harness's authoritative model-id list; matches the point-release pattern; arg-validation infra is pre-existing + out of scope. No code change. |
| 2 | 1 | NIT | engine/create.test.js:3796 | new test overlaps the whole-list round-trip test | NOTED | kept; also pins existence/provider/label/non-default for the two new rows |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] engine/create.test.js:3796 — the #1356 test overlaps the whole-list round-trip test (iteration 1)

### Strengths (across all iterations)
- The #1356 test returns the dangerous answer: `find(m => m.arg === w.arg)` yields undefined and
  fails if a row is dropped, mis-keyed, or given the wrong id (verified by perturbation) (iteration 1).
- The existing arg->label round-trip guard (create.test.js:1947) stays green because
  `claude-opus-4-8` was already in MODEL_NAMES and only the missing `claude-fable-5-1` name was
  added (iteration 1).
- No runtime/test breakage from the missing CONTEXT_LIMITS entry for Fable 5.1: `limitFor` falls
  through to the assumed-limit regex `/^claude-(opus|sonnet|fable)-/`, which `claude-fable-5-1`
  matches, yielding a UI-marked assumed 1M ceiling — the intended fallback; no invented measured
  number (iteration 1).
- Default is still exactly Sonnet 5 (both new rows omit `default`; the new test asserts
  `!row.default`), so the `defaults.length === 1` invariant holds; the #1026 count guard is
  updated 4->6; both new rows are `provider: 'anthropic'` so the OpenAI list stays empty; the
  picker is served dynamically from MODELS via `/api/roles`, so no web/index.html edit and no
  browser gate; the `why` copy avoids the unmeasured "loops less" claim (Part 2 scoping)
  (iteration 1).
