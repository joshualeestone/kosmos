# Plan: notification mock title bold at body size (not larger)

Branch: `notif-mock-size`. Follow-up to #2460 (card #768 batch, Mona Lisa third-round correction).

## Problem
Josh asked 3x for the first-run Notifications mock's title "App Background Activity" to be
BOLD, not LARGER. #2460 shipped the title at weight 700 but font-size `1.0625rem`. Worse, the
body caption `.s4-nb` (bare class, specificity 0,1,0) loses the cascade to `#firstrun .fr-body p`
(1,1,1), which forces `400 1.0625rem`. So BOTH title and body actually render at 17px (1.0625rem),
and the body's declared `.6875rem` never took effect. Josh's real ask is "bold at the SAME size as
the body", and the body's intended size is `.6875rem` (a real macOS notice's small caption).

## Fix
In `web/index.html`, scope BOTH captions to win the `#firstrun .fr-body p` cascade at the small size:
- `#firstrun .fr-body p.s4-nt { font: 700 .6875rem/1.4 ... }` (title, bold, small)
- `#firstrun .fr-body p.s4-nb { font: 400 .6875rem/1.4 ... }` (body, normal, small)

Result: title bold, body normal, both `.6875rem` (~11px). Bold, not larger, whole notice the
intended small size.

## Test
Strengthen `docs/browser-checks/render-firstrun-stepcap-gear-0640.js` S4-title arm. The old arm
only pinned `ntSize == nbSize`, which passed at `17px == 17px`. Add an absolute-size arm (~11px /
`.6875rem`, band 10.5-11.5px) and a body-weight arm (`< 700`), so a size-bump (17px), a non-bold
title, or a bold body all red. Verified: reds at the old 17px, passes at `.6875rem`.

## Scope / non-goals
- Only the two S4 notification captions. No change to the cog, the copy, or other panes.
- Hermetic file:// browser-check (already in the no-URL loop); no server needed.

## Decisions
- Band 10.5-11.5px pins `.6875rem` (== 11px on a 16px root) tightly: it excludes both the 17px
  size-bump above AND a shrink to the sibling caption size below (`.s3-step-cap` is `.625rem` ==
  10px), so neither regression can pass. (An earlier draft used a looser 10-12px band; tightened
  per a challenge-loop NIT because 10px coincides with a real sibling size.)
- Scoping the body (not just the title) is the real fix: an earlier one-number title-only fix
  would have left the body silently at 17px, so title==body would still pass at the wrong size.
