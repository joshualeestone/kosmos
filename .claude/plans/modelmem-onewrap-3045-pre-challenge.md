---
pre_challenge: true
method: challenge-loop
branch: modelmem-onewrap-3045
diff_hash: b32ae0c81268b3f436fbee11958553bdbcd91a4add1c6dc08a37af7814116e0c
validation: "node suite clean (0 fail); browser-check surface (#2518) + coarse (#1720) gates pass; render-agent-nav.js #3045 arm passes light+dark in the bold on-state; full shell suite under fleet contention, deferred to CI"
subdir_audit: passed
timestamp: 2026-09-14T17:43:03Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (6.0 validation = iter 1; four blind passes)
**Converged:** Yes, witnessed by two reviewer models (opus iters 2+4, sonnet iters 3+5)
**Total findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, several NITs
**Fixed:** 2 WARNINGs + 1 CONVENTION + 4 NITs | **Deferred:** 0 actionable | **Asked:** 0

### Per-Iteration Breakdown
- **Iter 1 (6.0 validation):** node suite 0 fail; surface + coarse gates verified exit 0 proactively. Shell suite under contention, deferred to CI.
- **Iter 2 (opus):** [NIT] selector was `.snav button[data-go="model"]` (shared with #s-nav) --> FIXED: anchored to `#d-nav button[data-go="model"]` (structural scope).
- **Iter 3 (sonnet):** [WARNING] the arm only checked height (oneLine), which nowrap makes true by construction, so a horizontal OVERFLOW would pass --> FIXED: added `noOverflow` (scrollWidth <= clientWidth). [CONVENTION] plan said `.snav`, code said `#d-nav` --> FIXED (plan updated).
- **Iter 4 (opus):** [WARNING] the arm measured at landing (base font-weight 500), but `.snav button.on` is 600 (wider, the state the user sees) --> FIXED: moved the measurement into the pill loop where model is `.on`/bold; verified one line + no overflow at bold (scrollW 174 == clientW 174, both themes).
- **Iter 5 (sonnet):** zero BLOCKER/WARNING/CONVENTION. [NIT] add an overflow/ellipsis fallback for the WKWebView weakest premise --> FIXED (overflow:hidden; text-overflow:ellipsis, purely additive, invisible today). CONVERGED.

### The fix
`#d-nav button[data-go="model"] { white-space: nowrap; padding-left: 18px; padding-right: 18px; overflow: hidden; text-overflow: ellipsis; }` in web/index.html. The "Model and Memory" pill (the longest label, #2916) wrapped to two lines in the fixed 176px `.snav` column. nowrap + 18px sides (from 28px) keeps it one line with slack; anchored to #d-nav (structural, no leak to #s-nav); ellipsis fallback for render variance. Longhand padding preserves the inherited 8px top/bottom.

### Verification
- render-agent-nav.js `#3045` arm (server + fixture fleet, light + dark): measures the model pill in its `.on` bold-600 state (worst case), asserts oneLine (height == a single-word pill) AND noOverflow (scrollWidth <= clientWidth). Passes.
- Negative control (rule removed): the arm FAILS in both themes (model 50 vs 34, wrapped), proving discrimination.
- Surface (#2518) + coarse (#1720) gates exit 0. Node suite 0 fail. No em dashes, no `<tag>` comment tokens.

### Outstanding questions (ASKED): None.

### Strengths
- Structural #d-nav scope prevents any #s-nav leak; longhand padding preserves top/bottom; specificity (1,1,1) cleanly overrides base .snav button (0,1,1) without !important.
- The check was iterated to measure the actual worst-case state (bold .on) with a relative height comparison (survives font/padding tuning) plus a forward overflow guard; a documented negative control proves it can fail.
