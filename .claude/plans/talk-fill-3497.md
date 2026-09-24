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
- No fixed header height: in the talk view the body is a viewport-tall flex column and the panel
  takes what is left under the header, so a taller header shrinks the box instead of overshooting.

## Rejected
- Moving `.back` into `.dleft` in the markup: a template move touching the detail panel's
  back-button wiring for a purely visual need.
- `display:none` on the empty status line: would drop the live region from the accessibility tree.

## Weakest premise
Turning the body into a flex column while the talk view shows. Any visible body-level sibling now
shares the height with the panel (correct: the box fills what is left), but a future body-level
element that is visible on the agent page would shrink the box. A1b/A1d catch a box that stops
meeting the bottom or starts scrolling.
The back row's space is a 47px `.dleft` margin (plus its existing 6px ring padding), measured from
the back row, so the column's scroll box starts below the back link; A1g and A1k pin it.

## Verification
- docs/browser-checks/render-talk-fill-2622.js: new arms A1b-A1e at two window heights (box meets
  header/right/bottom; composer bottom margin equals sides; no page scroll; the back link does not
  overlap the identity block). Negative control: against origin/main's web/index.html A1b and A1c
  go red (boxTop=130 vs 77, right 1376 vs 1400, bottom 1036 vs 1100, composer bottom 42 vs 24).
- A1h: the build marker moves to the bottom-left in this state, clear of the box.
- A1j: a connection notice below the panel (#conn) stays visible and the box makes room.
- A1k: the identity column's scroll box starts below the back link.
- A1i: a visible phone-pairing card (#askcard) is not covered; the header's bottom margin is
  dropped instead of pulling the panel up with a negative margin, which covered it.
- A1f re-runs the edge arms with a 60px taller header; A1g compares the identity block's distance
  from the header on Talk and on Model (no jump when switching).
- Narrow (A2b/A2c), long-thread (A9) and scoping (A6) arms unchanged and green.
