# #3117 - non-.lav avatar surfaces render portrait photos non-square (follow-up to #3110)

Branch: `avatar-crop-3117` * card: joshualeestone/kosmos#3117 * lane: avatar-rendering (Renet Tilley), handed by Splinter as the follow-up to my #3110

## Problem
The #3110 class: an avatar `<img>` pinning `height: 100%` inside a fixed circular
box whose layout lets the height resolve against the image's intrinsic height, so
a portrait photo renders NON-square. #3110 fixed only the `.lav` family (Members
list, the one overflow:visible surface that ovaled). These other surfaces keep
overflow:hidden, so a portrait photo shows a top-anchored crop, not an ellipse -
milder, but wrong.

Per-surface fix (same one-liner as #3110): `height: 100%` -> `height: auto; aspect-ratio: 1`
(object-fit: cover already crops). Surfaces:
- `.railme-face img` (consolidated rail "me")
- `.msg-av img` (chat/DM message avatar)
- `.detail-av img` (agent detail page)
- `.userpop-face img` (user popover / top-right)
- `.hub.haspic img` (org-chart hub "you")

## Measured, per surface (pw-runtime, 12x44 portrait source, revert control in the same run)
| surface | pre-fix (control) | post-fix | verdict |
|---|---|---|---|
| railme-face | 24x88 | 24x24 | bug fixed |
| msg-av | 34x125 | 34x34 | bug fixed (the exact 34x125 #3110 traced) |
| userpop-face | 26x95 | 26x26 | bug fixed |
| hub.haspic | 104x381 | 104x104 | bug fixed |
| detail-av | 70x70 | 70x70 | already square (flex container); fix is defensive |

The control bites on 4 of 5 (proves the harness + the fix). detail-av was already
square because its container is `display:flex; align-items:center` (height:100%
resolves against the fixed 72px box, not a grown grid row). I keep its rule for
uniformity: `aspect-ratio:1` guarantees a square img regardless of the container's
display model, so it will not regress if that box ever becomes a grid like its
siblings.

## Out of scope (decided, with evidence)
- `.onode` / org-chart avatar: NOT fixed, and it does not need it. The org node
  renders the avatar as an SVG `<image ... width="46" height="46"
  preserveAspectRatio="xMidYMid slice">` (the `face()` function), which is the SVG
  equivalent of a fixed square with object-fit:cover - already correct. The
  `.onode .face img` HTML rule the card listed does not govern the rendered org
  avatar (org uses SVG, not an HTML img). Closing that residual with evidence
  rather than leaving it vaguely "separate".

## Weakest premise
detail-av's change fixes no live bug (it measured already-square). If a reviewer
reads a no-op diff line as noise, it could be dropped - but uniform application is
more robust and matches the card's "identical, mechanical, per surface" intent, so
I keep it and document it as defensive rather than a fix.

## Verification
- `web.avatar-crop-surfaces-3117.test.js` (new): source-pins each of the 5 img
  rules to the fixed form and asserts the pre-fix `height: 100%` is gone per
  selector (mirrors web.consolidated-avatar-crop.test.js). Negative control:
  0-pass / 6-fail against pre-fix origin/main.
- All web.*.test.js (1476) pass, including the #1469 brace-anchor guard and
  web.consolidated-avatar-crop.test.js (untouched - I did not change `.lav`).
- Live pw-runtime geometry proof above (both arms), recorded via `Browser-check` trailer.
