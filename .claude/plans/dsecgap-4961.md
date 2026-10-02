# #4961 (b): a gap between the Fresh start card and the terminal card

**Done looks like:** on an agent's AI Settings, every visible section card has the same 24px gap above
it, including "This agent's terminal" under the Memory / Fresh start row.

## Cause
`.dsec:not([hidden]) + .dsec:not([hidden]) { margin-top: 24px; }` (#2916). `+` matches only the
next sibling. AI Settings shows model, memory, term, remove, but profile, instr and skills sit between
memory and term in the DOM (hidden), so term got no margin and the row above sat flush against it.
Josh noticed when the Fresh start status line grew the card (2026-10-01 22:17).

## Change
- web/index.html: `+` becomes `~` (any earlier visible sibling). The first visible section still gets
  no margin; DOM-adjacent pairs are unchanged.
- docs/browser-checks/render-dsec-gap-4961.js (+ README row, gated.txt).

## Evidence
- Before: memory -> term 0px on chromium and webkit; every other pair 24px.
- After: all pairs 24px, all checks pass. render-settings-nav, render-consolidated-settings-2842,
  render-agent-nav, render-dsec-ring-4961 also pass on this branch (Settings sections share .dsec).

## Weakest premise
That nothing relied on the missing gap. Settings shows one section at a time, so `~` changes nothing
there; the agent page's only non-adjacent pair is memory -> term.

Stacked on agentpage-4961 (#4961 a): both edit neighbouring CSS lines.
