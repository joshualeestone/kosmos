---
pre_challenge: true
method: challenge-loop
branch: openai-model-errors-2140
diff_hash: c061bafec2e887868a9c96436879cf63988d882a9881ed5c2d63e5b5a6c4302e
validation: passed (node unit suite CLEAN across FOUR full runs; #1720 browser-check gate PASSES with a justified Browser-check override trailer; the only red was test-browser-run-guard.sh flaking on concurrent-browser-run contention, proven green-alone and unrelated to this change)
subdir_audit: passed
timestamp: 2026-09-04T21:26:00Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (one blind pass, zero NEW BLOCKER/WARNING/CONVENTION)
**Total findings:** 1 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT)
**Fixed:** 0 | **Deferred:** 1 (documented inline) | **Asked:** 0

kosmos#2140 error-matrix slice: `engine/openaiaccounts.js accountModels` now maps a
non-200 from `/v1/models` to distinct, honest states (401 rejected / 403 not-allowed /
429 billing-vs-rate / 5xx trouble) instead of one "could not reach OpenAI" catch-all;
`openaiNoModelsNote` renders each. Unblocked by #2129's re-fix (a3171f34). Surface 1
(#2167) + Surface 2 (#2176) already merged.

### Self-caught during the build
The 429 billing regex first read `/quota|billing|insufficient|spend|limit/` and
misclassified `rate_limit_exceeded` as billing (it contains "limit"). The engine test
caught it; dropped "limit".

### Blind review (iteration 1): 0 actionable, 5 STRENGTHs, 1 NIT
- [NIT] a 429 with a null/no-error body has no code and falls to the RATE wording; if
  the real cause were billing, "try again" is unhelpful --> DEFERRED with an inline
  comment: an ambiguous 429 defaults to the softer retryable wording ON PURPOSE
  (defaulting to billing would false-alarm the common rate-limit 429; a billing 429 in
  practice carries `insufficient_quota` and takes the billing arm).
- STRENGTHs: status mapping airtight (each distinct `because` before the generic
  catch-all; unknown status still reachable; genuine unreachable returns first); 429
  regex correctly excludes "limit"; openaiNoModelsNote arm ORDER verified (no new
  `because` matches an earlier arm); tests non-vacuous (engine drives accountModels
  through the real askModels seam, 200 CONTROL discriminates, web tests slice the
  SHIPPED note fn); no API key leak; no em dashes.

### Validation
`validation_log_run_or_skip` run to convergence FOUR times. Across all four the node
unit suite was CLEAN and the #1720 browser-check gate PASSED (a justified `Browser-check:`
override trailer: the only web/ change is `openaiNoModelsNote`, a pure `because`->string
function -- text-mapping only, render path unchanged, covered with high fidelity by
`web.openai-model-errors-2140.test.js` which slices+drives the shipped function). The
only red was `test-browser-run-guard.sh` (3 assertions) flaking on concurrent-browser-run
contention (Baron's re-cut kept the box busy); a discriminating filter confirmed ZERO
non-contention failures, and the file is proven green-alone. Engine `node --test`: 60/60;
web note `node --test`: 6/6. `node --check` on the engine file passes.

### Final Ledger

| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 1 | NIT | engine/openaiaccounts.js | ambiguous 429 (null body) defaults to rate wording | DEFERRED (intentional, documented inline) |

### Not in scope (noted for follow-up slices)
- The not-listable OPTION still shows "OpenAI picks its own model for now" for a broken
  account; the honest note carries the truth. Refining the option per state is next.
- "Compatibility not verified" labeling for unknown model IDs; per-agent
  connectionId+modelId persistence hardening -- later slices of the fuller #2140.
