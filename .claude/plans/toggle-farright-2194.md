# Plan: move the board-view toggle to the far right, past the light/dark switcher (#2194)

## Goal / what "finished" looks like

Josh, 0.6.30 test 2026-09-04: move the tab-vs-consolidated board-view toggle (the #2154
`.laypick`) all the way to the far right of the header's top-right controls, to the OTHER
side of the light/dark switcher (`.themepick`). Pure placement. Done when: in the tabbed
view the toggle renders to the right of the switcher, and everything else about the toggle
(behavior, persistence, the consolidated-view rail copy, the 960px gate) is unchanged.

## Approach

The top-right controls live in `.headright.appright`, which is `display:flex; gap:14px;
justify-content:flex-end` -- order-agnostic, no margin adjacency, and no CSS sibling
selector keys on the old order (verified). So this is a pure DOM reorder:

1. `web/index.html`: move the `.laypick` block from before `.checked`/`.themepick` to
   AFTER `.themepick`, so the header order becomes `.checked` -> `.themepick` -> `.laypick`
   -> burger. The toggle is now the far-right control. Updated the #2154 comment ("to its
   right" -> "to its left", + the #2194 note) so the prose stays accurate.
2. `docs/browser-checks/render-viewtoggle-header-2154.js`: added a RENDERED position arm --
   `.laypick.getBoundingClientRect().left >= .themepick...right` -- so CI asserts the new
   placement and it reds on the pre-#2194 page (where the toggle was to the switcher's left).
   Updated the opening sentence + README row to match.

Scope: the card names the header's top-right controls, but the same two controls are
duplicated in the consolidated-view rail (`#rail-me`, also horizontal flex). A header-only
change would make the toggle and switcher SWAP sides when a person flips between the tabbed
and consolidated views. So this also reorders the rail to match (`railme-theme` then
`railme-lay`, toggle far-right there too) -- consistency across the two views, a reversible
call per Josh's ruling; the rail comment carries the reasoning. Added a rail position arm to
the browser-check too. Also added a bracketed `[superseded by #2194]` cross-reference in
`render-theme-toggle.js` (whose docblock quoted Josh's 2026-08-22 "light/dark is the far
right", now no longer the layout) -- the quote itself is kept verbatim; that check's own
geometry arm (stamp left of the switcher) is unaffected.

## Verification

- Self-booting probe (srv.start(0), tab view): `.laypick` left=1298 >= `.themepick` right=1284,
  `.laypick` is DOM-after `.themepick` and visible -- the toggle sits to the right of the
  switcher. Reds on the old order (laypick left of themepick -> left < right).
- The committed browser-check arm runs in CI via the driver's boot_board (the #2154 check is
  already wired there).
- `browser-checks-indexed.test.js` + `tools.browser-checks-wired.test.js`: 9/9.
- No em dashes in any user-facing change.
