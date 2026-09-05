---
pre_challenge: true
method: challenge-loop
branch: openai-tiersort-2140
diff_hash: cd927f9557c51572f16b7d4cd9cc18b26a14a5a4764aab2c6ef6735e0d804895
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T16:49:33Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** iter 1 -- 2 WARNINGs + 1 NIT (all addressed by a rework); iter 2 -- 0 actionable (2 non-actionable NITs), 4 STRENGTHs
**Fixed:** 3 | **Deferred:** 2 (non-actionable NITs) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (original design: intercept in openaiModelClass)
- [WARNING] the rationale was wrong: `"gpt-5.6-terra".startsWith("gpt-5")` is TRUE, so the 5.x tiers were ALREADY recognised (rank 0), mis-ORDERED (alphabetical tiebreak), not ranked-last/unverified; only a newer MAJOR (gpt-6) was unknown. --> FIXED by rework.
- [WARNING] reclassifying a newer major as recognised+top made a fail-to-start-risk model eligible as the default. --> FIXED by rework.
- [NIT] parseFloat mishandles a two-digit minor. --> FIXED (parse major/minor as ints).

**Rework:** openaiModelClass left untouched; openaiHighTierRank applied in chatModelsFromList as an ORDER-ONLY override that preserves each model's class. A recognised gpt-5 subtier stays recognised and sorts top by version-tier; an unrecognised newer major (gpt-6) stays 'unknown' (keeps the marker, never the default) and only sorts first.

#### Iteration 2 (reworked design)
**New findings:** 0 actionable.
**Converged** -- a fresh blind reviewer confirmed the rank arithmetic (a tier can never cross a version boundary: tierScore span 6 < minor gap 10; max within-major 999 < major gap 1000), two-digit minors order (5.10 > 5.6), no regression (gpt-5/gpt-4.1/gpt-4o/gpt-4/o-series keep fixed ranks), nonchat dropped before rank, and the WARNING-2 fix (gpt-6 top-sorted but unverified + excluded from default). 81/81 engine tests pass.
- [NIT] `major*1000 + minor*10` supports minors up to 99 (a 3-digit minor 5.100 would collide with gpt-6). Bounded/unrealistic. DEFERRED.
- [NIT] `openaiTierScore` uses substring `includes('pro')`; only consulted for parsed-newer ids, no real id exhibits the collision. DEFERRED.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/openaiaccounts.js | wrong rationale (5.x already recognised, not last) | FIXED | rework 695f1722 |
| 2 | 1 | WARNING | engine/openaiaccounts.js | newer major could become the default | FIXED | rework 695f1722 (class preserved) |
| 3 | 1 | NIT | engine/openaiaccounts.js | two-digit minor mis-parse | FIXED | major/minor int parse |
| 4 | 2 | NIT | engine/openaiaccounts.js | 3-digit minor collision (5.100) | DEFERRED | bounded/unrealistic |
| 5 | 2 | NIT | engine/openaiaccounts.js | `includes('pro')` substring | DEFERRED | bounded, no real id |

### NITs (non-blocking)
- 3-digit minor collision at 5.100 (iteration 2, deferred)
- `openaiTierScore` substring match (iteration 2, deferred)

### Strengths
- Correct diagnosis + minimal order-only fix; openaiModelClass untouched (iterations 1 and 2)
- Rank arithmetic produces Josh's exact order and a tier can never cross a version boundary (iteration 2)
- WARNING-2 fix verified: an unrecognised newer major sorts top but stays unverified and is never the default (iteration 2)
- No regression to gpt-5/gpt-4.x/o-series; nonchat dropped first; snapshot/default interplay unchanged (iteration 2)
- Tests are genuine deepEqual order assertions with regression + forward-compat + nonchat-drop controls (iterations 1 and 2)

### Validation
Full suite green: `pass 4593 / fail 0`, `Done in 248.38s`, `validation PASSED`. No `web/` change (engine-side; the picker renders the served order), so the browser-check gate does not apply.

### ID-format note (weakest premise, surfaced to Splinter)
The parse assumes `gpt-<major>[.<minor>]` (OpenAI's shape). The raw /v1/models ids for the 5.6/5.5/5.4 tiers are a live per-account fetch not in this repo; a non-gpt id shape would fall back to its class rank (safe) until the regex learns it.
