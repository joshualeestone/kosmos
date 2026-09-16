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

## Fix (full rework, after a blind reviewer caught that the WIDE assertions were vacated too)

#3128 moved the gear INTO .pjtitle-row (a flex child of the .pjtitle block), so boxes() measured
the gear as a DESCENDANT of the `title` (.pjtitle) subject. sameLine(.pjtitle, gear) is therefore
vacuous (a descendant's span is always inside its ancestor's box) - it can never fail. That vacated
not just the 700px control but every wide "Settings shares the title's line" assertion (tab view,
consolidated, 961px boundary). Fixing only the control would have shipped a green-but-decorative
check that certifies the blind spot.

The rework:
- boxes() now returns the gear's real SIBLING #pj-one-name (the project name text in .pjtitle-row)
  instead of the .pjtitle block. Comparing two independent siblings is non-vacuous.
- The three pre-existing "shares the title's line" sites repointed to sameLine(gear, name): tab view,
  consolidated, and the 961px boundary (the fourth gear/name assertion, the 700px stacked guard, is
  newly added below, not repointed).
- Negative control at 700px is now !sameLine(gear, search), the exact inversion of the wide
  sameLine(gear, search) assertion: search stacks below .pjtitle-row under 60rem, so it genuinely
  reads NOT-one-line at 700px and the measurement stays provably able to return the dangerous answer.
- Added a positive guard sameLine(gear, name) at 700px: the #3128 deliverable is that the gear stays
  pinned to the name row EVEN when stacked; that was unguarded below 60rem.
- Rewrote the two stale comments (the boxes() note that justified the old .pjtitle subject, and the
  control note) to match the post-#3128 reality.

## Test plan

Verified in isolation against the real #3128 board (NODE_PATH=pw-runtime node render-head-row.js):
all 10 checks PASS, including the repointed gear/name assertions, the gear/search control, and the
new pinned guard. Non-vacuity is structural: gear and name are independent siblings, so sameLine can
return false (unlike the old ancestor/descendant pair). The negative control's red-capability is the
inversion it mirrors - search must stack at 700px, which it does. Integration re-verification is the
re-cut's 3b. No product code changes.
