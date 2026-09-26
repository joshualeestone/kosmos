# tip-no-cover-3574: a tip card never sits on a real control

The 0.6.93 staging cut (2026-09-24 ~21:05, Baron) went red at step 3b: render-update-toast could not click
Check for Update (#upd-btn) because #3574's first-visit tip "Settings for this computer" sat over it and
took the click. Splinter, 21:16: "a tip shouldn't block a real control until it's closed. Reposition it, or
make it not intercept clicks." Baron fixes the check's side (toast-tips-3574: tips off in its sandbox); this
is the product side.

## Finished looks like
On every screen, a tip card (a first-visit tip, or one opened from the ?) covers no visible control: no
button, link, field, switch, tab. It still points at its target when a place beside, below or above it is
clear; on a dense screen it sits in the nearest clear place with no arrow, and stays there while that place
stays clear, so it does not hop about as the page scrolls. Check for Update stays clickable with the
Settings tip open. render-update-toast passes without its test-side change.

## Decided
- Reposition, not click-through. A card whose text lets clicks fall through to a hidden button would have a
  person click words and trigger something they cannot see.
- Scored placement: the old order (beside when asked, below, above) is tried first, so nothing moves where
  it was already clear; either side is added; then a 24px grid search for the nearest clear place.
- Controls exclude the tip's own target and the tip and assistant layers.

## Weakest premise
That a clear place exists. At very small windows a screen may have none; the card then keeps the pointing
place that covers least (and under 40rem CSS pins it to the bottom edge as before).

## Verification
render-help-tips-3574: T31 opens every screen's tip (board, projects, create, an agent's page, Settings:
You, This computer, Updates, Models, Look) and asserts it covers nothing, plus Check for Update under the
pointer with the tip open; T14 asserts after a scroll the card either keeps its exact gap to the target or
sits clear. Both fail on main's placement code. render-update-toast passes here and fails on main.
