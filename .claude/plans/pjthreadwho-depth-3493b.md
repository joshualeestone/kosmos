# pjthreadwho-depth-3493b - render-fields: exempt #pj-thread-who's cross-theme flip (0.6.91 blocker)

## Card / trigger
Baron's 0.6.91 staging bisect (2026-09-24) named #3493 (commit 9628a617a, "black the tab-view
conversation column .pjmid in dark"): render-fields.js fails from 9628a617a onward, both engines,
static CSS, any box - `#pj-thread-who is recessed in light and raised in dark`. CI never caught it
(render-fields is not in the CI allowlist). Release blocker; Baron re-cuts 0.6.91 on merge.

## Baron's ruling on intent
Keep the black column (Josh's #3493 intent - do NOT revert). #pj-thread-who keeps its depth cue.
Only if a consistent-direction cue genuinely cannot coexist with #000 should render-fields.js be
updated, with the reason in the commit and on the card.

## Root cause (measured)
render-fields enforces "a field's fill-vs-container direction must not FLIP between light and dark".
#pj-thread-who (the "which agent" SELECT in the project composer) has fill = var(--k-bg) (#faf9f7
light / #0c0d0f dark). #3493 set its container .pjmid to #fff (light) / #000 (dark). So:
- light: field #faf9f7 vs box #fff -> field darker -> recessed
- dark:  field #0c0d0f vs box #000 -> field lighter -> raised
=> a flip. It CANNOT be flattened to one direction: nothing is darker than #000 (cannot stay
recessed in dark) and nothing is lighter than #fff (cannot stay raised in light). This is the same
"distinct field the black ground surrounds" case as #pj-say, which render-fields already exempts
(#3388).

## The fix
docs/browser-checks/render-fields.js: exempt `#pj-thread-who` from the no-flip rule, right beside the
existing `#pj-say` exemption, scoped to that exact id and no wider (every other field still held to
the rule, so an unintended flip elsewhere still fails). NO web/index.html change: the black column
stays and the field keeps its intended depth cue (recessed in light, raised in dark), exactly as
Baron directed.

## Verification
- render-fields cross-theme flip count: 1 -> 0 on BOTH engines (the flip measurement is pure
  computed-style, so it is environment-independent; confirmed via file://).
- Test-only change: the product is unchanged, and render-fields was green before #3493 except this
  one flip, so removing the sole new failure returns it to green. Baron re-runs render-fields against
  the served board in his re-cut.

## Rejected
- Reverting the black column: Baron said keep it (Josh's #3493 intent).
- A CSS fix to make the cue consistent: impossible against the #fff/#000 extremes (proven above).
- Making the field "level" (fill == container): loses the depth cue Baron said to keep, and is a
  product change where a scoped test exemption suffices.

## Weakest premise
That render-fields was otherwise green at origin/main (only the flip is new from #3493). Baron's
bisect states exactly that (passes at 9628a617a^, fails at 9628a617a on this one assertion), so the
exemption returns it to green.
