---
pre_challenge: true
method: challenge-loop
branch: backcrumb-2928
diff_hash: 3cd1b7e6dc50a5cb7379a50047a2d93947b784da4c2ba450af182469744ee44d
validation: passed
subdir_audit: passed
timestamp: 2026-09-13T03:14:04Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (this run; two prior-session fix iterations preceded and are folded into the branch history)
**Converged:** Yes (iteration 3 found zero new findings)
**Total findings:** 7 (1 BLOCKER-synthetic, 1 WARNING, 1 CONVENTION, 4 NITs)
**Fixed:** 5 | **Deferred:** 2 | **Asked (awaiting user):** 0

The card: on the project-detail screen, replace the removed "All Projects" back arrow with a
top-left back chevron (up one nesting level, or to the projects list at top) plus a full-location
breadcrumb "Project / Subproject / ThisProject", retiring the old #pj-one-parent ancestor trail.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty at this point; no fix had committed yet)
- [WARNING] web/index.html breadcrumb -- no elision/cap; a single overflow:hidden container end-truncates the TAIL, so a deep chain or long name hides the current project's own name (the "you are here" info) while keeping the least-useful root --> FIXED (commit 7c9ed15b: current project rendered as a protected .pj-crumb-cur crumb; ancestors in .pj-crumb-lead which carries the ellipsis and shrinks first)
- [NIT] web/index.html -- `<nav aria-label="Project location">` wrapping non-interactive spans presents an empty landmark to assistive tech --> FIXED (7c9ed15b: changed to `<p>`, aria-label dropped so the crumb text is not suppressed)
- [NIT] web/index.html #pj-back -- generic `aria-label="Back"` gives no target context --> FIXED (7c9ed15b: aria-label set dynamically to "Back to <parent>" / "Back to all projects")

#### Iteration 2
**Reviewer model:** opus
**New findings:** 1 BLOCKER (synthetic, from 6g validation), 0 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 2 (the CONVENTION and the separator NIT cite lines the iteration-1 fix 7c9ed15b added; both are real structural/consistency refinements, not regenerated prose comments, so no kosmos#120 spiral)
**Duplicates of prior findings (confirmed resolved):** 0
- [BLOCKER] initial/6g validation: test-staging-agent-online-check failed on `mktemp: ... No such file or directory` (its temp base vanished mid-run, a concurrent-tempdir race) --> DEFERRED (transient environment failure, not the change: node suite 6665 pass / 0 fail, the CSS/JS breadcrumb change cannot touch a staging-agent-online shell test; the test passes "all arms passed" in isolation and the full-validation re-run came back green)
- [CONVENTION] web/index.html #pj-crumb -- the `<p>` container deviates from the plan's `<nav aria-label="Project location">` --> FIXED (commit 920712df: the `<p>` is the corrected a11y choice from iteration 1; recorded the deviation and its reason in the plan's "Challenge-loop refinements (as-built)" section, so plan and code agree)
- [NIT] web/index.html -- the separator before the current crumb sat INSIDE the truncatable lead, so hard truncation ate it ("Kosm… Mobile" with an ambiguous gap) --> FIXED (920712df: moved the separator outside the lead as a `flex: none` child of .pj-crumb, so it stays visible)
- [NIT] web/index.html:2735 -- `align-items: baseline` aligns two overflow:hidden children whose baseline is synthesized from the border box --> DEFERRED (reviewer verified harmless: both crumbs share font-size/height so their edges coincide; changing it blind from this headless session risks an unverifiable vertical shift for no confirmed gain)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0
**Converged** -- no new findings; six STRENGTHs confirming the selector scoping, XSS escaping, falsifiable browser-check assertions, the count guard, plan/code agreement, and clean removal of #pj-one-parent.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html breadcrumb | BRANCH | No elision; tail-truncation hides the current project name | FIXED | 7c9ed15b |
| 2 | 1 | NIT | web/index.html #pj-crumb | BRANCH | nav landmark wraps non-interactive spans | FIXED | 7c9ed15b |
| 3 | 1 | NIT | web/index.html #pj-back | BRANCH | generic "Back" aria-label | FIXED | 7c9ed15b |
| 4 | 2 | CONVENTION | web/index.html #pj-crumb | SELF | `<p>` deviates from plan's `<nav>` | FIXED | 920712df (plan as-built note) |
| 5 | 2 | NIT | web/index.html breadcrumb | SELF | trailing separator inside truncatable lead | FIXED | 920712df |
| 6 | 2 | NIT | web/index.html:2735 | SELF | align-items:baseline on overflow children | DEFERRED | harmless (same-size crumbs); blind change risks unverifiable shift |
| 7 | 2 | BLOCKER | tools/test-staging-agent-online-check | BRANCH | 6g validation mktemp/tempdir race | DEFERRED | transient env, not the change; passes isolated; re-run green |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- align-items:baseline on overflow:hidden crumb children (iteration 2) -- deferred, harmless.

### Strengths (across all iterations)
- Back target recomputed at click time from pjById(PJ_CURRENT), so a poll repaint between paint and click cannot stale it; the click handler and the paint-time aria-label share the identical p.parent && pjById(p.parent) guard, so an orphan project consistently both says and does "Back to all projects" (iterations 1-3).
- Security clean: every project name escaped via esc() before innerHTML in both breadcrumb branches; the dynamic back-button label set via setAttribute, never innerHTML (iterations 2-3).
- The lead/cur flex split genuinely protects the current name (flex 0 999 auto vs 0 1 auto with min-width:0), and the child-combinator `.pj-crumb > .pj-crumb-sep { flex: none }` correctly targets only the between-lead-and-cur separator, not the inter-ancestor separators inside the lead (iterations 2-3).
- The browser-check was upgraded from a presence check to real navigation + structural assertions: it clicks #pj-back and asserts PJ_CURRENT/PJ_VIEW for both the subproject-to-parent and top-level-to-list cases, asserts the protected-crumb DOM structure, and asserts root-to-current ordering via indexOf (catching a reversed concatenation a substring test would miss) -- controls that can return the dangerous answer (iterations 1-3).
- web.consolidated-980.test.js count guard (pjMarkOpen(null), 5 -> 6) is an exact-count pin with a comment-strip control; independently re-counted the six real call sites (iterations 1-3).
- Plan file carries a rigorous "Challenge-loop refinements (as-built)" section and the shipped code matches every as-built note (iterations 2-3).
- No live reader of the retired #pj-one-parent survives anywhere; only a descriptive historical comment mentions the old id (iterations 1-3).
