# layer-gutter-4494: no strip of the page beside the first-run wizard or the update overlay

Card: joshualeestone/kosmos#4494 (claimed by Angel 2026-09-29 01:30 CDT, comment on the card at 06:30:16Z).
Found by Kano's review round on #4489, which fixed the same strip on the #4356 first screen.

## Finished looks like
On a Mac that draws classic scrollbars, neither the first-run wizard nor the update overlay shows
a strip of the board down the right edge: while either is up, `<html>` reserves no scrollbar gutter
and the page does not scroll, and the layer covers the whole window. When the wizard closes the tab
layout's gutter (#1309) comes back. A browser check proves this on ANY machine (not only a Mac with
a mouse attached) and goes red with the rule removed.

## Decisions
- One CSS rule beside `html.restart-up`, the same declarations (`overflow: hidden;
  scrollbar-gutter: auto`), keyed with `:has` as #4489 does for its first screen:
  `html:has(> body > #firstrun:not([hidden]))` and `html:has(> body > .upd-back)`. :has follows
  every open/close path (frOpen/frClose toggle [hidden]; the overlay is only ever removed by a
  reload), so no JS is touched.
- Specificity: the tab layout's `html:not([data-layout="consolidated"])` is (0,1,1); the new
  selectors are (1,1,2) and (0,1,2), so they win. The only other gutter rule (#3497's Talk view)
  also sets `auto`, so it cannot fight this.
- The wizard scrolls inside its own layer (`.fr-back { overflow-y: auto }`), so hiding the page's
  overflow takes nothing from it.
- #4489's first-screen rule is NOT duplicated here: #4489 is still open and carries it.
- Accepted trade: the update overlay is an 0.86 wash, not opaque, so when the gutter goes the board behind it
  widens 15px, faintly visible under the wash (the restart screen makes the same trade and is opaque). A 15px
  shift under a wash that announces the board is about to reload, over a bright strip beside it.
- Dialogs and the loading cover have the same shape and are NOT covered: filed as #4506, because a dialog's
  wash is lighter still and every dialog open would shift the board (#1309's jump). Page has no <dialog>.
- Rebased onto main after #4421 moved the emit-site counts (201->202, 122->123), and again after #4489 (#4356) moved
  EXPECTED_SITES 202->204; this branch's +3/+2 now reads 207/125, measured by the equality test on the rebased tree.
  #4489's own first-screen rule (#fr-choice) is on main beside this one; neither duplicates the other.

## The check (render-layer-gutter-4494)
- MEASURED: this Mac's Chromium 151 (headless and headed) gives a stable gutter 0 width, and a
  `::-webkit-scrollbar { width: 15px }` custom scrollbar takes its width only when the page really
  scrolls. So the harness forces a custom scrollbar AND a tall spacer (a long board), drops
  `--hide-scrollbars`, and first asserts the gutter is 15px with nothing under the right edge
  (positive control), then opens each layer the real way (`?first-run=1`, the Update button).
- Stated gap: the short-page case (a reserved but unscrolled gutter) cannot be reproduced with a
  custom scrollbar; the same rule covers it, and CI's classic-scrollbar runner exercises it.
- Red with the rule removed: MEASURED, 4 failures (both layers: gutter 15, not covered).
- Registered in gated.txt, the README index, and the emit-site counts (+3/+2, measured by removing
  the file: main's counts are exact without it).
