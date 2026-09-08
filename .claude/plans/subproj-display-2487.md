# Plan: sub-project hierarchy display (kosmos#2487)

## Goal
Make parent -> child -> grandchild -> great-grandchild depth legible on the Projects
views, and add a sub-projects section to the project detail page. Josh 2026-09-07:
grid "parent/child info is chunked in messily", list "how we show ... even GRANDCHILD
... maybe mouseprint", detail "add a subprojects section on the design page".

Design approved by Angel + Splinter (mockup at
~/.cache/claude-handoffs/kosmos-2487-subproject-display-mock.png).

## What "done" looks like
- Grid + narrow rail: each sub-project card/row shows its FULL ancestry as a compact
  "mouseprint" line ("Kosmos > App > Mobile"), not just the immediate parent, so a
  grandchild is not mistaken for a top-level project. Small decorative depth dots.
- Deep chains middle-elide, keeping root + immediate parent, so a long path never blows
  a grid tile (Angel).
- Detail page: a parent trail above the name and a "N sub-projects" section listing the
  project's direct children (each an open-on-click row).
- A11y: depth dots aria-hidden; the ancestry names are live text (the accessible depth
  signal, Angel); unread badge already carries aria-label + >=3:1 contrast (verified).

## Implementation
- `pjAncestry(p)` (new): the root-first name chain via pjById, with a self/loop guard;
  falls back to p.parentName for a dangling parent.
- `projectCard`: the single "under <parent>" chip becomes the ancestry line + dots.
  Keeps the `pj-parent` class so the wide-list indent rule still hides it there (the
  indent carries depth in the one view with room).
- `paintOneProject`: fills #pj-one-parent (ancestry trail) and #pj-one-subprojects
  (direct children as `data-project` open-buttons). #pj-one-subprojects lives in
  #pj-one-view (a sibling of #pj-list), so the list's click delegate does NOT reach
  it; a dedicated click delegate on #pj-one-subprojects opens the rows (added
  because iteration 1 caught the rows inert without it).
- Markup: #pj-one-parent in .pjtitle above the name; #pj-one-subprojects between .pjhead
  and .pj3 (OUTSIDE the view-order-sensitive members/files/tasks grid, so it cannot
  disturb the deliberate tab-vs-consolidated ordering).
- CSS for .pj-anc / .pj-dots, .pj-one-parent, .pj-subs / .pj-subrow.
- `docs/browser-checks/render-subprojects-1994.js`: chip-text assertions updated to the
  ancestry line, plus new assertions for the full chain, the aria-hidden dots, and the
  detail parent-trail + sub-projects section.

## Deferred (documented on #2487)
- Grid family-block grouping (bordered per-family containers from the mockup): the render
  emits one markup shared by grid/list/rail via CSS, so family blocks would need
  view-conditional markup (a structural change). The ancestry line + the existing
  depth-first order already deliver grandchild-visibility and contiguous families, so the
  blocks are polish deferred against the structural cost.
- Rail capped-indent + guide line: the ancestry line already carries depth in the rail.

## Verification
- pjAncestry has a committed node test (web.pj-ancestry-2487.test.js): chains at each
  depth, dangling-parent fallback, and the self/two-node cycle guard.
- Syntax + whole-file tag balance checked. Badge contrast computed (>=3:1 both grounds).
- Actual CSS + emitted markup static-rendered, matches the approved mockup.
- The rendered-view behaviour is covered by render-subprojects-1994.js (CI Playwright).
