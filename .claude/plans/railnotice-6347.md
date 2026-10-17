# railnotice-6347: the consolidated rail's project notice no longer runs under the agents list (kosmos#6347)

## Change
web/index.html: `body.consolidated #rail-agents > .alist-pjn:not(:empty) { max-height: 40vh; overflow-y: auto; }`.
The rail head's height comes from the grid row, so a long notice (measured by April: 638px in a 600px head; 1580px
with ten failing members) ran under the list. Capped, it scrolls in its own box.

## Decided
- The cap and own scroll, as April proposed on the card.
- No scrollbar-width on the box. Not `none` (#867 hides tracks on the long lists only; this is a needs-you surface,
  #5688), and not `thin` either: the #3443 win32 block leaves scrollbar-width unset on purpose, because on newer
  Chromium any value turns off its visible ::-webkit-scrollbar thumb. (Round 1 of review caught my first version
  setting `thin`, which opted this box OUT of the Windows bar it meant to keep.)
- Rejected: scrolling the whole head (moves the Team map button and the head's own controls); an "N more" summary
  (more code; reversible later if the box proves too small).
- Not done here: a "more below" cue. On macOS the overlay scrollbar hides at rest, so the box can clip a row with no
  bar showing. That is true of every scroll area in the app on macOS, and the clipped edge of a row usually shows;
  a cue that does not depend on the platform is a design change, filed as #6349.

## Checks
- web.project-notice-3923.test.js: the arm asserts the full selector, that the rule sits directly inside the 960px
  block (brace depth 1, comments stripped), the cap, the scroll, and no scrollbar-width at all.
- docs/browser-checks/render-projects.js: a new #6347 arm grows the rail notice from copies of the row the page drew
  (until its content outruns the window, at most 60), measures in one synchronous step, and removes only the copies
  (the region is not live meanwhile). It asserts the box is at most 40vh, scrolls, and still ends above the list. Its
  control lifts the cap on the same box, which must then outgrow 40vh and run under the list, so a viewport too tall
  for the fixture fails instead of passing. It reads at the context viewport and again at 560px tall.
  RUN 2026-10-17 01:31 CDT (frozen 45554ebf18, light and dark): PASS at both heights, control and cap. With the
  surface-gate checks render-shell-noscroll-4872, render-allagents-4812 and render-phone-offline-718, all PASS
  (trailers on 018ac88814). The arm prints only on failure, so the run records the verdict, not the numbers.
  (The first commit cited render-project-done-4583, which only reads the notice text and never measured the layout;
  review round 1.)

## Weakest premise
That 40vh leaves the agents list usable on a short window. The rule sits inside the 960px+ consolidated block, so
phones are unaffected. Review round 3 named the risk exactly: the head height comes from a grid row, so if that row is
shorter than the lead line plus 40vh, the capped box still runs under the list. The render-projects arm now reads a
second time at 560px tall to measure it, and it passed there (01:31 run). Had it failed, the fix was a cap tied
to the head (the notice filling the remaining head height), not a smaller vh. Heights below 560 remain unmeasured.
