# working-pulse-3956: a slow green pulse on working agents (Josh 2026-09-26)

## Goal
Every working-green ground (grid card .acard.working, list row .lrow.working and its one-screen
variant, project member .pj-member.pjm-working) pulses slowly a little greener and back. CSS only,
off under prefers-reduced-motion.

## Decision
- One animation, `working-pulse`, 3.6s ease-in-out infinite, on background-color only: the layer
  UNDER the static --wash-working gradient moves from --k-surface to color-mix(surface 90%, #2f7d5a).
  Deepest point ~ twice today's wash (light: 255 -> 234,242,239). Measured swinging in light and
  dark; the Kosmos+ navy surface uses the same token and is NOT measured.
- Josh's "10% or 15% increase" read as percentage points of green, low end (10), because he also
  said "not crazy, super dark". A relative 10% of a .10 wash would be invisible.
- Phase: the 5s poll rebuilds cards and a new element's animation starts at 0%, which snapped the
  green away (found by blind review, iteration 1). pinWorkingPulse sets each working-pulse
  animation's startTime to 0 (document timeline origin) from a MutationObserver, whose callback
  runs before the next paint; animationstart alone left one white frame in chromium (measured).
- Cost, accepted: background-color is not a compositor property, so each working box repaints per
  frame. The compositor alternative (an opacity overlay on ::before) needs position:relative plus a
  new stacking context on .acard/.pj-member, which could trap card menus under neighbouring cards;
  not worth that risk for this card.
- CORRECTION: an earlier version of this plan said these elements already use their pseudo-elements.
  That was never measured and is false (the only hits are on a child, .lrow > .lav::after). The real
  reason for rejecting the overlay is the positioning and stacking risk above.
- Rejected: @property-registered colour token animated on a persistent ancestor (an inherited
  property animating per frame restyles the whole subtree every frame).

## Verification
- docs/browser-checks/render-working-pulse-3956.js, chromium + webkit, 34/34 (incl. the rebuild arm).
- Perturbation: animation line removed -> pulse arms RED; reduced-motion rule removed -> 6
  reduced-motion arms RED; pin disabled -> rebuild arm RED on both engines (step 5.00);
  animationstart-only pin -> chromium RED (5.50), webkit green.
- Mapped checks re-run green: render-dm-badges-2863, render-no-conflict-3729, render-stale-auth-1930.
- Contrast: dark ink on the greenest ground is ~16:1.

## Challenge-loop iteration 2 (deferred, with reason)
- Observer scope (whole document): kept. Its callback work is proportional to the nodes the page
  itself just added (classList checks, plus a querySelectorAll inside each added subtree), which
  the page already paid to build; scoping it to the three containers would miss surfaces added
  later. Moved above the first tick() so the first render is pinned by it too.
