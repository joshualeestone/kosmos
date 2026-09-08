---
pre_challenge: true
method: challenge-loop
branch: import-openai-default-model
diff_hash: 1c8591164f143679e2e590964c79a2b4aec5a0031a915efa65a76e9e9cb861d6
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T15:39:00Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5 found zero new BLOCKER/WARNING/CONVENTION)
**Total findings:** 10 (0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 5 NITs)
**Fixed:** 8 | **Deferred:** 2 | **Asked (awaiting user):** 0

Reviewer models rotated across iterations (kosmos#2032): opus -> sonnet -> opus -> sonnet -> opus,
so the convergence is witnessed by both models. The product code stabilized after iteration 4; the
two real product fixes were the provider-switch flag-strand (iter 1) and the okProv-guard invariant
(iter 4). Iterations 2, 3, 5 hardened the test coverage and docs.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
- [WARNING] web/index.html: the async gen-mismatch early return leaves the one-shot true; switching to Claude bumps the gen and takes a synchronous branch that never cleared it, so a later manual return to OpenAI could wrongly pre-pick --> FIXED: clear the flag in applyCreateProviderUI's Claude branch.
- [WARNING] browser-check tested only the consumer (direct assignment), not the producer/clears --> FIXED: added LIFECYCLE clears + a finishImport source-pin.
- [NIT] sel.value = def.key uses the raw key while options use esc(m.key) --> DEFERRED: the browser decodes the escaped attribute back to the raw key, and real OpenAI keys are slugs; no functional issue.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
- [WARNING] the account-less survive path (the plan's named leak lesson: the !acctDir early return deliberately not clearing the flag) had zero coverage; a "defensive" regression clearing on the early return would pass silently --> FIXED: added a SURVIVE case (account-less paint keeps the flag, then the account-selection paint consumes it and pre-picks).

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] the clearedByReset assertion was true for an unchecked reason (CREATE_ACCOUNTS empty -> reset routes through the Claude branch, which independently clears), so it could not detect resetCreateProvider's own clear going missing (load-bearing on an OpenAI-only reset) --> FIXED: added a source-pin of resetCreateProvider's clear.
- [NIT] plan omitted the switch-to-Claude clear site --> FIXED.
- [NIT] an import landing first on a not-listable account consumes the one-shot without pre-picking --> DEFERRED: a documented, reversible one-shot tradeoff, not a defect.

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] IMPORT_OPENAI_DEFAULT was set only inside if (okProv), so a non-okProv (unmapped/coming-soon) later import would not reset a dangling flag; held only by UI-reachability while the comment claimed an unconditional guarantee --> FIXED: hoisted the assignment outside the okProv guard so the invariant is structural.
- [NIT] browser-checks README row did not mention the new coverage --> FIXED (no reason-grep bump; emit-site count unchanged).

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Converged** -- no new actionable findings.
- [NIT] plan Change bullet still said the finishImport set was "in the okProv block" (stale after iter 4) --> FIXED.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html | gen-mismatch/Claude-detour flag strand | FIXED | Claude-branch clear |
| 2 | 1 | WARNING | browser-check | consumer-only coverage | FIXED | lifecycle + finishImport source-pin |
| 3 | 1 | NIT | web/index.html | esc vs raw key on sel.value | DEFERRED | browser decodes; slugs only |
| 4 | 2 | WARNING | browser-check | account-less survive path untested | FIXED | SURVIVE case |
| 5 | 3 | WARNING | browser-check | clearedByReset true-for-unchecked-reason | FIXED | resetCreateProvider source-pin |
| 6 | 3 | NIT | plan | omits switch-clear site | FIXED | plan updated |
| 7 | 3 | NIT | web/index.html | not-listable consumes without pre-pick | DEFERRED | documented one-shot tradeoff |
| 8 | 4 | WARNING | web/index.html | one-shot set only inside okProv | FIXED | hoisted outside the guard |
| 9 | 4 | NIT | README | row missed new coverage | FIXED | README updated |
| 10 | 5 | NIT | plan | stale "okProv block" bullet | FIXED | plan updated |

### NITs (non-blocking)
- esc vs raw key on sel.value (iter 1) -- browser decodes, slugs only.
- an import landing first on a not-listable account consumes the one-shot without pre-picking (iter 3) -- documented, reversible tradeoff.

### Strengths (across iterations)
- Root-cause work distinguishing the live per-account /api/accounts/openai/models list (marks one default:true) from the static engine MODELS that made the prior attempt a no-op; the plan documents the correction and its own weakest premise with an escape hatch.
- The one-shot lifecycle is complete and source-verified: authoritative set on every import, consumed at every completing paint, cleared on switch-to-Claude and reset, surviving the account-less first paint, graceful when no default.
- The browser-check identifies and closes its own wrong-reason risk (the reset source-pin), and the control/importPicked/fallback/survive assertions each discriminate a distinct behavior.
- Harness declarations correct and non-vacuous (only the three eval-slicing tests needed the new global). No em dashes in any spelling.
