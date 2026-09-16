# fix-headrow-control-3128: repoint render-head-row's 700px control after cog-left

Blocker: the 0.6.70 staging cut failed at 3b on render-head-row (a cut-time-only browser-check
PR CI does not run). Card #3128 (cog-left, Mona) moved the project-title settings cog to the LEFT
of the title and pinned it to the header row in both layouts (extends #1043).

## Problem

render-head-row.js's 700px CONTROL asserted !sameLine(narrow.title, narrow.gear) - that the gear
stacks away from the title at narrow width, proving the sameLine measurement can return "not one
row" so the wide PASS assertions are not vacuous. After #3128 the gear is pinned to the title at
every width, so at 700px title+gear share a line and the control's else-bad fires. Measured from
the failed run: title/gear both y=406.8, search sits a row below at y=451.8. The wide assertions
(Settings shares the title's line + the search's line) all PASSED; only the narrow control is stale.
This is a stale check, not a product regression - cog-left works as designed.

## Fix

Repoint the 700px control to a pair that STILL stacks under 760px: !sameLine(narrow.title,
narrow.search). Search genuinely stacks below at 700px (measured y=451.8 vs title y=406.8), so the
control stays a LIVE assertion that can still catch a real narrow-layout regression (it returns the
dangerous answer if search ever stops stacking), not a vacuous pass. Added a comment explaining the
#3128 pinning so the rationale does not go stale.

## Test plan

The control's own red-capability is proven by the failed run: the old title/gear form returned the
dangerous answer (FAIL) when title and gear shared a line. The new title/search form passes on the
same captured geometry (44px vertical gap, well beyond overlap). Integration verification is the
re-cut's 3b, which runs render-head-row against the real board. No product code changes.
