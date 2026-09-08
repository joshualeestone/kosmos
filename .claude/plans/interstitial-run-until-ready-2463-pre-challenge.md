---
pre_challenge: true
method: challenge-loop
branch: interstitial-run-until-ready-2463
diff_hash: 335b96b21da49030d6df50371ea3967d51e4388be4ec1d3319e21eeeccae7668
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T03:39:05Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 returned zero NEW BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 5 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs across iterations)
**Fixed:** 4 | **Deferred:** 2 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] web/index.html:27847 — provider-switch reduced line computed provName as 'Claude' while the dialog title and interstitial said 'Anthropic', so switching an agent to Anthropic showed both words in one dialog on the last screen before a restart --> FIXED (commit ac311cb7): provName = want === 'openai' ? 'OpenAI' : 'Anthropic', so the whole provider dialog speaks one vocabulary. Deliberately differs from changeModelNow (names the current product, since a model switch does not change provider). Documented in-code; browser-check Anthropic arm added to pin it.
- [NIT] web/index.html:27845 — comment asserted a "row-control path" caller of changeProviderNow that does not exist in current source (only the dialog `run` calls it) --> FIXED (ac311cb7): reworded to the optional-say path (`tell` is a no-op when say is absent), which is accurate regardless of any caller.
- [NIT] web/index.html:27176 — changeDialog's innerHTML-safety comment called busyHtml "an app-generated fixed literal", but the provider caller passes app-DERIVED markup (chgBusyHtml('Setting up ' + label)) --> FIXED (ac311cb7): comment widened to "a fixed literal (model) or an app-derived provider label (provider), never user input"; the safety reasoning is unchanged.
- [NIT] docs/browser-checks/render-model-restart-interstitial.js:47 — the provider source-control regex asserts an exact source spelling rather than a behavior --> DEFERRED: matches the file's existing source-control convention (the sibling RESTART_HOLD_MS = 2000 control is the same shape); the real coverage is the assertion that drives the live #d-provider-go handler, and this cheap source check is belt-and-suspenders.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Duplicates of prior findings (confirmed resolved):** the fresh agent independently verified the iter-1 vocabulary fix, the #1313 no-stuck guarantee, the "three callers" comment correction, and the browser-check discrimination.
- [NIT] web/index.html:28491 vs :27857 — cross-flow vocabulary divergence: a model switch on an Anthropic agent says "reactivate them on Claude" while the provider switch to Anthropic says "reactivate them on Anthropic" --> DEFERRED: this is the exact deliberate, thoroughly documented design decision from iteration 1 (model switch names the product, provider switch names the company chosen); the reviewer explicitly recommended no change, and it is internally consistent within each dialog. Dedups to the iteration-1 WARNING resolution.
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:27847 | provider reduced line said "Claude" vs title/interstitial "Anthropic" | FIXED | ac311cb7 |
| 2 | 1 | NIT | web/index.html:27845 | comment asserted a nonexistent row-control caller | FIXED | ac311cb7 |
| 3 | 1 | NIT | web/index.html:27176 | busyHtml "fixed literal" now app-derived | FIXED | ac311cb7 |
| 4 | 1 | NIT | browser-checks/...:47 | source-control regex is spelling-coupled | DEFERRED | matches file's existing source-control convention |
| 5 | 2 | NIT | web/index.html:28491/27857 | model-vs-provider "Claude" vs "Anthropic" divergence | DEFERRED | deliberate + documented; reviewer recommended no change |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- [NIT] browser-checks/render-model-restart-interstitial.js:47 — source-control regex asserts a spelling (iteration 1, deferred).
- [NIT] web/index.html — cross-flow model-vs-provider vocabulary divergence (iteration 2, deferred, by design).

### Strengths (across all iterations)
- The #1313 "modal can never get stuck" invariant is preserved structurally: the reduced reactivate line is held behind the K only on outcome === 'changed'; partial/failure keep the engine's words and render at once (ok=false), and changeDialog's finally fallback guarantees an exit even on a silent run (iterations 1 and 2).
- RESTART_HOLD_MS demoted to a floor with no changeDialog function-body change: run awaits the POST before say, and the hold is Math.max(0, minBusyMs - elapsed), so a slow restart is covered by the await and a fast one still shows the K for the 2s floor (iteration 2).
- The browser-check drives the REAL #d-model-go and #d-provider-go handlers (both OpenAI and Anthropic arms), shortens the hold via the __kosmosRestartHoldMs seam, and its assertions can return the dangerous answer (a plain "Working…" or a "Claude" reduced line on the Anthropic arm both FAIL) (iterations 1 and 2).
- Comment hygiene: the stale "four other callers" prose was corrected to three in both source and browser-check, and the innerHTML-safety comment was widened accurately (iterations 1 and 2).
