---
pre_challenge: true
method: challenge-loop
branch: minimax-7206
diff_hash: a99fa258aca6fae386fc62b2d86dc8a203d9534c7b71885213af62add2d626c8
validation: passed (Mortals full suite, 27523 tests, 0 fail, entry clean for this hash, base 78ba590d43; main has moved since and merges cleanly, git merge-tree)
subdir_audit: passed
timestamp: 2026-11-06T09:43:10Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4's only WARNING duplicates the deferred switch-on checklist item)
**Total findings:** 6 actionable (0 BLOCKERs, 6 WARNINGs, 0 CONVENTIONs), about 14 NITs
**Fixed:** 4 | **Deferred:** 2 | **Asked (awaiting user):** 0

Before iteration 1: the related tests (295), the full-suite-only guards (engine.reachable, #1732, #1777, fixture-discipline, orgpolicy names, reason-grep, browser-checks-wired, browser-checks-indexed, remotestepup, #2129) and both browser-check gates passed locally; the supervisor test was red with MiniMax's launch case removed (2 failures).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/anthropiccompat.js MiniMax row comment: stated the key is checked at the model list when only a made-up key's 401 was measured. --> FIXED: the comment says only what was measured; a real key's answer is the checklist's first item.
- [WARNING] server.compat-accounts-7206.test.js: no route test that a MiniMax add is refused, stores nothing and sends no key under the other vendors' switches. --> FIXED: added; red with MiniMax sharing DeepSeek's switch (3 failures).
- [NIT] region (api.minimax.io vs api.minimaxi.com) --> FIXED: on the checklist
- [NIT] plan-key wording --> FIXED: on the checklist
- [NIT] stale comments naming two vendors --> FIXED
- [NIT] stale 2b-roster comment --> FIXED (deleted)
- [NIT] MODEL_WORDS untested --> left

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] the model id MiniMax-M3.1-Flash is unverified (MiniMax's pages disagree). --> DEFERRED: no real key is held; it is the switch-on checklist, and MiniMax is off on every board until compat-minimax-on exists.
- [WARNING] the check address unverified with a real key. --> DEFERRED: same checklist item.
- [WARNING] no test of the launch environment for a MiniMax home. --> FIXED: the supervisor test checks MiniMax's address, its key, and every variable as a -e pair.
- [NIT] three more stale comments --> FIXED
- [NIT] per-vendor chains are hand-extended --> left: a third row; a table refactor is its own change

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (the cited line is this slice's first commit, before any loop fix)
- [WARNING] web/index.html PROVIDER_MARK_KEY: mapping MiniMax copied its setup mark into the menus and the project tally, where it drew nothing (a gradient defined only inside #firstrun; measured 0 painted pixels), and the menus' MiniMax row shows on every board. --> FIXED: the mark is one currentColor path, as Gemini's since #3422 (measured 573 pixels, beside GLM 767 and DeepSeek 670). New test web.provider-marks-7206: no mapped mark may be filled from url(#...); red with the gradient mark mapped.
- [NIT] providerOf has no MiniMax arm --> FIXED
- [NIT] the key page and plan sentence --> on the checklist
- [NIT] the mark comment --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 (its WARNING is iteration 2's deferred checklist item; 2 NITs)
**Self-generated:** 0
**Converged** - no new actionable findings.

#### 6g/6j validation
- Mortals full suite on the converged head: 27523 tests, 0 fail, entry clean for this hash. Not rebased afterwards (the merge base is unchanged, so the hash holds); main merges cleanly per git merge-tree, and PR CI runs on the merge.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/anthropiccompat.js MiniMax row | BRANCH | comment claimed more than measured | FIXED | iteration 1 commit |
| 2 | 1 | WARNING | server.compat-accounts-7206.test.js | BRANCH | no route test for MiniMax off | FIXED | iteration 1 commit |
| 3 | 2 | WARNING | engine/anthropiccompat.js models | BRANCH | model id unverified | DEFERRED | switch-on checklist |
| 4 | 2 | WARNING | engine/anthropiccompat.js checkUrl | BRANCH | check address unverified | DEFERRED | switch-on checklist |
| 5 | 2 | WARNING | supervisor.anthropiccompat-7206.test.js | BRANCH | launch env untested | FIXED | iteration 2 commit |
| 6 | 3 | WARNING | web/index.html PROVIDER_MARK_KEY | BRANCH | MiniMax mark draws blank in menus | FIXED | iteration 3 commit |

### NITs (non-blocking, across all iterations)
- MODEL_WORDS minimax untested (iteration 1).
- Per-vendor chains hand-extended; a table refactor is its own change (iteration 2).
- markMarkup's lazy match would miss a mark with a nested span (iteration 4); none exists today.
- Every board now shows a disabled "MiniMax · coming soon" row in three menus and a one-colour setup mark (iteration 4): intended.

### Strengths (across all iterations)
- MiniMax is off by its own switch at every layer (engine, supervisor, server routes, page), never by DeepSeek's or GLM's, each with a control.
- The engine stays table-driven; no missed vendor site found in four sweeps.
- New tests can fail: each was shown red against a mutant.
