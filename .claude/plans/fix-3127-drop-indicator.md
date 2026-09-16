# Plan: #3127 - drag-drop placement indicator on consolidated project reorder (6.68)

## The ask (Josh, 6.68)
In the consolidated view, when dragging/dropping a project to reorder, show a LINE between
projects indicating where it will drop (placement feedback). Owner: Mona; DnD wiring is my lane
(split agreed with Mona: #3127 + #3134 are mine).

## Surface
The consolidated cluster drag-reorder lives in `wirePjClusterDrag` (web/index.html ~37231):
dragstart marks the source `.pj-dragging`, dragover marks a valid target (preventDefault), drop
computes the new top-level order (before/after the target by which half the pointer is over) and
repaints. Today there is NO visual indication of where the drop will land.

## Approach (CSS + a few lines of JS, consolidated-only)
- On `dragover` over a valid top-level target row, set `.pj-drop-before` (pointer in the upper half,
  drop ABOVE the target) or `.pj-drop-after` (lower half, drop BELOW) on that row. This is the SAME
  before/after split the drop handler uses (`e.clientY > rect.top + rect.height/2` => after), so the
  line always matches where the drop will actually land.
- The line is a CSS pseudo-element (`::before` at top, `::after` at bottom) sitting in the 4px gap
  between rows (top/bottom -3px), 2px tall, in the brand gold (`--gold-bright`, the primary-button
  colour), `pointer-events: none`. Scoped to `html[data-layout="consolidated"] body.consolidated #pj-list`.
- Cleared whenever the drag ends (`endDrag` runs in both the drop and dragend paths) and when the
  pointer moves off a valid target (a new dragover clears the prior row's line first; dragover over
  the dragged row itself clears and shows nothing).

## Why this reading
Minimal, matches the existing drag idiom (like `.pj-dragging`), consolidated-only (the reorder drag
is consolidated-only), and the line's before/after is derived from the same math as the drop so the
feedback can never disagree with the outcome.

## Verification
- Extended `docs/browser-checks/render-cluster-reorder-2929.js` (already drives the synthetic
  DragEvents) with a drop-line arm: upper-half dragover sets pj-drop-before, lower-half sets
  pj-drop-after, moving to another row clears the prior line, dragover the dragged row shows no line,
  and the line is gone after drop+dragend. Both themes. 52/52 pass. Surface annotation updated with
  the new tokens.
- No browser this session for the pixel line (the CSS pseudo-element): asserted structurally via the
  class mechanism; Josh eyeballs the rendered line in-app after publish.

## Coordination
- Consolidated view overlaps Mona's #3131 (task-card stroke + agents column) and #3129/#3132/#3133.
  Ping Mona before merging #3127; first-lands-other-rebases. Also stagger against my own #3134 (a
  different region of web/index.html, disjoint, but same file).

## Weakest premise
That the gap-line (in the 4px inter-row gap) reads clearly at all row heights and both themes without
a browser to eyeball it. Mitigated: gold is the brand accent (high contrast in both themes), 2px is a
standard indicator weight, and the class mechanism is structurally tested. Reversible (CSS-only line).
Josh reviews the rendered result in-app.
