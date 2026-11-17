# memring-8628: memory rings keep one thin stroke, never clipped (kosmos#8628)

## Problem (Josh, 2026-11-17 08:58)
The memory ring round each agent's picture got thicker as memory filled, and at high fill it was cut square at the
top, bottom and sides. Seen in the My Agents list (#8303), folded.

## Cause (measured)
`.gf.warn { stroke-width: 5 }` and `.gf.high { stroke-width: 6 }` override every ring's own stroke-width attribute.
lrowRing draws r 15.5 in a 34 viewBox: 15.5 + 6/2 = 18.5 > 17, so the SVG viewport clips it. The consolidated rail and
the project members had local overrides back to 2.5; My Agents had none.

## Decision (Splinter, from Josh's words; Josh can override)
One thin constant stroke at every fill; fullness by arc length and colour only; never clipped at any size.

## Change
- web/index.html: bands set colour only; the two local 2.5 overrides removed (now redundant).
- web.ring-weight-8628.test.js: no band rule sets a width; each ring drawing's r + w/2 fits its box; controls.
- docs/browser-checks/render-member-ring-3991.js: the control that expected the thick global width now checks the
  instrument with an inline 6, and asserts a ring outside the members column also stays 2.5.
- docs/browser-checks/mobile-shots.js: screens myagents-rings-8628(-folded) with readings stubbed at 10/50/70/95.

- Visible beyond the list: the grid card gauge keeps its drawn 4 at amber and red (it was 5 and 6), per the ruling.

## Not changed
- iPhone (ios/Kosmos/AgentsView.swift memoryRing): 2.5 pt in every band, overlay outside the clip. Read, not run.
