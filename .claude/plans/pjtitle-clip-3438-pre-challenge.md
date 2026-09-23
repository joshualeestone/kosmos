---
pre_challenge: true
method: challenge-loop
branch: pjtitle-clip-3438
diff_hash: 0029a51d3fe1fdf95ee0850580b9a93a582e053bc1d354df471f429daae908ee
validation: passed
subdir_audit: passed
timestamp: 2026-09-23T04:19:14Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 across two runs (the branch was rebased onto origin/main mid-way to pick up merged #3423, which regenerated this proof). Iter 1 = the 6.0 surface-gate fix pass; iter 2 = sonnet blind (pre-rebase); iter 3 = opus blind (post-rebase), converged.
**Converged:** Yes (the post-rebase opus pass found zero new BLOCKER/WARNING/CONVENTION)
**Total findings:** 1 actionable (1 BLOCKER, synthetic, from the initial surface gate)
**Fixed:** 1 | **Deferred:** 0 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial fix-and-validate pass)
**Reviewer model:** n/a (orchestrator validation, no blind agent yet)
**New findings:** 1 BLOCKER
**Self-generated:** 0 (nothing loop-authored yet; the fix was a message-only trailer)
- [BLOCKER] initial-validation: the browser-check surface gate (#2518) flagged render-head-row.js -- the web/index.html change touches the `pj-one-name` surface token that render-head-row.js also asserts, and that check was not updated. --> FIXED (override trailer): render-head-row.js asserts the gear/name/search share one line (flex centering), NOT the title's line-height or box height, and it still passes 10/10 with the fix, so the honest resolution is a per-check `Browser-check-surface: render-head-row.js` override trailer. Verified render-head-row.js passes locally.
  - A concurrent full-suite run returned 59 failures; dismissed as CONTENTION (all tmux/board/launchctl integration-test timeouts at ~5000/20000ms under a live board + high load). Confirmed green-alone: server.sourcechannel-promote-2934.test.js (8/8) and server.socket-split.test.js (3/3) pass in isolation, and later full runs recorded fail 0.

#### Iteration 2 (pre-rebase)
**Reviewer model:** sonnet
**New findings:** 0
**Self-generated:** 0
Zero findings; the reviewer verified specificity, the layout/gear-centering non-regression, and the check's failable control.

#### Iteration 3 (post-rebase onto origin/main)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
**Converged** -- no new actionable findings. The rebase resolved one additive conflict in tools/browser-checks.sh (the runner list now holds both render-chip-filters-3423 and render-title-descender-3438); the reviewer confirmed the resolution is clean (no markers, no dupes, both present) and re-verified the fix, scope, and browser-check.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | (surface gate) render-head-row.js | BRANCH | web change touches pj-one-name surface; render-head-row not updated | FIXED | override trailer |

### NITs (non-blocking, iteration 3)
- render-title-descender-3438.js: the `lineHeight === 'normal'` fallback maps to ratio 1.2 (auto-pass); safe because 'normal' (~1.2) does not clip and the real pre-fix value is a concrete px (ratio 1.0, fails red). Latent soft spot only.
- the `overflow === 'hidden'` assertion relies on Chromium serializing the shorthand as one token; passes on the pinned pw-runtime.
- the check exercises only the consolidated 1.25rem layout; the fix is a unitless property that scales to the 1rem/1.375rem variants, so single-layout coverage is acceptable.
- the project-open click selector is unscoped; safe here (fresh load, one project) and would fail loud under Playwright strict mode rather than false-pass.

### Strengths (across all iterations)
- The fix adds line-height:1.2 to the EXACT existing rule (`.pjtitle #pj-one-name`) already applying the overflow:hidden that caused the clip, so there is no specificity gamble; no other rule sets line-height on this element; overflow:hidden + nowrap + text-overflow:ellipsis are all preserved (no truncation regression).
- Scope correctly bounded: #d-name already has the #3415 fix; #tk-title wraps (no overflow-hidden clip) and was left untouched.
- The browser-check drives a real server + consolidated render, reads the computed line-height on the live element, is red-capable (ratio 1.0 pre-fix FAIL, 1.2 fixed PASS), and guards the truncation invariant (overflow/nowrap preserved).
- The rebase resolution is clean: both checks present exactly once, list intact, new check wired into runner + README + surface annotation.
