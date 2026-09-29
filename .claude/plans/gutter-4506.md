# gutter-4506: dialog and boot-cover gutter strip (kosmos#4506)

## Problem
On a machine with classic scrollbars the tab layout reserves a 15px gutter on `<html>` (#1309). A fixed full-window
layer cannot paint it, so a strip of page showed beside every dialog (`.rm-back`, 0.72 dark wash) and beside
`#boot-cover`. #4494 (PR #4512) fixed the same shape for the first-run wizard and the update overlay.

## Measured before building (scratch harness, #4494's method, 1280x800, 15px custom scrollbar)
| look | approach | gutter px | page px beside | board moves |
|---|---|---|---|---|
| light | as-is | 250,249,247 | 82,83,86 | 0 |
| light | drop gutter | 82,83,86 | 82,83,86 | 15px |
| light | tour-dim canvas | 82,84,86 | 82,83,86 | 0 |
| dark | as-is | 12,13,15 | 15,18,21 | 0 |
| dark | tour-dim canvas | 16,18,21 | 15,18,21 | 0 |
| navy (Plus), light OS | tour-dim canvas | 82,84,86 | 15,20,28 | 0 |
| navy (Plus), any | as-is, NO dialog | 255,255,255 | 12,21,41 | - |

Boot cover: dropping the gutter matched exactly in light, dark and navy; the 15px happens behind an opaque cover.

## Decision
- `.rm-back`: the tour-dim route Angel suggested (#3737): while a dialog is up the canvas is one colour,
  `color-mix(in srgb, rgb(17, 20, 24) 72%, var(--k-bg))`; on Tasks (canvas is `--k-surface`, #4216) the mix is over
  the surface. Rejected: dropping the gutter (15px reflow behind a see-through wash on every dialog open).
- `#boot-cover`: #4494's rule (no gutter, no scroll while up). Rejected: the canvas route, because the cover's ground
  is `--bg`, which the Plus section sets on the body where the root cannot read it (measured 250 vs 19,33,64).
- Weakest premise: the harness sets `data-scrollbar-classic` itself (the product's measurement reads 0 under a custom
  scrollbar that cannot scroll while measuring). A real classic Mac sets it by measurement.
- Known residual, not fixed here: navy Plus section. The gutter is white there even with no dialog (separate
  pre-existing defect, to be filed); beside a dialog it becomes grey rather than white.

## Built
- `web/index.html`: three rules (dialog canvas, Tasks dialog canvas, boot cover).
- `docs/browser-checks/render-dialog-gutter-4506.js`, gated, README row; reason-grep counts 205->208, 124->126.

## Verified
- Check: 30 pass on the branch; on unmodified main red on the dialog (light, dark) and boot-cover arms.
- Perturbation per site on a scratch copy: removing the dialog rule reds the Agents dialog arms; removing the Tasks
  rule reds dark Tasks; removing the boot rule reds the four boot arms. A fourth edit (a mask on the #4216 rule) was
  green when removed, so it was dead and is not shipped.

## Challenge loop

### Iteration 1 (opus)
- BLOCKER, fixed: giving <html> a background stopped the body's background spreading to the window, so on a short
  page the canvas below the body showed dimmed twice (light 82 vs 35, measured by the reviewer and reproduced).
  Fix: the tour's own `> body { min-height: 100vh }` while a dialog is up. New short-page arm in the check (1200px
  window, no spacer); red without the min-height rule (82,83,86 vs 35,37,41), green with it. Dark's band is ~1 unit,
  so light is the arm that catches it.
- WARNING, fixed: the dialog rules now apply only under `[data-scrollbar-classic]`, like #4216, so an overlay-scrollbar
  Mac (no gutter to fix) keeps today's canvas exactly.
- WARNING, deferred (known residual): a dialog over the tour's dim, or two stacked dialogs, double-dims the page while
  the gutter gets the single mix, so a lighter strip remains there. Rare, and closer than today's bright strip; CSS
  cannot count stacked layers.
- NIT, taken: ignore a shown .rm-back inside a hidden section (`:not([hidden] *)`), so a Plus dialog left open while
  the section is hidden cannot dim the canvas with nothing on screen.
- NIT, fixed: the check's comment said dark's strip is "about 6 per channel"; it is 3 to 6.
- The CSS comment about the navy residual moved to #4542 (filed 07:36, the navy Plus white gutter) and this plan.
