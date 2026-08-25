# Plan: consolidated-avatar-crop

Josh, #chaoskosmos-design, 2026-08-25 15:52, five screenshots of the
consolidated view: "The agent avatars are not cropped properly on the
agents column. You can see it's showing a square image over top of a
circle instead of cropping them properly to a circle."

## Root cause

`.lav` (the 34x34 avatar wrapper in every agent list row) normally
clips its child to a circle via `overflow: hidden` -- its own
`border-radius: 50%` rounds its own box but does not, by itself, clip
children. The consolidated rail's own CSS
(`html[data-layout="consolidated"] body.consolidated .lrow > .lav`)
switches `.lav` to `overflow: visible`, so the memory ring (`.lring`,
absolutely positioned outside the avatar's own box) can extend past
it. That same switch drops the clip on a real avatar `<img>`, which
carries no `border-radius` of its own -- so it renders as a plain
square sitting on top of `.lav`'s still-circular background. The
initials fallback (`.lavtint`) was never affected, because it already
has its own `border-radius: 50%`.

## Change

One line: `.lav img` gets `border-radius: 50%` added to its existing
rule, so it self-clips independent of the parent's `overflow` setting
-- true in both the ordinary list (where it was already redundant with
`.lav`'s `overflow: hidden`) and the consolidated rail (where it is
now load-bearing).

## Verification

- [x] Reproduced the bug directly against real bytes: loaded
      `web/index.html` in a real browser (Playwright), switched to
      `data-layout="consolidated"` at a 1440px viewport (the
      consolidated overrides are gated behind a `min-width: 1280px`
      media query), injected a `.lav > img` with a four-color
      checkerboard SVG data URI (so cropping is unmistakable at a
      glance), and measured/screenshotted before and after: the
      pre-fix CSS (`origin/main`) computed `border-radius: 0px` on the
      img with `.lav`'s `overflow: visible` -- square, unclipped. The
      post-fix CSS computes `border-radius: 50%` on the img itself --
      circular regardless of the parent's overflow.
- [x] `node --test web.consolidated-avatar-crop.test.js` -- new file,
      3/3 pass, pins the fix, confirms `.lavtint` is untouched, and
      confirms the consolidated `overflow: visible` override (needed
      for the memory ring) is still in place.
- [x] `npm test` (full suite): 0 failures, exit 0.
