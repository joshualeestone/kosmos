---
pre_challenge: true
method: challenge-loop
branch: toggle-farright-2194
diff_hash: 7b6391cfb7a14ead1c04a709dcbae01455557335fbfd1a8237fccfc7fd902b69
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T03:34:54Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 returned zero NEW BLOCKER/WARNING/CONVENTION)
**Total findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Fixed:** 1 WARNING | **Deferred:** 1 NIT | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs
- [WARNING] web/index.html — the reorder was applied to the header only, so the header
  (`themepick -> laypick`) and the consolidated-view rail (`laypick -> themepick`) rendered
  the toggle and the light/dark switcher in OPPOSITE orders; a person flipping between the
  tabbed and consolidated views would see the two controls swap sides --> FIXED (commit
  5f748034): reordered the rail (`#rail-me`) to match the header (toggle far-right in both),
  added a rail position arm to the browser-check, and cross-referenced the now-superseded
  "far right" prose in `render-theme-toggle.js` (verbatim Josh quote preserved, bracketed
  note added). Both flex containers are order-agnostic (no `order:`/`row-reverse`, no
  adjacency selectors on the old order), verified.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Converged** — no new actionable findings.
- [NIT] render-viewtoggle-header-2154.js:77 (and the rail arm ~:103) — the position arms
  `layLeft >= thRight` do not co-assert `thRight > 0`, so a `.themepick` collapsed to zero
  width would let a visible `.laypick` pass vacuously --> DEFERRED: the reviewer judged it
  "not a real gap"; each arm is preceded by a `visible()` guard on `.laypick` and
  `.themepick`'s presence/render is covered by the other assertions in the same check, so
  the vacuity is theoretical (the whole header would have to render while the switcher alone
  collapsed to zero width). Left as an ordering check with an implicit, covered dependency.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html | Header/rail toggle+switcher swap sides between views | FIXED | 5f748034 |
| 2 | 2 | NIT | render-viewtoggle-header-2154.js | Position arm doesn't co-assert thRight>0 | DEFERRED | Theoretical; guarded by visible() + covered elsewhere |

### Strengths (across all iterations)
- The reorder is genuinely safe: both `.headright.appright` and `#rail-me` are horizontal
  flex with no `order:`/`row-reverse` and no adjacency/nth-child selectors keying on the old
  order; DOM order equals visual order (an incidental tab-order improvement). The two
  order-sensitive tests (`web.theme.test.js` stamp-left-of-switcher, `web.layout-picker.test.js`
  count-within-window) still hold under the new order.
- The change recognized that a header-only reorder would swap the controls between the
  tabbed and consolidated views, and reordered the rail to match, with a rendered position
  arm in each view. Both arms read laid-out geometry (getBoundingClientRect), so they
  genuinely red on the pre-#2194 layout (old `laypick.left < themepick.right`), not a DOM
  string read; each is preceded by a `visible()` assertion.
- Josh's 2026-08-22 quote in `render-theme-toggle.js` was preserved verbatim; only a
  bracketed supersede note was added. No em dashes introduced.
