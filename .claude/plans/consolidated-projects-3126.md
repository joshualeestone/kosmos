# Plan: #3126 - consolidated Projects column polish

Josh 6.68 feedback (kosmos#3126), consolidated view Projects column:
1. REMOVE the "<" collapse control - the Projects column should NOT be collapsible.
2. The tree triangle is tiny ("grain of pepper") - make it MUCH bigger.
3. Tighten the line spacing between projects so they sit closer together.

Surface: `web/index.html`, consolidated layout only (`html[data-layout="consolidated"] body.consolidated`, inside the `@media (min-width: 960px)` block). Scoped to the projects rail (`#pj-list` / `#rail-projects` / `.pjtreefold`); the Projects TAB and the Agents column are untouched.

## Definition of done
- The projects-column fold "<" button is gone from the DOM; the column can never enter the folded (`fold-p`) state by any path (no button, no narrow-width auto-fold for projects).
- The "Projects" head stays horizontally aligned with the "Agents" head (the removed 22px button + 7px gap is replaced by a CSS inset, not left to shift).
- The tree fold caret (`.pjtreefold`) in the consolidated rail is visibly larger (font-size 10px -> 15px, box 16px -> 20px, robust vertical centering) without overlapping the project title (gutter widened).
- Inter-project spacing is tighter (`#pj-list` gap 8px -> 4px; `.pj-row` vertical padding 8px -> 5px).
- Node test suite green; CI browser-checks green, including a new/extended check asserting the structural facts (no `#rail-projects-fold`, `fold-p` never applies, caret enlarged).
- No literal script-tag token in any web/index.html comment (breaks slice tests). Em-dash swept (checker absent here).

## Edits (all in web/index.html)
- **A. Remove collapse control**
  - Delete the `#rail-projects-fold` button element (the `&lsaquo;` fold button) from the Projects railhead; keep `.railname`.
  - `railFoldsApply()`: change `for (const k of ['a','p'])` -> `['a']` and explicitly `document.body.classList.remove('fold-p')` so any stale/narrow state clears; projects never folds. Agents keeps its fold. (The `[data-fold]` click handler then binds only agents.)
  - Add CSS keeping the projects head aligned: `#rail-projects .lead { padding-left: 29px }` (= 22px button + 7px `.lead` gap). Dead `fold-p` CSS rules are left inert (removing a control != removing unrelated rules; leaving them is lower-risk).
- **B. Bigger caret** - `.pjtreefold` (consolidated): font-size 10px->15px, width/height 16px->20px, `top:50%;transform:translateY(-50%)` (robust vs row-height change); widen gutter: `#pj-list .pj-row` padding-left `calc(24px...)` -> `calc(28px...)`, caret `left calc(6px...)` -> `calc(4px...)`.
- **C. Tighter spacing** - `#pj-list { gap: 8px }` (line ~3718) -> `4px`; `.pj-row { ...padding: 8px 10px }` (line ~3735) -> `5px 10px`.

## Decisions / weakest premises (documented on the card)
- "Not collapsible" implemented as: no button AND no narrow-width auto-fold for projects. Weakest premise: that dropping projects auto-fold below `CONSOLIDATED_FOLD_WIDTH` (1280px) does not crowd the 960-1280px consolidated band. Agents can still fold to make room. If it crowds, that is a follow-up; Josh's instruction is explicit.
- Magnitudes (caret 15px, gap 4px, padding 5px, inset 29px) are reasoned defaults, not pixel-verified - this night-shift session has no browser/claude-fe. Josh reviews in the running app; disclosed on the PR + card so he knows exactly what to eyeball.
- Head alignment preserved (vs letting "Projects" go flush-left) because this file has meticulous head-alignment history; conservative default. Reversible.

## Coordination
Overlaps Mona's consolidated cards (#3127 drag indicator, #3128 cog placement) on the same rail region. First-to-land, other rebases; HEADS-UP Mona before merge.
