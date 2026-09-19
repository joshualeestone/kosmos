# import-cards-2690 -- #2690 import-agent cards: graphical treatment

## Problem (Josh, #2690, 2026-09-10)
The found/scan/adopt import cards read as system-generated and the boxes collide
(they sat 6px apart). Josh: give them breathing room so they stop touching, lift
them out of the system-generated look, treat the instructions preview as a quiet
preview panel rather than a raw textarea.

## Scope of THIS branch (simple pass, CSS only)
web/index.html, the found/scan/adopt import-card region only:
- `.fr-found` row gap 6px -> 12px (breathing room) and max-width 36rem -> 38rem.
- `.fr-foundrow` gains a surface fill + a HARDCODED light card shadow (not
  var(--shadow-card): these rows are in the forced-light #firstrun subtree, where
  the theme-conditional token would flip to a heavy dark shadow on a white card)
  + softer card radius, so each row reads as a lifted card. Padding is UNCHANGED:
  a padding bump was tried and reverted, because it shared a source line with
  `column-gap` and tripped the #2518 surface gate (mapped to an unrelated
  projects-columns check); reverting keeps that line out of the diff.
- `.fr-scanpreview` restyled to a quiet sunken well: `background: var(--bg-sunken)`
  (the pinned sunken token, light in #firstrun; NOT --k-sunk, which is unpinned
  there and would go invisible under OS dark) + separator border + `resize: none`,
  so the readonly preview reads as a panel, not an editable textarea.

## Rulings kept (do not regress)
- Found rows stay TWO-COLUMN and short (button on the right), Josh 2026-08-22.
- The folder is hidden unless two agents share a name, Josh 2026-08-22.

## Out of scope (deferred, pending Josh direction)
- The fuller graphical version: an initials badge + header restructure. Offered to
  Josh; not built here. Additive follow-up if he wants it.

## Verification
- CSS only, no markup change: no check selector/label/id changed.
- Browser-checks pass from a bot session: render-firstrun-import (7),
  render-firstrun-scan-on-grant (5), render-import-add-inplace (7). NOTE: these
  assert markup/selector presence only -- they do NOT assert theme, background,
  or box-shadow, so they do not by themselves rule out a dark-theme regression.
- Theme safety is instead guaranteed by construction: the two theme-conditional
  tokens this change would otherwise consume in the forced-light #firstrun subtree
  (--k-sunk, --shadow-card) are replaced by the pinned --bg-sunken and a hardcoded
  light shadow, so the surface cannot go invisible or heavy under OS dark.
- Real render (sandboxed app) inspected; the resize handle was the finding that
  added `resize: none`.

## Done when
The three surfaces render as spaced, lifted cards with a panel-style preview, both
themes, all rulings intact, browser-checks green.
