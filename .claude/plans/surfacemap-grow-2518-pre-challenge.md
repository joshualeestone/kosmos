---
pre_challenge: true
method: challenge-loop
branch: surfacemap-grow-2518
diff_hash: 48d36cdaecbbd082bff13eba5cfd666f1de7fd48ea73f22f9e724d349b6cff4f
validation: passed
subdir_audit: passed
timestamp: 2026-09-09T04:07:20Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 5 (0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs)
**Fixed:** 3 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (first reviewer pass; ITER_COMMITS empty at spawn — the findings are on this branch's initial commit, treated as BRANCH)
- [WARNING] plan.md — plan claimed d-model-row/-msg "not-present"; FALSE (a zsh no-word-split bug in my scratch annotate helper false-skipped render-detail-openai-model) --> FIXED (ae0915b9): plan corrected; the tokens ARE present but also have prose-comment occurrences, so that check is left coarse.
- [WARNING] tools/test-browser-check-surface-map.sh — present_in_web did not escape ERE metacharacters, a parity gap vs the gate's esc_tok --> FIXED (ae0915b9): now escapes exactly as the gate does.
- [WARNING] render-adopt-1531 (fr-fleet-title) + render-createnav-2190 (create-msg) — each token has a prose-COMMENT occurrence in web/index.html, so a comment-wording edit would over-fire the gate --> FIXED (ae0915b9): both dropped, left coarse; kept only the 6 tokens whose occurrences are all functional.
- [NIT] all touched files lost their trailing newline --> FIXED (ae0915b9): re-annotated preserving each file's trailing newline.

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Duplicates of prior findings (confirmed resolved):** 0
**Converged** — no new actionable findings. The reviewer independently verified all 6 tokens present whole-token + low-count + functional-only (no over-fire), the test's exact gate match-parity, red-capability, and the wiring.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | .claude/plans/surfacemap-grow-2518.md | BRANCH | false "d-model-row/-msg not-present" claim | FIXED | ae0915b9 |
| 2 | 1 | WARNING | tools/test-browser-check-surface-map.sh | BRANCH | present_in_web missing ERE escape (gate parity gap) | FIXED | ae0915b9 |
| 3 | 1 | WARNING | render-adopt-1531 / render-createnav-2190 | BRANCH | token has prose-comment occurrence (over-fire) | FIXED | ae0915b9 (dropped) |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] all 8 originally-touched check files lost their trailing newline (iteration 1) --> FIXED (ae0915b9).
- [NIT] commit 26dcb9b6's subject says "+8" but the shipped net is +6 (iteration 1 dropped adopt + createnav). Cosmetic; the plan body and this proof say +6. Not amended (mid-branch amend would churn the diff_hash for a stale subject line).
- [NIT] the plan's Validation line count ("10 annotated") is loose; the actual is 8 annotated files (6 new + 2 seeds), 11 tokens. Cosmetic doc count; recorded rather than chased with a commit+validation cycle post-convergence.

### Strengths (across all iterations)
- Exact gate match-parity: the test escapes ERE metachars and matches with the gate's identical boundary regex + identical annotation-extraction sed + tr-split, so "present here" == "the gate can fire on it" (iteration 2).
- All 6 tokens present whole-token, low-count (2-5), functional-only (HTML id=, CSS selector, getElementById/closest) — no prose-comment occurrences, so no over-fire on a wording edit (iterations 1 and 2).
- The test is red-capable (planted-absent control) and non-vacuous (asserts the map is non-empty); validates the 2 seeds too (iteration 2).
- package.json test:shell wiring well-formed (bash -n then run, appended once), satisfying every-test-runs; Pete's #2525 gate untouched, incremental design keeps the map never falsely complete (iteration 2).
