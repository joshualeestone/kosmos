# talk-fill-3497: the Talk box fills its area; composer locked to the bottom (#3497)

## Goal (Josh, 2026-09-23 19:39 CDT, #chaoskosmos-design, two screenshots)
The agent Direct Message panel fills the whole region right of the identity column: up to the
header rule, to the window's right edge, and to the window's bottom (his red bands). The
composer's bottom margin equals its left/right margin (his green marks), locked to the bottom at
any window size.

## Decisions
- Wide layout only (above the 56rem breakpoint). Below it the page stacks the nav above the talk
  box and keeps the existing #2622 fill; Josh's screenshots are the wide layout.
- The identity column does not move. The back link is taken out of the flow (absolute, same
  on-screen spot) so the box can rise to the header; `.dleft` is padded by the space the back row
  occupied, so the avatar, name and nav sit exactly where they did.
- Body bottom padding is dropped only while the talk section is shown, so the box reaches the
  window bottom without a page scroll.
- The empty `#d-say-msg` status line under the composer takes no space in the talk view, so the
  composer's bottom gap is the box padding (24px) like its sides. It stays rendered (not
  display:none) so its alert live region still announces.
- Header height is taken as 77px (`--talk-fill-top-wide`), the same fixed-offset approach and the
  same known limitation as #2622's 157px: a wrapped update notice makes the box overshoot slightly.

## Rejected
- Moving `.back` into `.dleft` in the markup: a template move touching the detail panel's
  back-button wiring for a purely visual need.
- `display:none` on the empty status line: would drop the live region from the accessibility tree.

## Weakest premise
The 77px header height. It is measured, not derived; a header change needs the variable updated.
render-talk-fill-2622 A1b fails if the box top stops meeting the header rule, so drift is caught.

## Verification
- docs/browser-checks/render-talk-fill-2622.js: new arms A1b-A1e at two window heights (box meets
  header/right/bottom; composer bottom margin equals sides; no page scroll; back link clear of
  the box). Negative control: against origin/main's web/index.html all four new arms go red
  (boxTop=130 vs 77, right 1376 vs 1400, bottom 1036 vs 1100, composer bottom 42 vs 24).
- Narrow (A2b/A2c), long-thread (A9) and scoping (A6) arms unchanged and green.
