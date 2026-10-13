# plussicancel-6029: the Kosmos+ sign-in card's Cancel link is a 44px tap target on a phone

**Branch:** `plussicancel-6029` · **Card:** kosmos#6029 (found in Mona Lisa's design review on #5995).

## The defect
On a phone the link at the foot of the Kosmos+ sign-in card (`a#plus-si-cancel`, reading Cancel, Start over or Sign
out by step) is 48 x 17 px, under the 44 px bar the phone stylesheet holds every other Settings control to.

## The change
One rule in the phone block (`@media (max-width: 40rem)`), beside `#plus-signin-top` and `#plus-signin-bottom`, which
already do the same: `#panel-settings #plus-si-cancel { display: inline-flex; align-items: center; min-height: 44px; }`.
Wider than 40rem nothing changes.

## Why render-plus-signin-3478 cannot move
It measures the card's height and centring at 1400, 1280 x 720, 1440 x 900, 800 x 900 and 1280 x 400: all wider than
40rem (640 px), where the new rule does not apply. CI's browser-checks job runs it anyway.

## Measured
`docs/browser-checks/mobile-shots.js --screens plus-signin-email` (iPhone 15, 393 x 852): the under-44px count for the
screen, on main (control) and on this branch.

## Not measured
The Start over and Sign out steps reuse the same element and so the same rule; the shot tool has no screen for them.
