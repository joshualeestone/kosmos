# rf-range-3690: render-fields does not treat a slider as a field

## Why
The 0.6.95 staging cut (2026-09-25 14:41 CDT, frozen at da343bae1) stopped at step 3b:
`render-fields (failed twice)`. Reproduced alone on Mortals on the frozen tree, deterministic:
8 assertions, both engines, all on #3690's two swarm sliders (`#d-swarm-max`, `#d-swarm-cap`,
`<input type="range">` inside `.swbox`):
- `<engine>/light field #d-swarm-* is the same fill as .swbox (rgb(255, 255, 255))`
- `<engine> field #d-swarm-* is level in light and raised in dark`

## Call
Exclude `type=range` from render-fields' FIELDS selector. Its own comment defines the set as
"everything a person types into"; a slider is not typed into and draws a track and thumb, not a
field fill. It belongs with checkbox and radio, which the selector already excludes.

Rejected: restyling the sliders to give them a raised fill. That would satisfy the check by
adding a field look to a control that is not a field, which is the wrong fix for a
wrong-category assertion.

## Weakest premise
That no slider should ever be held to a contrast rule. A slider's TRACK can still be invisible
against its box; this check never measured tracks, and now explicitly does not measure sliders.
A track-contrast check would be a separate card.

## What would change my mind
A design ruling that sliders must look like fields, or a slider whose track is unreadable.

## Proof
- Red: render-fields alone on da343bae1 (Mortals): 8 FAIL, all the swarm sliders.
- Green: the same, on this branch (Mortals), twice.
- Coverage kept: fields measured per engine and scheme went 89 to 85, exactly the four swarm
  sliders (`#d-swarm-max`, `#d-swarm-cap`, which failed; `#create-swarm-max`,
  `#create-swarm-cap`, which passed only because their container's fill differs). They are the
  only `type="range"` inputs in web/index.html; no other field left the check.
