---
pre_challenge: true
method: challenge-loop
branch: gskills-callout-4450
diff_hash: e8f8bed879dadc48f3f91f68b867d3cd20abed0e0613331d48cee8f386ac86d0
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T02:37:49Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (re-run after CI found a wiring defect the first two passes missed)
**Converged:** Yes
**Total findings:** 3 actionable (2 BLOCKERs, 1 WARNING, 0 CONVENTIONs), 9 NITs
**Fixed:** 3 actionable + 2 NITs | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (session default)
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (ITER_COMMITS was empty)
- [BLOCKER] docs/browser-checks/b8-board.txt — the new check runs on the shared $B8 board but was not in that board's roster; tools.browser-checks-wired.test.js failed --> FIXED (commit 4690ed975)
- [WARNING] web/index.html:1097 — .gs-ask used the 12px callout font, smaller than the hint under it --> FIXED (commit 4690ed975, now .9375rem like the hint)
- [NIT] web/index.html:1097 — 14% tint vs .swwarn's 9% (deliberate, recorded in the plan)
- [NIT] docs/browser-checks/render-gskills-ask-4450.js:112 — hard-coded fallback ground for a transparent card --> FIXED (commit 4690ed975, now asserts the card is opaque)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** the b8-board wiring (reviewer ran tools.browser-checks-wired: pass)
- [NIT] render-gskills-ask-4450.js:47 — only system light/dark emulated, not the manual data-theme toggle (the forced-dark block defines the same tokens)
- [NIT] web/index.html:1096 — the tint mixes over transparent, so it relies on sitting in an opaque .dbox (the check asserts that)
- [NIT] plan — a PASS count that will drift --> FIXED (commit 52b905921)
**Converged** — no new actionable findings.

#### CI finding between runs (not a reviewer pass)
- [BLOCKER] docs/browser-checks/gated.txt — the check was also listed in gated.txt, whose loop runs each check with NO address; CI run 36508158520 passed it on B8, then failed it twice on the default port --> FIXED (commit 910c9d2b0): removed from gated.txt; it runs only on B8 with the board URL, like render-openai-key-callout-2164. Missed by iterations 1 and 2 and by every index test (none of them checks for a B8 check listed in the no-address loop).

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- The reviewer independently traced every way a check is invoked (B8 run_one, b8-board.txt, gated.txt, the CI allowlist, bc-pr-select) and confirmed this one now always receives its board URL.
- [NIT] default URL fallback when run by hand; [NIT] width assertion weaker than the overflow one; [NIT] SHOTS path on a missing card; [NIT] manual data-theme toggle not exercised
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | docs/browser-checks/b8-board.txt | BRANCH | check missing from the $B8 board roster | FIXED | 4690ed975 |
| 2 | 1 | WARNING | web/index.html:1097 | BRANCH | note text smaller than the body under it | FIXED | 4690ed975 |
| 3 | CI | BLOCKER | docs/browser-checks/gated.txt | BRANCH | check in the no-address gated loop | FIXED | 910c9d2b0 |

### Validation
- Final validation (6j) on 910c9d2b0: PASSED, hash e8f8bed879da, 11479 node tests / 0 fail, shell suites clean, subdir audit clean.
- Browser check render-gskills-ask-4450 against a sandboxed board: all PASS in light/dark x desktop/phone; negative control (note line removed) reds all four runs.

### NITs (non-blocking, across all iterations)
- [NIT] tint strength differs from .swwarn on purpose (iteration 1)
- [NIT] manual data-theme toggle not exercised by the check (iteration 2)
- [NIT] the tint depends on an opaque card behind it, asserted by the check (iteration 2)

### Strengths (across all iterations)
- A flat <p>: no role, not focusable, nothing to press, no pointer cursor, asserted in computed styles (iterations 1, 2)
- Contrast computed against the real composited ground with an arithmetic control that can fail (iterations 1, 2)
- Colours follow the stylesheet's recorded contrast rules; no em dashes (iteration 1)
