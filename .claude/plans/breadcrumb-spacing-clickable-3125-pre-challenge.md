---
pre_challenge: true
method: challenge-loop
branch: breadcrumb-spacing-clickable-3125
diff_hash: 774f8fc0c9a58b9dffd442a0879bde1a554c1b212815c0895cfd651e122a5e50
validation: passed
subdir_audit: passed
timestamp: 2026-09-15T23:03:26Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (blind opus; zero new actionable findings on the first pass)
**Converged:** Yes
**Total findings:** 0 BLOCKER / 0 WARNING / 0 CONVENTION-defect (1 benign CONVENTION note, kept by design)

### What the change is (card #3125, Josh 6.68 feedback)
The project-detail breadcrumb gets (1) visible space around the slash ("A  /  B", not "A/B") and
(2) clickable ANCESTOR crumbs that jump straight to that project, with NO underline. The current
"you are here" crumb is never a link.

- CSS: `margin: 0 5px` on `.pj-crumb-sep` (space is margin, not text, so it never double-counts
  with collapsed inline whitespace); a `.pj-crumb-link` class (pointer, no text-decoration,
  focus-visible outline).
- `paintOneProject` crumb block: builds an ancestor `{id,name}` chain inline, mirroring
  `pjAncestry`'s self/loop guard + `p.parentName` fallback but keeping the id; renders each
  ancestor-with-id as `<span class="pj-crumb-link" role="link" tabindex="0" data-project="ID">`,
  ancestor-without-id as plain text, current as plain `.pj-crumb-cur`.
- A delegated `#pj-crumb` click+keydown handler (set once, beside `#pj-back`) -> `openProject(id)`,
  mirroring the list card's `data-project` -> `openProject` pattern.

### Iteration 1 (opus, blind) -- CONVERGED
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION-defect. The reviewer hand-traced:
- Ancestor walk k->app->mob yields `ancNodes = [{k},{app}]` root-to-current (no reversal); matches
  `pjAncestry` exactly incl. the self/loop guard and `parentName` fallback.
- Top-level project: no lead, single non-link current crumb. Unloaded parent (`parentName`, no id):
  plain text, never a dead link.
- `data-project="' + esc(node.id) + '"'` is byte-identical to the list-card convention (line
  ~36850); `esc()` escapes `"`/`&`, correct for a double-quoted attribute; `dataset.project`
  round-trips to the true id -> no XSS, no wrong-id.
- `openProject` is a hoisted declaration, in scope at the IIFE; the listener is delegated on the
  persistent `#pj-crumb`, so re-`innerHTML` never rebinds/orphans it.
- Current crumb never clickable; `.pj-crumb-lead` truncation protection intact (margin adds inline
  width but does not defeat ellipsis; the current-crumb sep is still the `flex:none` direct child).
- No isolation test lifts+evals `paintOneProject` or the crumb block, so the inline walk is safe.
- No em dashes (all five spellings).

**One benign CONVENTION note (kept, not a defect):** activating a `role="link"` on Space is
slightly non-standard (native links use Enter), but here it is additive and forgiving --
`preventDefault` fires only when a link matched, so Space navigates without page-scroll and Enter
also works. Kept deliberately as a keyboard convenience.

### Validation
- Full node suite: tests 7705, pass 7567, fail 0, cancelled 0 (VAL_EXIT=0).
- Browser-check surface gate 0 FAILED; bc-surface-map 0 FAILED; the new `pj-crumb-link` surface
  token is mapped to render-subprojects-1994.js (5 functional lines). `#1720` gate satisfied by
  touching the browser-check (no trailer needed at PR time).
- The render-subprojects-1994.js RUNTIME assertions (ancestor crumbs are clickable links
  root-to-current; current is not a link; sep margin > 0; clicking 'app' navigates to it) are
  executed by the **CI browser-checks job** (the local suite skips the headless render on a
  no-Playwright machine). The blind reviewer independently confirmed each assertion FAILS on
  origin/main (plain-text crumbs, zero margin, a click that goes nowhere) -> non-vacuous.

### Browser-check (#1720 / #2518)
web/index.html is a rendered/interactive surface change (clickable crumbs). Coverage added to
docs/browser-checks/render-subprojects-1994.js (executable assertions), and `pj-crumb-link` added
to its `Browser-check-surface:` line so the #2518 surface gate maps future changes to it.
