# rf-range-3690: render-fields does not treat a slider as a field

## Why
The 0.6.95 staging cut (2026-09-25 14:41 CDT, frozen at da343bae1) stopped at step 3b:
`render-fields (failed twice)`. Reproduced alone on Mortals on the frozen tree, deterministic:
8 assertions, both engines, all on #3690's two swarm sliders (`#d-swarm-max`, `#d-swarm-cap`,
`<input type="range">` inside `.swbox`):
- `<engine>/light field #d-swarm-* is the same fill as .swbox (rgb(255, 255, 255))`
- `<engine> field #d-swarm-* is level in light and raised in dark`

## Call (final)
Skip NATIVE sliders from every field check, where render-fields collects its fields: an
`<input type="range">` whose computed `appearance` is not `none`. They are listed by id in the
output, so the skip cannot grow unnoticed. A slider styled `appearance:none` paints its fill
and stays a measured field, as the select check conditions on appearance. An engine that does
not report `appearance` gets the slider measured (the safe side).

Why: measured (below) that a native slider does not paint its computed fill in chromium or
webkit, so the check was comparing a colour nobody sees.

Replaced in review: the first version excluded `type=range` in the FIELDS selector outright,
on the reasoning that a slider is "not typed into" (review 3: that stays silent if a slider is
later restyled to paint its fill). Rejected throughout: restyling the sliders to give them a
field fill.

## Measured: a native slider does not paint its fill
On a test page (not the board's own sliders), Playwright, chromium and webkit, a dark card
(44,44,46):
- a slider with the swarm CSS (computed rgb(255,255,255)): its edge pixels read 44,44,46;
- a native slider with an explicit `background:#fff`: also 44,44,46;
- POSITIVE CONTROL, `appearance:none` + white: reads 255,255,255.
Firefox is not measured; the check does not run it.

## Weakest premise
That a native slider paints nothing a person should see. Its TRACK and thumb are not measured by
this check (they never were); a track-contrast check would be a separate card.

## What would change my mind
A design ruling that sliders must look like fields, or a slider whose track is unreadable.

## Proof
- Red: render-fields alone on da343bae1 (Mortals): 8 FAIL, all the swarm sliders.
- Green: the same, on this branch (Mortals), twice.
- Coverage kept: fields measured per engine and scheme went 89 to 85, exactly the four swarm
  sliders (`#d-swarm-max`, `#d-swarm-cap`, which failed; `#create-swarm-max`,
  `#create-swarm-cap`, which passed only because their container's fill differs). They are the
  only `type="range"` inputs in web/index.html; no other field left the check.
