---
pre_challenge: true
method: challenge-loop
branch: modelsort-2140
diff_hash: 80419f02ee881413a75690d569559d6072271ecd126d7d72db922ed468d510d9
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T16:11:14Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 1 actionable (0 BLOCKERs, 0 WARNINGs, 1 CONVENTION), 1 NIT, 13 STRENGTHs across both passes
**Fixed:** 1 | **Deferred:** 1 (NIT) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 CONVENTION, 1 NIT.
- [CONVENTION] .claude/plans/modelsort-2140.md — four em dashes in the plan prose (house rule).
  --> FIXED (amended into the plan commit): replaced with hyphens; also corrected the plan's OpenAI
  framing after Splinter's ruling (the OpenAI half is a follow-up via a tier-descending rank, not
  blocked on Josh).
- [NIT] engine/create.js — Fable 5's `why` keeps "the most expensive to run" while Fable 5.1 above
  it is "newest and most capable"; plausible but worth a one-line Josh confirm. DEFERRED: it is
  Josh's original framing for Fable 5, the reorder only removed the now-false "most capable" claim,
  and changing the pricing copy would be guessing at his intent. Non-blocking.
- STRENGTHs: order correct end-to-end (the array is the sole source of display order; both the
  create form and the detail picker render it in sequence, no sort/reverse anywhere), default
  preserved (Sonnet 5 only), test genuinely reds on a regression, no browser check staled.

#### Iteration 2
**New findings:** 0 (all STRENGTHs).
**Converged** — a fresh blind reviewer confirmed the exact order, the single Sonnet default, the
6 models intact with no arg typos, the test reds on a regression (149/149 pass, #1356/#1026
unregressed), consistent copy across the swap, and no em dashes in the diff.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/modelsort-2140.md | em dashes in plan prose | FIXED | amended plan commit |
| 2 | 1 | NIT | engine/create.js | Fable 5 "most expensive" copy vs 5.1 above it | DEFERRED | Josh's original framing; reorder only removed the false "most capable" claim |

No BLOCKER / WARNING findings.

### NITs (non-blocking)
- [NIT] engine/create.js — Fable 5 "most expensive to run" vs Fable 5.1 now above it (iteration 1; deferred, Josh's framing)

### Strengths
- Claude picker order is exactly Josh's most-powerful-first sequence; the MODELS array is the sole source of display order (create form + detail picker both render it in sequence) (iterations 1 and 2)
- Default preserved: Sonnet 5 only; the test pins both the order and the default so a regression reds (iterations 1 and 2)
- All 6 anthropic models intact, unique keys, no arg typos; #1356/#1026 unregressed (149/149) (iterations 1 and 2)
- Copy made consistent across the swap ("most capable" now only on Fable 5.1) (iterations 1 and 2)
- No browser check staled by the reorder; OpenAI half correctly scoped to a separate follow-up (iteration 1)

### Validation
Full suite green: `tests 4593 / pass 4593 / fail 0`, `Done in 244.88s`, `validation PASSED`. No
`web/` change (the reorder is engine-side; the picker renders the served order), so the
browser-check gate does not apply.
