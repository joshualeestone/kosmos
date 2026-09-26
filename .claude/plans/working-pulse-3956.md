# working-pulse-3956: a slow green pulse on working agents (Josh 2026-09-26)

## Goal
Every working-green ground (grid card .acard.working, list row .lrow.working and its one-screen
variant, project member .pj-member.pjm-working) pulses slowly a little greener and back. CSS only,
off under prefers-reduced-motion.

## Decision
- One animation, `working-pulse`, 3.6s ease-in-out infinite, on background-color only: the layer
  UNDER the static --wash-working gradient moves from --k-surface to color-mix(surface 90%, #2f7d5a).
  Deepest point ~ twice today's wash (light: 255 -> 234,242,239). Works in every theme because it
  mixes into the theme's own surface.
- Josh's "10% or 15% increase" read as percentage points of green, low end (10), because he also
  said "not crazy, super dark". A relative 10% of a .10 wash would be invisible.
- Rejected: @property-registered colour token (discrete flip where unsupported); a pseudo-element
  overlay (these elements already use their pseudo-elements elsewhere, and positioning risk).

## Verification
- docs/browser-checks/render-working-pulse-3956.js, chromium + webkit, 30/30.
- Perturbation: animation line removed -> pulse arms RED; reduced-motion rule removed -> 6
  reduced-motion arms RED.
- Mapped checks re-run green: render-dm-badges-2863, render-no-conflict-3729, render-stale-auth-1930.
- Contrast: dark ink on the greenest ground is ~16:1.
