# dname-cutoff-3415 -- stop clipping the agent name's descenders (#3415)

## The bug (Josh, live 0.6.88 test, 2026-09-22)
On the agent detail cards the agent's name is cut off at the bottom.

## Root cause (reproduced + measured headlessly)
`.dnamerow .dname` (the identity-column name, `#d-name`) renders at up to 24px
(1.5rem, shrunk by `fitDetailName` for long names) but inherits a ~16px
line-height as a LENGTH from the detail column. A 16px line-box is shorter than
24px glyphs, and the rule keeps `overflow: hidden` for the width ellipsis, so the
descenders (and part of the text) are clipped off the bottom. Measured:
`scrollHeight 22 > clientHeight 16`, `clippedBottom: true` for every name.

## Fix
Scope a proportional `line-height: 1.15` to `.dnamerow .dname` only (not the
shared `.dname` used by task titles / project names, which may rely on the
inherited length). Unitless so it tracks the shrunk size `fitDetailName` sets.
After: line-height 27.6px, `clientHeight == scrollHeight == 28`, `clippedBottom:
false` for short and long names.

## Verification
- Headless measurement across short and long names: clip gone.
- `render-detail-header-1841.js` Part 5 now asserts `#d-name` is not clipped
  (scrollHeight <= clientHeight) on cold open for a short and a long name; passes.

## Scope
One scoped CSS line-height + one regression assertion. No behavior change. Rides
0.6.89 with the other Josh design items. Not money-moving, not public.
