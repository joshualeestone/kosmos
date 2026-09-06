---
pre_challenge: true
method: challenge-loop
branch: openai-3b-diag
diff_hash: 99de623ac17ad3cb4142091abdffeb499f602148bb52f7f8d59056badf3fb095
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T02:44:12Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes — iteration 1 produced zero BLOCKER/WARNING/CONVENTION findings (3 strengths + 1 NIT, applied).
**Total findings:** 1 NIT (applied)
**Fixed:** 1 (the NIT) | **Deferred:** 0 | **Asked:** 0

Baseline validation green: node 4796/4796 pass, 0 fail; the shipped shell gate
(tools/run-tests.sh test:shell chain) ran to completion (EXIT=0). The change is
browser-check-only (docs/browser-checks/), so the #1720 gate does not fire (no web/
change). 3b itself (the browser gate) was reproduced and re-verified separately (see
below) — the node suite does not run browser checks.

### The change (two stale-check fixes; NOT product regressions)
Both checks aborted the 0.6.37 cut at step-3b. The harness-vs-product question was
asked FIRST and both were reproduced before touching anything.
- render-accounts-openai.js: #2303 moved the OpenAI add-success indicator off
  #acct-openai-msg (transient "Checking the connection…", then its container is
  hidden) onto a gold #acct-success-box; the label moved to the account row (#2095).
  Re-pointed the assertion to the success box (settle-wait replaces the fixed 1200ms),
  KEPT the never-full-key security assertion, and re-established "names the chosen
  account, never the full key" on the account row. Deterministic stale check.
- render-create-form.js: #2140's async per-account model picker sets
  #create-model-why asynchronously; the check read it synchronously after the
  provider change (a race), which read '' on webkit under the cut's load (passes
  uncontested on both engines). Added a bounded settle-wait (8000ms, matching the
  file's other bounds). Contention flake, not a product regression.

### Per-Iteration Breakdown
#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Converged** — no actionable findings.
- [NIT] render-create-form.js — settle-wait was 2000ms, shorter than the file's
  8000ms bounds; under the same load that caused F2 an async fetch could exceed 2s
  and re-red --> FIXED: widened to 8000ms (commit on branch).

### Final Ledger
| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | NIT | render-create-form.js:108 | settle-wait bound 2000ms < file's 8000ms | FIXED | widened to 8000ms |

### Outstanding questions (ASKED)
None.

### Strengths (iteration 1)
- render-accounts-openai: the never-full-key security guard is preserved and
  strengthened — asserted on BOTH surfaces the info now lives on (the gold box and
  the account row); both !/walkwalk/ guards still catch a leak. The row assertion is
  non-vacuous (fails if the label stops rendering). The waitForSelector de-flake
  gates only on OpenAI add-success (the Claude path never shows the box), and a
  failed add takes the catch branch and never shows the box, so the check fails
  rather than false-passing.
- render-create-form: the async settle-wait cannot mask a regression — a genuinely
  empty why still returns after the bound and the assertion still reds; every
  openaiNoModelsNote branch contains "model", so /model/i holds; making the IIFE
  async does not break other reads (openaiParks resolves before the return object;
  the OPENAI_MODELS_GEN guard neutralizes an in-flight fetch on the switch back).
- Neither fix can pass while the product is broken (verified against the product
  code); the security guard is preserved; no assertion is vacuous.

### Browser 3b verification (the actual gate, run separately)
Reproduce run: render-accounts-openai RED (the msg assertion), render-create-form
GREEN on both engines. After the fixes: 3b CLEAN — render-accounts-openai PASS (gold
box + row-names-label + never-full-key), render-create-form PASS on chromium AND
webkit. A final gate run on the exact merged bytes (with the 8000ms bound) confirms
clean before the merge is reported.
