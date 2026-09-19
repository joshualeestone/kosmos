# import-cards-2690 -- #2690 import-agent cards: graphical treatment

## Problem (Josh, #2690, 2026-09-10)
The found/scan/adopt import cards read as system-generated and the boxes collide
(they sat 6px apart). Josh: give them breathing room so they stop touching, lift
them out of the system-generated look, treat the instructions preview as a quiet
preview panel rather than a raw textarea.

## Scope of THIS branch (simple pass, CSS only)
web/index.html, the found/scan/adopt import-card region only:
- `.fr-found` row gap 6px -> 12px (breathing room between cards).
- `.fr-foundrow` gains a surface fill + soft shadow + softer card radius + a touch
  more padding, so each row reads as a lifted card, not a bare bordered row.
- `.fr-scanpreview` restyled to a quiet sunken well (k-sunk fill + separator
  border) with `resize: none`, so the readonly preview reads as a panel, not an
  editable textarea.

## Rulings kept (do not regress)
- Found rows stay TWO-COLUMN and short (button on the right), Josh 2026-08-22.
- The folder is hidden unless two agents share a name, Josh 2026-08-22.

## Out of scope (deferred, pending Josh direction)
- The fuller graphical version: an initials badge + header restructure. Offered to
  Josh; not built here. Additive follow-up if he wants it.

## Verification
- CSS only, no markup change: no check selector/label/id changed.
- Browser-checks pass from a bot session: render-firstrun-import (7),
  render-firstrun-scan-on-grant (5), render-import-add-inplace (7).
- Real render (sandboxed app, both themes' tokens confirmed) inspected; the
  resize handle was the finding that added `resize: none`.

## Done when
The three surfaces render as spaced, lifted cards with a panel-style preview, both
themes, all rulings intact, browser-checks green.
