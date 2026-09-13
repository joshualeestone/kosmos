---
pre_challenge: true
method: challenge-loop
branch: constree-fold-2929
diff_hash: dc7f0bb2d80abee366a942883fa0b3c66d6c3d4335a24979fbc16974fbcd575d
validation: passed
subdir_audit: passed
timestamp: 2026-09-13T07:33:54Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (iteration 1 = the 6.0 initial-validation fix-and-validate pass; iterations 2-6 = blind reviews)
**Converged:** Yes (iteration 6 found no BLOCKER/WARNING/CONVENTION findings)
**Reviewer models:** rotated across two models (kosmos#2032) so convergence is witnessed by both, not one out of ideas.
**Total findings:** 1 BLOCKER, 6 WARNINGs (1 a duplicate of a deferred item), 8 NITs, plus strengths.
**Fixed:** 11 | **Deferred:** 3 (+1 duplicate skipped) | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation)
**Reviewer model:** n/a (helper pass, no sub-agent)
**New findings:** 1 BLOCKER
**Self-generated:** 0 (nothing had committed yet as a loop fix; the synthetic finding is BRANCH by instruction)
- [BLOCKER] initial-validation: the #2518 browser-check surface gate flagged that web/index.html changed the `pj-parent` surface `render-subprojects-1994.js` asserts, but that check was not updated. A genuine #2929-vs-#2487 conflict: its rail layer asserted a nested child's ancestry chip is DISPLAYED in consolidated, which #2929 hides on `.child` rows; it passed only because the layer set `body.consolidated` without `data-layout`, so the #2929 rule never fired. --> FIXED (commit 0f2bd62): retargeted the rail test to the real consolidated state (nested chip hidden; orphan chip kept to preserve the `.pj-anc` rule coverage).

#### Iteration 2 (blind review 1)
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 1 NIT
**Self-generated:** 0 of the above
- [WARNING] render-cons-tree-2929.js:10 — docblock claimed it drives the #pj-list click delegate, but folding was only driven via pjTreeToggleFold() directly. --> FIXED (commit 65e38be): added a layer dispatching a real caret click (folds + must NOT open) and a row-body click (opens), verifying the fold-before-open ordering through the shipped delegate.
- [WARNING] web/index.html — aria-expanded on a button whose Enter opens the project rather than toggling the fold; no role=tree. --> DEFERRED: the documented plan-#3 tradeoff; aria-expanded + arrow-key fold is the ARIA tree convention and beats no signal; a full role=tree/treeitem refactor (roving tabindex, container role) is a separate a11y pass beyond slice 1 that needs real screen-reader testing.
- [NIT] plan decision #4 — said the indent "caps at depth 3"; it grows unbounded. --> FIXED (commit 65e38be): corrected the wording.

#### Iteration 3 (blind review 2)
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 2 NITs
**Self-generated:** 0 of the above (all on original feature code)
- [WARNING] web/index.html — applyConsFold re-wrote aria-expanded (and the caret glyph / fold class) unconditionally on every ~5s poll, so a screen reader re-announced "expanded"/"collapsed" every poll (the exact churn setLive documents). --> FIXED (commit cad75e4): compare-before-write on each write; MutationObserver regression test with a live-observer control.
- [NIT] web/index.html — a resize below the consolidated width leaves a stale aria-expanded for one poll, during which an arrow press could toggle a fold in the tab list. --> FIXED (commit cad75e4): the keydown handler now gates on body.consolidated; test with a simulated stale attr.
- [NIT] render-cons-tree-2929.js — the caret-hidden control did not cover the asgrid grid sub-view. --> FIXED (commit cad75e4): added the grid assertion.

#### Iteration 4 (blind review 3)
**Reviewer model:** opus
**New findings:** 1 WARNING, 2 NITs
**Self-generated:** 0 of the above (the divergence was in original feature logic)
- [WARNING] web/index.html — applyConsFold built the folded-descendant hide-set from pjDescendantIds (raw PROJECTS, archived included), but pjTreeRows re-homes a child of an archived/dangling parent to the top level. Folding a parent with an archived intermediate could hide a row drawn as an unrelated top-level project, vanishing it. --> FIXED (commit c74d2230): rewrote applyConsFold to compute hiding from the RENDERED rows' --pj-depth (a running cutoff), the single source of truth; Layer 9 re-home regression test.
- [NIT] web/index.html — the fold-set prune skipped the empty-state early returns. --> FIXED (commit c74d2230): moved the prune above the early returns so it runs every paint (all-archived case included).
- [NIT] web/index.html — the caret glyph is baked in two places (projectCard + applyConsFold). --> DEFERRED: deliberate and commented (a stable painted string keeps setLive from repainting on every fold), and it matches the Map view's own inline glyphs; a shared const is a cross-cutting cleanup for a separate pass.

#### Iteration 5 (blind review 4)
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 1 NIT (+1 WARNING that deduplicated to a deferred item)
**Self-generated:** 1 of the above (the redundant-guard NIT was on iteration 3's own compare-guard addition -- the loop catching its own over-engineering)
- [WARNING] web/index.html + render-cons-tree-2929.js — the PJ_TREE_FOLDED prune had no browser-check coverage. --> FIXED (commit 287cce9): Layer 10 -- fold a parent, archive it, repaint, assert its id is dropped, then un-archive and assert it returns expanded.
- [NIT] web/index.html — the compare-before-write guard on classList.toggle(token, force) is redundant (toggle is already idempotent). --> FIXED (commit 287cce9): removed it and commented why only the non-idempotent aria/text writes keep theirs.
- [WARNING] aria-expanded on a non-toggling button --> DUPLICATE of iteration 2's deferred a11y finding; skipped, deferral stands.

#### Iteration 6 (blind review 5)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** — no new actionable findings. The reviewer hand-traced the cutoff depth-walk across nested folds/siblings/hidden-parent/leaf/re-home cases, confirmed the JS `cons` gate and CSS scoping always agree, and confirmed the setLive churn guard.
- [NIT] web/index.html — aria-expanded is re-added on a DATA-CHANGING repaint (new DOM), re-announcing; the no-op-poll case is guarded. --> DEFERRED: inherent to the innerHTML-replacement model and affects the whole list; baking aria-expanded into the string to avoid it would be worse (full-list repaint on every fold).
- [NIT] web/index.html:3579 — the fold caret's fixed top:8px aligns to the title line on a two-line row (intentional; aligns to the project name). --> Noted for Josh's live review.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | render-subprojects-1994.js | BRANCH | #2518 surface gate: pj-parent surface conflict (#2929 vs #2487) | FIXED | 0f2bd62 |
| 2 | 2 | WARNING | render-cons-tree-2929.js | BRANCH | docblock overclaims click-delegate coverage | FIXED | 65e38be |
| 3 | 2 | WARNING | web/index.html | BRANCH | aria-expanded on a button whose Enter opens, not toggles | DEFERRED | plan-#3 a11y tradeoff; role=tree is a separate pass |
| 4 | 2 | NIT | plan #4 | BRANCH | "caps at depth 3" wording inaccurate | FIXED | 65e38be |
| 5 | 3 | WARNING | web/index.html | BRANCH | aria-expanded re-announced every ~5s poll | FIXED | cad75e4 |
| 6 | 3 | NIT | web/index.html | BRANCH | resize leaves stale aria-expanded; keydown could fold in tab | FIXED | cad75e4 |
| 7 | 3 | NIT | render-cons-tree-2929.js | BRANCH | grid sub-view caret-hidden uncovered | FIXED | cad75e4 |
| 8 | 4 | WARNING | web/index.html | BRANCH | hide-set from pjDescendantIds diverges from the re-homed render | FIXED | c74d2230 |
| 9 | 4 | NIT | web/index.html | BRANCH | fold-set prune skipped empty-state returns | FIXED | c74d2230 |
| 10 | 4 | NIT | web/index.html | BRANCH | caret glyph baked in two places | DEFERRED | deliberate; matches Map view's inline glyphs |
| 11 | 5 | WARNING | web/index.html | BRANCH | PJ_TREE_FOLDED prune untested | FIXED | 287cce9 |
| 12 | 5 | NIT | web/index.html | SELF | redundant compare-guard on classList.toggle | FIXED | 287cce9 |
| 13 | 5 | WARNING | web/index.html | BRANCH | aria-expanded non-toggling button (dup of #3) | DEFERRED | duplicate; deferral stands |
| 14 | 6 | NIT | web/index.html | BRANCH | aria-expanded re-announces on a data-changing repaint | DEFERRED | inherent to full-repaint; baking it would be worse |
| 15 | 6 | NIT | web/index.html:3579 | BRANCH | caret aligns to title line on a two-line row | DEFERRED | intentional; noted for live review |

### Outstanding questions (ASKED, still unresolved)
None.

### NITs (non-blocking, across all iterations)
- Fixed: plan wording (iter2), grid-sub-view coverage (iter3), redundant classList guard (iter5), fold-set prune in empty states (iter4).
- Deferred/noted: caret glyph in two places (matches Map convention); aria re-announce on data-changing repaint (inherent to the repaint model); caret vertical alignment on a two-line row (intentional, for Josh's live glance).

### Strengths (across all iterations)
- The rendered-depth cutoff walk (not pjDescendantIds) makes the render the single source of truth for folding, immune to the archived-intermediate / re-home / cycle divergence class.
- Consolidated-only scoping is enforced in both directions and in both layers (CSS `html[data-layout] body.consolidated` gate + JS `cons` gate, verified always in sync), so a rail fold never reshapes the shared #pj-list markup the tab list and grid reuse.
- Every browser-check assertion pairs its positive claim with a control that can return the dangerous answer (pre-fold visibility, indent-varies, no-op ArrowRight, caret-hidden-in-tab/grid, a live MutationObserver churn test with a real-fold control, the re-home test, the prune test), driven against the shipped functions and real delegates.
- The render-subprojects-1994 update corrected a test that had been passing for the wrong reason rather than silently dropping coverage.
- Model rotation (opus/sonnet) surfaced findings each model missed (the aria-churn WARNING and the redundant-guard NIT came from sonnet; the divergence WARNING from opus).
