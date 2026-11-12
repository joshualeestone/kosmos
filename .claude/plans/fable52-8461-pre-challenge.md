---
pre_challenge: true
method: challenge-loop
branch: fable52-8461
diff_hash: 5f243bae975f3a7ccdb289c9f2e47fbd6e1ad50d857f660b4a61121af6d533f3
validation: passed
subdir_audit: passed
timestamp: 2026-11-12T17:04:10Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (iteration 1 found NITs only; the two copy NITs were then fixed and the touched tests and both browser-check gates re-run)
**Total findings:** 2 NITs (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs)
**Fixed:** 2 | **Deferred:** 0 | **Asked (awaiting user):** 0

A small, additive change (one model in four tables), so one blind iteration was the budget; the reviewer searched the
whole tree for every place that lists or special-cases Claude models and found none missed. Full run-tests validation
passed on Mortals on the final head 1279cc1b9a (hash 5f243bae975f, a real run). An earlier validation on cccd3d71ac was
stopped before it ran, once the NIT fixes changed the code; it is not counted. The model menu, model-order, price and
page-price tests pass 315 of 315; the new test fails with the running-name entry removed and with the page price
differing from the engine's; both browser-check gates green. The id was confirmed from the installed Claude Code
(2.1.322) and a `claude -p --model claude-fable-5-2` run, whose usage named claude-fable-5-2.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.
- [NIT] engine/create.js - Fable 5.1 and Fable 5 both opened their menu line with "The previous Fable" --> FIXED (1279cc1b9a: "The Fable before 5.2")
- [NIT] web/index.html - the page's 5.2 price row sat under the comment about 5.1's cache price --> FIXED (1279cc1b9a: below 5.1, with its own comment)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | NIT | engine/create.js | BRANCH | two menu lines opened alike | FIXED | 1279cc1b9a |
| 2 | 1 | NIT | web/index.html | BRANCH | 5.2 row under 5.1's comment | FIXED | 1279cc1b9a |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.
